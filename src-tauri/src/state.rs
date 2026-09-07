use crate::settings::Settings;
use std::path::PathBuf;
use std::sync::Mutex;
use timelog_core::Data;

pub struct AppState {
    pub settings: Mutex<Settings>,
    pub data: Mutex<Data>,
    pub data_dir: PathBuf,
}
