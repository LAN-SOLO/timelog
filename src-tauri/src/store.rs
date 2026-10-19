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

pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut tmp_name = path.file_name().map(|n| n.to_os_string()).unwrap_or_default();
    tmp_name.push(".tmp");
    let tmp = path.with_file_name(tmp_name);
    {
        let mut f = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
        f.write_all(bytes).map_err(|e| e.to_string())?;
        // Inhalt auf die Platte, bevor umbenannt wird — sonst kann nach einem
        // Stromausfall eine leere Datei unter dem alten Namen liegen.
        f.sync_all().map_err(|e| e.to_string())?;
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
    Err(last.map(|e| e.to_string()).unwrap_or_default())
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

pub fn save(dir: &Path, data: &Data) -> Result<(), String> {
    let json = serde_json::to_string_pretty(data).map_err(|e| e.to_string())?;
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
