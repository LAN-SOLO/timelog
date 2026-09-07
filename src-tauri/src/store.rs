//! Datenbestand als eine JSON-Datei (`data.json`) im App-Datenordner —
//! atomar geschrieben (Temp-Datei + rename), damit ein Absturz beim Schreiben
//! nie einen halben Bestand hinterlässt.

use std::path::{Path, PathBuf};
use timelog_core::{Data, Person};

pub fn data_file(dir: &Path) -> PathBuf {
    dir.join("data.json")
}

pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, bytes).map_err(|e| format!("Schreiben fehlgeschlagen: {e}"))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("Umbenennen fehlgeschlagen: {e}"))
}

pub fn load(dir: &Path, language: &str) -> Data {
    let mut data: Data = std::fs::read_to_string(data_file(dir))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
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
