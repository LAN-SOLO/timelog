//! Datenbestand als eine JSON-Datei (`data.json`) im App-Datenordner —
//! atomar geschrieben (Temp-Datei + fsync + rename), damit ein Absturz beim
//! Schreiben nie einen halben Bestand hinterlässt.
//!
//! Eine unlesbare `data.json` wird NICHT stillschweigend überschrieben: Sie
//! wird vorher als `data.json.corrupt-<Zeitstempel>` gesichert, dann startet
//! die App mit leerem Bestand. So geht nach einem Fehler nichts verloren.

use std::io::Write;
use std::path::{Path, PathBuf};
use timelog_core::{Data, Person};

pub fn data_file(dir: &Path) -> PathBuf {
    dir.join("data.json")
}

pub fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let mut tmp_name = path.file_name().map(|n| n.to_os_string()).unwrap_or_default();
    tmp_name.push(".tmp");
    let tmp = path.with_file_name(tmp_name);
    let written = (|| {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        // Inhalt auf die Platte, bevor umbenannt wird — sonst kann nach einem
        // Stromausfall eine leere Datei unter dem alten Namen liegen.
        f.sync_all()
    })();
    if let Err(e) = written {
        // Halb geschriebene Temp-Datei (z. B. Platte voll) nicht liegen lassen.
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    // std::fs::rename ersetzt das Ziel auch unter Windows (MoveFileExW mit
    // MOVEFILE_REPLACE_EXISTING). Dort hält der Virenscanner (oder ein
    // Sync-Client) die frisch geschriebene Datei oft für einige Millisekunden
    // offen — das Umbenennen scheitert dann mit „Zugriff verweigert“. Daher
    // kurz wiederholen, bevor der Fehler gemeldet wird.
    let mut last = None;
    for attempt in 0..RENAME_ATTEMPTS {
        match std::fs::rename(&tmp, path) {
            Ok(()) => return Ok(()),
            Err(e) => {
                last = Some(e);
                if attempt + 1 < RENAME_ATTEMPTS {
                    std::thread::sleep(std::time::Duration::from_millis(40 * (attempt as u64 + 1)));
                }
            }
        }
    }
    let _ = std::fs::remove_file(&tmp);
    Err(last.unwrap_or_else(|| std::io::Error::other("rename")))
}

/// Versuche für das Umbenennen (insgesamt höchstens ~0,4 s Wartezeit).
const RENAME_ATTEMPTS: u32 = if cfg!(windows) { 5 } else { 1 };

/// Unlesbare Datei beiseitelegen (`<name>.corrupt-<YYYYmmdd-HHMMSS>`).
pub fn backup_corrupt(path: &Path) -> Option<PathBuf> {
    let mut name = path.file_name()?.to_os_string();
    name.push(format!(".corrupt-{}", chrono::Local::now().format("%Y%m%d-%H%M%S")));
    let target = path.with_file_name(name);
    std::fs::copy(path, &target).ok().map(|_| target)
}

/// Verständlicher Text zu einem Dateifehler (Sprache der Oberfläche), der
/// Originaltext des Systems bleibt in Klammern dahinter.
pub fn io_hint(e: &std::io::Error, en: bool) -> String {
    let hint = match e.raw_os_error() {
        // Windows: ERROR_SHARING_VIOLATION / ERROR_LOCK_VIOLATION — Datei ist in
        // Excel, im Virenscanner oder im OneDrive-Client geöffnet.
        Some(32) | Some(33) if cfg!(windows) => Some(if en {
            "The file is open in another program (e.g. Excel, antivirus, OneDrive) — close it and try again"
        } else {
            "Die Datei ist in einem anderen Programm geöffnet (z. B. Excel, Virenscanner, OneDrive) — bitte schließen und erneut versuchen"
        }),
        // ERROR_DISK_FULL / ERROR_HANDLE_DISK_FULL bzw. ENOSPC
        Some(112) | Some(39) if cfg!(windows) => Some(if en { "Not enough disk space" } else { "Nicht genug Speicherplatz" }),
        Some(28) if !cfg!(windows) => Some(if en { "Not enough disk space" } else { "Nicht genug Speicherplatz" }),
        _ => None,
    };
    let hint = hint.or(match e.kind() {
        std::io::ErrorKind::PermissionDenied => Some(if en { "No permission to write here" } else { "Keine Berechtigung für diesen Ort" }),
        std::io::ErrorKind::NotFound => Some(if en { "File or folder not found" } else { "Datei oder Ordner nicht gefunden" }),
        std::io::ErrorKind::ReadOnlyFilesystem => Some(if en { "The drive is read-only" } else { "Das Laufwerk ist schreibgeschützt" }),
        std::io::ErrorKind::StorageFull => Some(if en { "Not enough disk space" } else { "Nicht genug Speicherplatz" }),
        _ => None,
    });
    match hint {
        Some(h) => format!("{h} ({e})"),
        None => e.to_string(),
    }
}

pub fn load(dir: &Path, language: &str) -> Data {
    let path = data_file(dir);
    let mut data: Data = match std::fs::read_to_string(&path) {
        Ok(s) => match serde_json::from_str(&s) {
            Ok(d) => d,
            Err(e) => {
                let saved = backup_corrupt(&path);
                eprintln!("timelog: data.json unlesbar ({e}) — gesichert als {saved:?}, starte leer");
                Data::default()
            }
        },
        Err(_) => Data::default(),
    };
    ensure_me(&mut data, language);
    data
}

/// Stellt sicher, dass es die eigene Person gibt (einfacher Modus: genau eine).
pub fn ensure_me(data: &mut Data, language: &str) {
    let me_exists = !data.me_person_id.is_empty() && data.person(&data.me_person_id).is_some();
    if me_exists {
        return;
    }
    if let Some(first) = data.persons.first() {
        data.me_person_id = first.id.clone();
        return;
    }
    let id = uuid::Uuid::new_v4().to_string();
    data.persons.push(Person {
        id: id.clone(),
        name: if language == "de" { "Ich" } else { "Me" }.into(),
        updated_at: chrono::Utc::now().to_rfc3339(),
        ..Person::default()
    });
    data.me_person_id = id;
}

pub fn save(dir: &Path, data: &Data) -> std::io::Result<()> {
    let json = serde_json::to_string_pretty(data).map_err(std::io::Error::other)?;
    write_atomic(&data_file(dir), json.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmpdir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("timelog-store-{tag}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn save_and_load_roundtrip() {
        let dir = tmpdir("rt");
        let mut d = Data::default();
        ensure_me(&mut d, "de");
        assert_eq!(d.persons[0].name, "Ich");
        save(&dir, &d).unwrap();
        save(&dir, &d).unwrap(); // Ersetzen einer vorhandenen Datei (Windows!)
        let back = load(&dir, "en");
        assert_eq!(back, d);
        assert!(!dir.join("data.json.tmp").exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn corrupt_file_is_backed_up_not_lost() {
        let dir = tmpdir("corrupt");
        std::fs::write(data_file(&dir), b"{ kaputt").unwrap();
        let d = load(&dir, "en");
        assert_eq!(d.persons.len(), 1);
        assert_eq!(d.persons[0].name, "Me");
        let backups: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().starts_with("data.json.corrupt-"))
            .collect();
        assert_eq!(backups.len(), 1);
        assert_eq!(std::fs::read(backups[0].path()).unwrap(), b"{ kaputt");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn missing_file_starts_empty_with_me() {
        let dir = tmpdir("missing");
        let d = load(&dir, "de");
        assert_eq!(d.persons.len(), 1);
        assert_eq!(d.me_person_id, d.persons[0].id);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
