//! Tauri-Commands — Vertrag: `src/api.ts`. Alle Schreibzugriffe geben den
//! kompletten (kleinen) Datenbestand zurück, das Frontend ersetzt seinen State.

use crate::settings::{self, Settings};
use crate::state::AppState;
use crate::store::{self, io_hint};
use base64::Engine;
use chrono::{Local, Utc};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};
use timelog_core::{
    budget_usage, entries_csv, entry_week_start, merge_into, parse_rfc3339, summarize, summary_csv, BudgetUsage, Client, Data, Entry, Filter, GroupBy, MergeReport, Package, Person, Project, Range, Summary, Task,
    WeekLock, WeekStart, WeekTotal,
};

type Shared = Arc<AppState>;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfoDto {
    pub version: String,
    pub notes: Option<String>,
    pub date: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub report: MergeReport,
    pub data: Data,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimerStart {
    pub project_id: String,
    pub task_id: Option<String>,
    pub note: String,
    pub person_id: Option<String>,
}

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn range_from(from: &str, to: &str, en: bool) -> Result<Range, String> {
    let from = parse_rfc3339(from).ok_or_else(|| tr(en, "Ungültiger Zeitraum (von)", "Invalid range (from)"))?;
    let to = parse_rfc3339(to).ok_or_else(|| tr(en, "Ungültiger Zeitraum (bis)", "Invalid range (to)"))?;
    if to < from {
        return Err(tr(en, "Zeitraum: „bis“ liegt vor „von“", "Range: “to” is before “from”"));
    }
    Ok(Range { from, to })
}

/// Meldung in der eingestellten Sprache (Fehler landen als Toast in der Oberfläche).
fn tr(en: bool, de: &str, english: &str) -> String {
    if en { english } else { de }.to_string()
}

fn is_en(st: &Shared) -> bool {
    lock(&st.settings).language != "de"
}

/// Mutex sperren — auch nach einem Panic in einem anderen Kommando (Poisoning)
/// bleibt die App bedienbar, statt bei jedem weiteren Aufruf abzustürzen.
fn lock<T>(m: &std::sync::Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Änderung am Bestand ausführen, speichern, Bestand zurückgeben.
/// Transaktional: geändert wird eine Kopie; erst wenn Prüfung UND Speichern
/// klappen, ersetzt sie den Bestand im Speicher. Ein Fehler (z. B. volle
/// Platte, gesperrte Datei unter Windows) hinterlässt keinen halben Zustand.
fn mutate(st: &Shared, f: impl FnOnce(&mut Data) -> Result<(), String>) -> Result<Data, String> {
    let en = is_en(st);
    let mut data = lock(&st.data);
    let mut next = data.clone();
    f(&mut next)?;
    store::save(&st.data_dir, &next).map_err(|e| format!("{}: {}", tr(en, "Speichern fehlgeschlagen", "Saving failed"), io_hint(&e, en)))?;
    *data = next;
    Ok(data.clone())
}

fn week_start_setting(st: &Shared) -> WeekStart {
    WeekStart::parse(&st.settings.lock().unwrap_or_else(|e| e.into_inner()).week_start)
}

fn rounding(st: &Shared) -> u32 {
    st.settings.lock().unwrap_or_else(|e| e.into_inner()).rounding
}

fn lang(st: &Shared) -> String {
    st.settings.lock().unwrap_or_else(|e| e.into_inner()).language.clone()
}

fn simple_mode(st: &Shared) -> bool {
    st.settings.lock().unwrap_or_else(|e| e.into_inner()).mode != "expert"
}

fn entry_locked(data: &Data, e: &Entry, ws: WeekStart) -> bool {
    e.locked
        || entry_week_start(e, ws)
            .map(|w| data.is_week_locked(&e.person_id, &w))
            .unwrap_or(false)
}

// --- settings ---------------------------------------------------------------

#[tauri::command]
pub async fn get_settings(st: State<'_, Shared>) -> Result<Settings, String> {
    Ok(lock(&st.settings).clone())
}

#[tauri::command]
pub async fn set_settings(app: AppHandle, st: State<'_, Shared>, settings: Settings) -> Result<(), String> {
    let settings = settings.sanitized();
    // Sperre über das Schreiben halten: zwei gleichzeitige Aufrufe würden
    // sonst dieselbe settings.json.tmp beschreiben. Ein Schreibfehler wird
    // gemeldet (Sprache der NEUEN Einstellung), der alte Stand bleibt aktiv.
    let mut cur = lock(&st.settings);
    let en = settings.language != "de";
    settings::store(&app, &settings).map_err(|e| format!("{}: {}", tr(en, "Einstellungen nicht gespeichert", "Settings not saved"), io_hint(&e, en)))?;
    *cur = settings;
    Ok(())
}

// --- data -------------------------------------------------------------------

#[tauri::command]
pub async fn get_data(st: State<'_, Shared>) -> Result<Data, String> {
    Ok(lock(&st.data).clone())
}

#[tauri::command]
pub async fn save_person(st: State<'_, Shared>, mut person: Person) -> Result<Data, String> {
    let en = is_en(&st);
    if person.name.trim().is_empty() {
        return Err(tr(en, "Bitte einen Namen angeben.", "Please enter a name."));
    }
    mutate(&st, |d| {
        person.updated_at = now_iso();
        if person.id.is_empty() {
            person.id = new_id();
            d.persons.push(person);
        } else if let Some(p) = d.persons.iter_mut().find(|p| p.id == person.id) {
            *p = person;
        } else {
            d.persons.push(person);
        }
        Ok(())
    })
}

#[tauri::command]
pub async fn delete_person(st: State<'_, Shared>, id: String) -> Result<Data, String> {
    let en = is_en(&st);
    mutate(&st, |d| {
        if d.me_person_id == id {
            return Err(tr(en, "Die eigene Person kann nicht gelöscht werden.", "You cannot delete yourself."));
        }
        if d.entries.iter().any(|e| e.person_id == id) {
            return Err(tr(en, "Diese Person hat Einträge — bitte archivieren statt löschen.", "This person has entries — archive instead of deleting."));
        }
        d.persons.retain(|p| p.id != id);
        d.locks.retain(|l| l.person_id != id);
        Ok(())
    })
}

#[tauri::command]
pub async fn save_client(st: State<'_, Shared>, mut client: Client) -> Result<Data, String> {
    let en = is_en(&st);
    if client.name.trim().is_empty() {
        return Err(tr(en, "Bitte einen Namen angeben.", "Please enter a name."));
    }
    mutate(&st, |d| {
        client.updated_at = now_iso();
        if client.id.is_empty() {
            client.id = new_id();
            d.clients.push(client);
        } else if let Some(c) = d.clients.iter_mut().find(|c| c.id == client.id) {
            *c = client;
        } else {
            d.clients.push(client);
        }
        Ok(())
    })
}

#[tauri::command]
pub async fn delete_client(st: State<'_, Shared>, id: String) -> Result<Data, String> {
    mutate(&st, |d| {
        d.clients.retain(|c| c.id != id);
        let now = now_iso();
        for p in d.projects.iter_mut().filter(|p| p.client_id.as_deref() == Some(id.as_str())) {
            p.client_id = None;
            p.updated_at = now.clone();
        }
        Ok(())
    })
}

#[tauri::command]
pub async fn save_project(st: State<'_, Shared>, mut project: Project) -> Result<Data, String> {
    let en = is_en(&st);
    if project.name.trim().is_empty() {
        return Err(tr(en, "Bitte einen Projektnamen angeben.", "Please enter a project name."));
    }
    mutate(&st, |d| {
        if let Some(c) = &project.client_id {
            if c.is_empty() {
                project.client_id = None;
            } else if d.client(c).is_none() {
                return Err(tr(en, "Kunde nicht gefunden.", "Client not found."));
            }
        }
        project.updated_at = now_iso();
        if project.id.is_empty() {
            project.id = new_id();
            d.projects.push(project);
        } else if let Some(p) = d.projects.iter_mut().find(|p| p.id == project.id) {
            *p = project;
        } else {
            d.projects.push(project);
        }
        Ok(())
    })
}

#[tauri::command]
pub async fn delete_project(st: State<'_, Shared>, id: String) -> Result<Data, String> {
    let en = is_en(&st);
    mutate(&st, |d| {
        if d.entries.iter().any(|e| e.project_id == id) {
            return Err(tr(en, "Dieses Projekt hat Einträge — bitte archivieren statt löschen.", "This project has entries — archive instead of deleting."));
        }
        d.projects.retain(|p| p.id != id);
        d.tasks.retain(|t| t.project_id != id);
        Ok(())
    })
}

#[tauri::command]
pub async fn save_task(st: State<'_, Shared>, mut task: Task) -> Result<Data, String> {
    let en = is_en(&st);
    if task.name.trim().is_empty() {
        return Err(tr(en, "Bitte einen Namen angeben.", "Please enter a name."));
    }
    mutate(&st, |d| {
        if d.project(&task.project_id).is_none() {
            return Err(tr(en, "Projekt nicht gefunden.", "Project not found."));
        }
        task.updated_at = now_iso();
        if task.id.is_empty() {
            task.id = new_id();
            d.tasks.push(task);
        } else if let Some(t) = d.tasks.iter_mut().find(|t| t.id == task.id) {
            *t = task;
        } else {
            d.tasks.push(task);
        }
        Ok(())
    })
}

#[tauri::command]
pub async fn delete_task(st: State<'_, Shared>, id: String) -> Result<Data, String> {
    mutate(&st, |d| {
        d.tasks.retain(|t| t.id != id);
        let now = now_iso();
        for e in d.entries.iter_mut().filter(|e| e.task_id.as_deref() == Some(id.as_str())) {
            e.task_id = None;
            e.updated_at = now.clone();
        }
        Ok(())
    })
}

// --- entries ----------------------------------------------------------------

#[tauri::command]
pub async fn save_entry(st: State<'_, Shared>, mut entry: Entry) -> Result<Data, String> {
    let en = is_en(&st);
    let ws = week_start_setting(&st);
    mutate(&st, |d| {
        if d.project(&entry.project_id).is_none() {
            return Err(tr(en, "Bitte ein Projekt wählen.", "Please choose a project."));
        }
        if entry.person_id.is_empty() || d.person(&entry.person_id).is_none() {
            entry.person_id = d.me_person_id.clone();
        }
        if let Some(t) = &entry.task_id {
            if t.is_empty() {
                entry.task_id = None;
            } else if d.task(t).map(|t| t.project_id != entry.project_id).unwrap_or(true) {
                entry.task_id = None;
            }
        }
        let start = parse_rfc3339(&entry.start).ok_or_else(|| tr(en, "Ungültige Startzeit.", "Invalid start time."))?;
        if let Some(end) = &entry.end {
            let end = parse_rfc3339(end).ok_or_else(|| tr(en, "Ungültige Endzeit.", "Invalid end time."))?;
            if end < start {
                return Err(tr(en, "Das Ende liegt vor dem Start.", "End is before start."));
            }
        }
        entry.tags = entry
            .tags
            .iter()
            .map(|t| t.trim().to_string())
            .filter(|t| !t.is_empty())
            .collect();
        // Sperren: weder aus einer gesperrten Woche heraus noch in eine hinein ändern.
        if let Some(existing) = d.entries.iter().find(|e| e.id == entry.id) {
            if entry_locked(d, existing, ws) {
                return Err(tr(en, "Diese Woche ist abgeschlossen — zuerst wieder öffnen.", "This week is closed — reopen it first."));
            }
        }
        entry.locked = false;
        if entry_locked(d, &entry, ws) {
            return Err(tr(en, "Die Zielwoche ist abgeschlossen — zuerst wieder öffnen.", "The target week is closed — reopen it first."));
        }
        // Nur ein laufender Timer je Person.
        if entry.end.is_none() {
            let now = now_iso();
            for e in d
                .entries
                .iter_mut()
                .filter(|e| e.id != entry.id && e.person_id == entry.person_id && e.end.is_none())
            {
                e.end = Some(now.clone());
                e.updated_at = now.clone();
            }
        }
        entry.updated_at = now_iso();
        if entry.id.is_empty() {
            entry.id = new_id();
            d.entries.push(entry);
        } else if let Some(e) = d.entries.iter_mut().find(|e| e.id == entry.id) {
            *e = entry;
        } else {
            d.entries.push(entry);
        }
        Ok(())
    })
}

#[tauri::command]
pub async fn delete_entry(st: State<'_, Shared>, id: String) -> Result<Data, String> {
    let en = is_en(&st);
    let ws = week_start_setting(&st);
    mutate(&st, |d| {
        if let Some(e) = d.entries.iter().find(|e| e.id == id) {
            if entry_locked(d, e, ws) {
                return Err(tr(en, "Diese Woche ist abgeschlossen — zuerst wieder öffnen.", "This week is closed — reopen it first."));
            }
        }
        d.entries.retain(|e| e.id != id);
        Ok(())
    })
}

#[tauri::command]
pub async fn start_timer(st: State<'_, Shared>, input: TimerStart) -> Result<Data, String> {
    let en = is_en(&st);
    let ws = week_start_setting(&st);
    mutate(&st, |d| {
        let project = d.project(&input.project_id).ok_or_else(|| tr(en, "Bitte ein Projekt wählen.", "Please choose a project."))?.clone();
        if project.archived {
            return Err(tr(en, "Das Projekt ist archiviert.", "The project is archived."));
        }
        let person_id = input
            .person_id
            .filter(|p| !p.is_empty() && d.person(p).is_some())
            .unwrap_or_else(|| d.me_person_id.clone());
        let task = input
            .task_id
            .as_deref()
            .filter(|t| !t.is_empty())
            .and_then(|t| d.task(t))
            .filter(|t| t.project_id == project.id)
            .cloned();
        // Nur ein laufender Timer je Person — laufende Einträge anderer
        // Personen (z. B. aus einem importierten Team-Paket) bleiben unberührt.
        let now = now_iso();
        for e in d.entries.iter_mut().filter(|e| e.end.is_none() && e.person_id == person_id) {
            e.end = Some(now.clone());
            e.updated_at = now.clone();
        }
        let entry = Entry {
            id: new_id(),
            person_id,
            project_id: project.id.clone(),
            task_id: task.as_ref().map(|t| t.id.clone()),
            start: now.clone(),
            end: None,
            note: input.note.trim().to_string(),
            billable: task.map(|t| t.billable_default).unwrap_or(project.billable_default),
            tags: Vec::new(),
            locked: false,
            updated_at: now,
        };
        if entry_locked(d, &entry, ws) {
            return Err(tr(en, "Die aktuelle Woche ist abgeschlossen — zuerst wieder öffnen.", "The current week is closed — reopen it first."));
        }
        d.entries.push(entry);
        Ok(())
    })
}

/// Stoppt den Timer der eigenen Person (die Kopfzeile zeigt nur diesen).
#[tauri::command]
pub async fn stop_timer(st: State<'_, Shared>) -> Result<Data, String> {
    mutate(&st, |d| {
        let now = now_iso();
        let me = d.me_person_id.clone();
        for e in d.entries.iter_mut().filter(|e| e.end.is_none() && e.person_id == me) {
            e.end = Some(now.clone());
            e.updated_at = now.clone();
        }
        Ok(())
    })
}

#[tauri::command]
pub async fn running(st: State<'_, Shared>) -> Result<Option<Entry>, String> {
    let data = lock(&st.data);
    Ok(data.entries.iter().find(|e| e.end.is_none() && e.person_id == data.me_person_id).cloned())
}

// --- reports ----------------------------------------------------------------

#[tauri::command]
pub async fn summary(
    st: State<'_, Shared>,
    from: String,
    to: String,
    group_by: String,
    filter: Filter,
) -> Result<Summary, String> {
    let range = range_from(&from, &to, is_en(&st))?;
    let data = st.data.lock().unwrap_or_else(|e| e.into_inner());
    Ok(summarize(&data, &range, GroupBy::parse(&group_by), &filter, rounding(&st), Utc::now()))
}

#[tauri::command]
pub async fn weekly_totals(st: State<'_, Shared>, weeks: u32, filter: Filter) -> Result<Vec<WeekTotal>, String> {
    let data = st.data.lock().unwrap_or_else(|e| e.into_inner());
    Ok(timelog_core::weekly_totals(
        &data,
        Local::now().date_naive(),
        weeks.clamp(1, 52),
        week_start_setting(&st),
        &filter,
        rounding(&st),
        Utc::now(),
    ))
}

#[tauri::command]
pub async fn budget_usages(st: State<'_, Shared>) -> Result<Vec<BudgetUsage>, String> {
    let data = st.data.lock().unwrap_or_else(|e| e.into_inner());
    let r = rounding(&st);
    let now = Utc::now();
    Ok(data.projects
        .iter()
        .filter(|p| !p.archived)
        .map(|p| budget_usage(&data, p, r, now))
        .collect())
}

/// CSV erzeugen — `kind`: "entries" | "summary". Speichern übernimmt das
/// Frontend über den Dialog + `write_text_file`.
#[tauri::command]
pub async fn export_csv(
    st: State<'_, Shared>,
    from: String,
    to: String,
    kind: String,
    group_by: String,
    filter: Filter,
) -> Result<String, String> {
    let range = range_from(&from, &to, is_en(&st))?;
    let data = st.data.lock().unwrap_or_else(|e| e.into_inner());
    let lang = lang(&st);
    let delim = if lang == "de" { ';' } else { ',' };
    let simple = simple_mode(&st);
    let r = rounding(&st);
    let now = Utc::now();
    if kind == "summary" {
        let by = GroupBy::parse(&group_by);
        let s = summarize(&data, &range, by, &filter, r, now);
        Ok(summary_csv(&s, by, &lang, delim, simple))
    } else {
        let refs: Vec<&Entry> = data.entries.iter().filter(|e| filter.matches(&data, e)).collect();
        Ok(entries_csv(&data, &refs, &range, r, &lang, delim, simple, now))
    }
}

// --- team package -----------------------------------------------------------

/// Eigene (oder alle) Daten als JSON-Paket für die Zusammenführung beim PL.
#[tauri::command]
pub async fn export_package(st: State<'_, Shared>, person_id: Option<String>) -> Result<String, String> {
    let data = st.data.lock().unwrap_or_else(|e| e.into_inner());
    let mut out = data.clone();
    if let Some(p) = person_id.filter(|p| !p.is_empty()) {
        out.entries.retain(|e| e.person_id == p);
        out.locks.retain(|l| l.person_id == p);
        out.persons.retain(|x| x.id == p);
    }
    let pkg = Package::new(out, now_iso());
    serde_json::to_string_pretty(&pkg).map_err(|e| format!("{}: {e}", tr(is_en(&st), "Export fehlgeschlagen", "Export failed")))
}

#[tauri::command]
pub async fn import_package(st: State<'_, Shared>, json: String) -> Result<ImportResult, String> {
    let pkg = Package::parse_localized(&json, is_en(&st))?;
    let mut report = MergeReport::default();
    let data = mutate(&st, |d| {
        report = merge_into(d, &pkg.data);
        Ok(())
    })?;
    Ok(ImportResult { report, data })
}

// --- week locks -------------------------------------------------------------

#[tauri::command]
pub async fn lock_week(st: State<'_, Shared>, person_id: String, week_start: String) -> Result<Data, String> {
    let en = is_en(&st);
    let ws = week_start_setting(&st);
    mutate(&st, |d| {
        if d.person(&person_id).is_none() {
            return Err(tr(en, "Person nicht gefunden.", "Person not found."));
        }
        if !d.is_week_locked(&person_id, &week_start) {
            d.locks.push(WeekLock {
                person_id: person_id.clone(),
                week_start: week_start.clone(),
            });
        }
        let now = now_iso();
        for e in d.entries.iter_mut().filter(|e| e.person_id == person_id) {
            if entry_week_start(e, ws).as_deref() == Some(week_start.as_str()) {
                if e.end.is_none() {
                    e.end = Some(now.clone());
                }
                e.locked = true;
                e.updated_at = now.clone();
            }
        }
        Ok(())
    })
}

#[tauri::command]
pub async fn unlock_week(st: State<'_, Shared>, person_id: String, week_start: String) -> Result<Data, String> {
    let ws = week_start_setting(&st);
    mutate(&st, |d| {
        d.locks
            .retain(|l| !(l.person_id == person_id && l.week_start == week_start));
        let now = now_iso();
        for e in d.entries.iter_mut().filter(|e| e.person_id == person_id && e.locked) {
            if entry_week_start(e, ws).as_deref() == Some(week_start.as_str()) {
                e.locked = false;
                e.updated_at = now.clone();
            }
        }
        Ok(())
    })
}

// --- files ------------------------------------------------------------------
//
// Die Pfade kommen aus dem Speichern-/Öffnen-Dialog des Frontends. Weil jedes
// Skript im WebView diese Kommandos aufrufen könnte, gelten harte Grenzen:
// nur absolute Pfade, nur die Dateitypen, die timelog wirklich schreibt bzw.
// liest, nur reguläre Dateien und eine Größengrenze beim Lesen.

/// Größte Datei, die `read_text_file` liest (Team-Paket / Backup).
pub const MAX_READ_BYTES: u64 = 64 * 1024 * 1024;

/// Prüft einen Pfad aus dem Dialog: absolut und mit erlaubter Endung
/// (Groß-/Kleinschreibung egal — Windows liefert gern `.CSV`).
pub fn checked_path(path: &str, allowed: &[&str], en: bool) -> Result<PathBuf, String> {
    let p = PathBuf::from(path);
    if path.trim().is_empty() || !p.is_absolute() {
        return Err(tr(en, "Ungültiger Dateipfad.", "Invalid file path."));
    }
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    if !allowed.contains(&ext.as_str()) {
        let list = allowed.iter().map(|e| format!(".{e}")).collect::<Vec<_>>().join(", ");
        return Err(format!("{} {list}", tr(en, "Dateityp nicht erlaubt — erlaubt:", "File type not allowed — allowed:")));
    }
    if cfg!(windows) {
        let name = p.file_name().and_then(|n| n.to_str()).unwrap_or_default();
        if windows_name_problem(name) {
            return Err(tr(
                en,
                "Dieser Dateiname ist unter Windows nicht erlaubt (reservierter Name wie CON/NUL oder Zeichen \\ / : * ? \" < > |).",
                "This file name is not allowed on Windows (reserved name like CON/NUL or one of \\ / : * ? \" < > |).",
            ));
        }
    }
    if p.is_dir() {
        return Err(tr(en, "Das Ziel ist ein Ordner.", "The target is a folder."));
    }
    Ok(p)
}

/// Ist `name` (letzte Pfadkomponente) unter Windows unzulässig? Reservierte
/// Gerätenamen gelten auch mit Endung („NUL.csv“ schreibt sonst ins Nichts
/// bzw. auf ein Gerät), dazu verbotene Zeichen, Steuerzeichen sowie Punkt
/// oder Leerzeichen am Ende (Windows schneidet sie stillschweigend ab).
pub fn windows_name_problem(name: &str) -> bool {
    if name.is_empty() || name.ends_with('.') || name.ends_with(' ') {
        return true;
    }
    if name.chars().any(|c| c < ' ' || matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*')) {
        return true;
    }
    let stem = name.split('.').next().unwrap_or_default().trim_end().to_ascii_uppercase();
    const RESERVED: [&str; 6] = ["CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$"];
    if RESERVED.contains(&stem.as_str()) {
        return true;
    }
    let numbered = |prefix: &str| {
        stem.strip_prefix(prefix)
            .map(|rest| matches!(rest, "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "\u{b9}" | "\u{b2}" | "\u{b3}"))
            .unwrap_or(false)
    };
    numbered("COM") || numbered("LPT")
}

#[tauri::command]
pub async fn read_text_file(st: State<'_, Shared>, path: String) -> Result<String, String> {
    let en = is_en(&st);
    let p = checked_path(&path, &["json"], en)?;
    let fail = |e: std::io::Error| format!("{}: {}", tr(en, "Lesen fehlgeschlagen", "Reading failed"), io_hint(&e, en));
    let meta = std::fs::metadata(&p).map_err(fail)?;
    if !meta.is_file() {
        return Err(tr(en, "Keine reguläre Datei.", "Not a regular file."));
    }
    if meta.len() > MAX_READ_BYTES {
        return Err(tr(en, "Datei zu groß (max. 64 MB).", "File too large (max. 64 MB)."));
    }
    let bytes = std::fs::read(&p).map_err(fail)?;
    decode_text(bytes).ok_or_else(|| tr(en, "Die Datei ist kein lesbarer Text (UTF-8 oder UTF-16).", "The file is not readable text (UTF-8 or UTF-16)."))
}

/// Text aus einer Datei: UTF-8 (mit oder ohne BOM — den entfernt
/// `Package::parse`) oder UTF-16 mit BOM, wie ihn der Windows-Editor bei
/// „Unicode“ schreibt.
pub fn decode_text(bytes: Vec<u8>) -> Option<String> {
    let utf16 = |rest: &[u8], le: bool| {
        let (pairs, odd) = rest.as_chunks::<2>();
        if !odd.is_empty() {
            return None;
        }
        let units: Vec<u16> = pairs
            .iter()
            .map(|&c| if le { u16::from_le_bytes(c) } else { u16::from_be_bytes(c) })
            .collect();
        String::from_utf16(&units).ok()
    };
    match bytes.as_slice() {
        [0xFF, 0xFE, rest @ ..] => utf16(rest, true),
        [0xFE, 0xFF, rest @ ..] => utf16(rest, false),
        _ => String::from_utf8(bytes).ok(),
    }
}

#[tauri::command]
pub async fn write_text_file(st: State<'_, Shared>, path: String, content: String) -> Result<(), String> {
    let en = is_en(&st);
    let p = checked_path(&path, &["csv", "json"], en)?;
    std::fs::write(&p, content.as_bytes()).map_err(|e| format!("{}: {}", tr(en, "Schreiben fehlgeschlagen", "Writing failed"), io_hint(&e, en)))
}

#[tauri::command]
pub async fn write_file(st: State<'_, Shared>, path: String, data_base64: String) -> Result<(), String> {
    let en = is_en(&st);
    let p = checked_path(&path, &["pdf"], en)?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_base64)
        .map_err(|e| format!("{}: {e}", tr(en, "Ungültige Daten", "Invalid data")))?;
    std::fs::write(&p, bytes).map_err(|e| format!("{}: {}", tr(en, "Schreiben fehlgeschlagen", "Writing failed"), io_hint(&e, en)))
}

// --- misc -------------------------------------------------------------------

#[tauri::command]
pub async fn data_path(st: State<'_, Shared>) -> Result<String, String> {
    Ok(st.data_dir.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn check_update(app: AppHandle) -> Result<Option<UpdateInfoDto>, String> {
    use tauri_plugin_updater::UpdaterExt;
    let en = app.state::<Shared>().settings.lock().unwrap_or_else(|e| e.into_inner()).language != "de";
    let updater = app.updater().map_err(|e| format!("{}: {e}", tr(en, "Update-Prüfung fehlgeschlagen", "Update check failed")))?;
    match updater.check().await {
        Ok(Some(update)) => Ok(Some(UpdateInfoDto {
            version: update.version.clone(),
            notes: update.body.clone(),
            date: update.date.map(|d| d.to_string()),
        })),
        Ok(None) => Ok(None),
        Err(e) => Err(format!("{}: {e}", tr(en, "Update-Prüfung fehlgeschlagen", "Update check failed"))),
    }
}

#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;
    let en = app.state::<Shared>().settings.lock().unwrap_or_else(|e| e.into_inner()).language != "de";
    let updater = app.updater().map_err(|e| format!("{}: {e}", tr(en, "Update-Prüfung fehlgeschlagen", "Update check failed")))?;
    let update = updater
        .check()
        .await
        .map_err(|e| format!("{}: {e}", tr(en, "Update-Prüfung fehlgeschlagen", "Update check failed")))?
        .ok_or_else(|| tr(en, "Kein Update verfügbar", "No update available"))?;
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| format!("{}: {e}", tr(en, "Update fehlgeschlagen", "Update failed")))?;
    app.restart();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn translations_follow_language() {
        assert_eq!(tr(false, "Hallo", "Hello"), "Hallo");
        assert_eq!(tr(true, "Hallo", "Hello"), "Hello");
    }

    #[test]
    fn checked_path_rules() {
        let dir = std::env::temp_dir();
        let ok = dir.join("timelog_test_export.CSV");
        assert!(checked_path(ok.to_str().unwrap(), &["csv", "json"], false).is_ok());
        let bad = dir.join("evil.sh");
        assert!(checked_path(bad.to_str().unwrap(), &["csv", "json"], true).is_err());
        let none = dir.join("no_extension");
        assert!(checked_path(none.to_str().unwrap(), &["pdf"], true).is_err());
        assert!(checked_path("relative/report.pdf", &["pdf"], true).is_err());
        assert!(checked_path("", &["pdf"], true).is_err());
        // Ordner mit passender „Endung“
        let d = dir.join("timelog_test_dir.json");
        std::fs::create_dir_all(&d).unwrap();
        assert!(checked_path(d.to_str().unwrap(), &["json"], true).is_err());
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn windows_reserved_and_invalid_names() {
        for bad in ["CON.csv", "nul.json", "Aux.pdf", "COM1.csv", "lpt9.pdf", "CON .csv", "a|b.csv", "a?.json", "x:y.pdf", "bericht.csv.", "bericht.csv ", "tab\tname.csv", ""] {
            assert!(windows_name_problem(bad), "{bad:?} sollte abgelehnt werden");
        }
        for ok in ["timelog_entries_2026-10-19_2026-10-25.csv", "Bericht März.pdf", "console.csv", "COM10.csv", "nullable.json", "Ärger & Co.json"] {
            assert!(!windows_name_problem(ok), "{ok:?} sollte erlaubt sein");
        }
    }

    #[test]
    fn decode_text_handles_bom_variants() {
        assert_eq!(decode_text(b"{}".to_vec()).unwrap(), "{}");
        assert_eq!(decode_text("\u{feff}{\"ä\":1}".as_bytes().to_vec()).unwrap(), "\u{feff}{\"ä\":1}");
        let mut le = vec![0xFF, 0xFE];
        for u in "{\"ä\":1}".encode_utf16() {
            le.extend_from_slice(&u.to_le_bytes());
        }
        assert_eq!(decode_text(le).unwrap(), "{\"ä\":1}");
        assert!(decode_text(vec![0xC3, 0x28]).is_none());
        // UTF-16 + Paket-Parser: Windows-Editor „Unicode“
        let json = format!("{{\"format\":\"timelog-package\",\"version\":1,\"exportedAt\":\"\",\"data\":{{}}}}");
        let mut le = vec![0xFF, 0xFE];
        for u in json.encode_utf16() {
            le.extend_from_slice(&u.to_le_bytes());
        }
        assert!(timelog_core::Package::parse(&decode_text(le).unwrap()).is_ok());
    }

    #[test]
    fn io_hint_is_localized() {
        let e = std::io::Error::from(std::io::ErrorKind::PermissionDenied);
        assert!(io_hint(&e, false).starts_with("Keine Berechtigung"));
        assert!(io_hint(&e, true).starts_with("No permission"));
        let other = std::io::Error::other("xyz");
        assert_eq!(io_hint(&other, true), "xyz");
    }

    #[cfg(windows)]
    #[test]
    fn checked_path_windows_reserved() {
        assert!(checked_path(r"C:\Users\a\Desktop\NUL.csv", &["csv"], false).is_err());
        assert!(checked_path(r"C:\Users\a\Desktop\Zeit März.csv", &["csv"], false).is_ok());
        let sharing = std::io::Error::from_raw_os_error(32);
        assert!(io_hint(&sharing, false).contains("anderen Programm"));
    }

    #[cfg(windows)]
    #[test]
    fn checked_path_windows_drive_letters() {
        assert!(checked_path(r"C:\Users\a\Desktop\timelog_bericht.pdf", &["pdf"], false).is_ok());
        assert!(checked_path(r"Desktop\bericht.pdf", &["pdf"], false).is_err());
    }
}
