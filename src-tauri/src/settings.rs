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

impl Settings {
    /// Werte aus dem Frontend auf gültige Bereiche bringen — die Datei wird
    /// sonst mit Unsinn gespeichert und z. B. eine Rundung von 7 Minuten
    /// würde Summen und Exporte verfälschen.
    pub fn sanitized(mut self) -> Settings {
        let d = Settings::default();
        if self.language != "de" && self.language != "en" {
            self.language = d.language;
        }
        if self.mode != "simple" && self.mode != "expert" {
            self.mode = d.mode;
        }
        if self.theme != "dark" && self.theme != "light" {
            self.theme = d.theme;
        }
        if !["blue", "emerald", "violet", "amber"].contains(&self.accent.as_str()) {
            self.accent = d.accent;
        }
        if ![0, 5, 15].contains(&self.rounding) {
            self.rounding = 0;
        }
        if self.week_start != "monday" && self.week_start != "sunday" {
            self.week_start = d.week_start;
        }
        if !self.weekly_hours.is_finite() {
            self.weekly_hours = 0.0;
        }
        self.weekly_hours = self.weekly_hours.clamp(0.0, 168.0);
        self.idle_minutes = self.idle_minutes.min(240);
        self.end_of_day_hour = self.end_of_day_hour.min(23);
        self.company_name = self.company_name.chars().take(200).collect();
        self
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
    let path = settings_path(app);
    match std::fs::read_to_string(&path) {
        Ok(s) => match serde_json::from_str::<Settings>(&s) {
            Ok(v) => v.sanitized(),
            Err(e) => {
                eprintln!("timelog: settings.json unlesbar ({e}) — Standardwerte, Original gesichert");
                crate::store::backup_corrupt(&path);
                Settings::default()
            }
        },
        Err(_) => Settings::default(),
    }
}

pub fn store(app: &tauri::AppHandle, settings: &Settings) {
    if let Ok(json) = serde_json::to_string_pretty(settings) {
        let _ = crate::store::write_atomic(&settings_path(app), json.as_bytes());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitized_clamps_and_resets() {
        let s = Settings {
            language: "fr".into(),
            mode: "pro".into(),
            theme: "neon".into(),
            accent: "pink".into(),
            rounding: 7,
            week_start: "friday".into(),
            weekly_hours: f64::NAN,
            idle_minutes: 9999,
            end_of_day_hour: 30,
            company_name: "x".repeat(500),
            ..Settings::default()
        }
        .sanitized();
        assert!(s.language == "de" || s.language == "en");
        assert_eq!(s.mode, "simple");
        assert_eq!(s.theme, "dark");
        assert_eq!(s.accent, "blue");
        assert_eq!(s.rounding, 0);
        assert_eq!(s.week_start, "monday");
        assert_eq!(s.weekly_hours, 0.0);
        assert_eq!(s.idle_minutes, 240);
        assert_eq!(s.end_of_day_hour, 23);
        assert_eq!(s.company_name.chars().count(), 200);
        let ok = Settings { rounding: 15, weekly_hours: 37.5, language: "en".into(), ..Settings::default() }.sanitized();
        assert_eq!(ok.rounding, 15);
        assert_eq!(ok.weekly_hours, 37.5);
        assert_eq!(ok.language, "en");
    }
}
