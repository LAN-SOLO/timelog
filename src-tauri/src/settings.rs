//! App-Einstellungen als JSON im Config-Ordner der App.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    /// "de" | "en"
    pub language: String,
    /// "simple" | "expert"
    pub mode: String,
    /// "dark" | "light"
    pub theme: String,
    /// "blue" | "emerald" | "violet" | "amber"
    pub accent: String,
    pub auto_update: bool,
    /// Rundung in Minuten für Anzeige/Export: 0 | 5 | 15 — Rohdaten bleiben exakt.
    pub rounding: u32,
    /// "monday" | "sunday"
    pub week_start: String,
    /// Soll-Stunden pro Woche der eigenen Person (0 = kein Soll).
    pub weekly_hours: f64,
    /// Firmenname für PDF-Berichte.
    pub company_name: String,
    /// Leerlauf-Erkennung: Minuten ohne Eingabe bei laufendem Timer (0 = aus).
    pub idle_minutes: u32,
    /// Erinnerung bei laufendem Timer ab dieser Stunde (0 = aus).
    pub end_of_day_hour: u32,
    /// Vor dem Löschen nachfragen.
    pub confirm_delete: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            language: if sys_locale_is_german() { "de" } else { "en" }.into(),
            mode: "simple".into(),
            theme: "dark".into(),
            accent: "blue".into(),
            auto_update: false,
            rounding: 0,
            week_start: "monday".into(),
            weekly_hours: 0.0,
            company_name: String::new(),
            idle_minutes: 15,
            end_of_day_hour: 0,
            confirm_delete: true,
        }
    }
}

fn sys_locale_is_german() -> bool {
    sys_locale::get_locale()
        .map(|l| l.to_lowercase().starts_with("de"))
        .unwrap_or(false)
}

pub fn config_dir(app: &tauri::AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_config_dir()
        .unwrap_or_else(|_| dirs::config_dir().unwrap_or_default().join("timelog"));
    let _ = std::fs::create_dir_all(&dir);
    dir
}

pub fn data_dir(app: &tauri::AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| dirs::data_dir().unwrap_or_default().join("timelog"));
    let _ = std::fs::create_dir_all(&dir);
    dir
}

fn settings_path(app: &tauri::AppHandle) -> PathBuf {
    config_dir(app).join("settings.json")
}

pub fn load(app: &tauri::AppHandle) -> Settings {
    std::fs::read_to_string(settings_path(app))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn store(app: &tauri::AppHandle, settings: &Settings) {
    if let Ok(json) = serde_json::to_string_pretty(settings) {
        let _ = crate::store::write_atomic(&settings_path(app), json.as_bytes());
    }
}
