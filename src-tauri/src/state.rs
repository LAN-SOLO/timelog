use crate::settings::Settings;
use std::path::PathBuf;
use std::sync::Mutex;
use timelog_core::Data;

pub struct AppState {
    pub settings: Mutex<Settings>,
    pub data: Mutex<Data>,
    pub data_dir: PathBuf,
    /// `data.json` war beim Start vorhanden, aber nicht lesbar (gesperrt,
    /// keine Berechtigung): Dann wird bis zum Neustart nichts gespeichert,
    /// sonst überschriebe der leere Stand den echten Bestand.
    pub load_error: Option<std::io::Error>,
}
