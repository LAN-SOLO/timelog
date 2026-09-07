//! Tauri-Commands — Vertrag: `src/api.ts`. Alle Schreibzugriffe geben den
//! kompletten (kleinen) Datenbestand zurück, das Frontend ersetzt seinen State.

use crate::settings::{self, Settings};
use crate::state::AppState;
use crate::store;
use base64::Engine;
use chrono::{Local, Utc};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, State};
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

fn range_from(from: &str, to: &str) -> Result<Range, String> {
    let from = parse_rfc3339(from).ok_or("Ungültiger Zeitraum (von)")?;
    let to = parse_rfc3339(to).ok_or("Ungültiger Zeitraum (bis)")?;
    if to < from {
        return Err("Zeitraum: „bis“ liegt vor „von“".into());
    }
    Ok(Range { from, to })
}

/// Änderung am Bestand ausführen, speichern, Bestand zurückgeben.
fn mutate(st: &Shared, f: impl FnOnce(&mut Data) -> Result<(), String>) -> Result<Data, String> {
    let mut data = st.data.lock().unwrap();
    f(&mut data)?;
    store::save(&st.data_dir, &data)?;
    Ok(data.clone())
}

fn week_start_setting(st: &Shared) -> WeekStart {
    WeekStart::parse(&st.settings.lock().unwrap().week_start)
}

fn rounding(st: &Shared) -> u32 {
    st.settings.lock().unwrap().rounding
}

fn lang(st: &Shared) -> String {
    st.settings.lock().unwrap().language.clone()
}

fn simple_mode(st: &Shared) -> bool {
    st.settings.lock().unwrap().mode != "expert"
}

fn entry_locked(data: &Data, e: &Entry, ws: WeekStart) -> bool {
    e.locked
        || entry_week_start(e, ws)
            .map(|w| data.is_week_locked(&e.person_id, &w))
            .unwrap_or(false)
}

// --- settings ---------------------------------------------------------------

#[tauri::command]
pub fn get_settings(st: State<'_, Shared>) -> Settings {
    st.settings.lock().unwrap().clone()
}

#[tauri::command]
pub fn set_settings(app: AppHandle, st: State<'_, Shared>, settings: Settings) {
    settings::store(&app, &settings);
    *st.settings.lock().unwrap() = settings;
}

// --- data -------------------------------------------------------------------

#[tauri::command]
pub fn get_data(st: State<'_, Shared>) -> Data {
    st.data.lock().unwrap().clone()
}

#[tauri::command]
pub fn save_person(st: State<'_, Shared>, mut person: Person) -> Result<Data, String> {
    if person.name.trim().is_empty() {
        return Err("Bitte einen Namen angeben.".into());
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
pub fn delete_person(st: State<'_, Shared>, id: String) -> Result<Data, String> {
    mutate(&st, |d| {
        if d.me_person_id == id {
            return Err("Die eigene Person kann nicht gelöscht werden.".into());
        }
        if d.entries.iter().any(|e| e.person_id == id) {
            return Err("Diese Person hat Einträge — bitte archivieren statt löschen.".into());
        }
        d.persons.retain(|p| p.id != id);
        d.locks.retain(|l| l.person_id != id);
        Ok(())
    })
}

#[tauri::command]
pub fn save_client(st: State<'_, Shared>, mut client: Client) -> Result<Data, String> {
    if client.name.trim().is_empty() {
        return Err("Bitte einen Namen angeben.".into());
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
pub fn delete_client(st: State<'_, Shared>, id: String) -> Result<Data, String> {
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
pub fn save_project(st: State<'_, Shared>, mut project: Project) -> Result<Data, String> {
    if project.name.trim().is_empty() {
        return Err("Bitte einen Projektnamen angeben.".into());
    }
    mutate(&st, |d| {
        if let Some(c) = &project.client_id {
            if c.is_empty() {
                project.client_id = None;
            } else if d.client(c).is_none() {
                return Err("Kunde nicht gefunden.".into());
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
pub fn delete_project(st: State<'_, Shared>, id: String) -> Result<Data, String> {
    mutate(&st, |d| {
        if d.entries.iter().any(|e| e.project_id == id) {
            return Err("Dieses Projekt hat Einträge — bitte archivieren statt löschen.".into());
        }
        d.projects.retain(|p| p.id != id);
        d.tasks.retain(|t| t.project_id != id);
        Ok(())
    })
}

#[tauri::command]
pub fn save_task(st: State<'_, Shared>, mut task: Task) -> Result<Data, String> {
    if task.name.trim().is_empty() {
        return Err("Bitte einen Namen angeben.".into());
    }
    mutate(&st, |d| {
        if d.project(&task.project_id).is_none() {
            return Err("Projekt nicht gefunden.".into());
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
pub fn delete_task(st: State<'_, Shared>, id: String) -> Result<Data, String> {
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
pub fn save_entry(st: State<'_, Shared>, mut entry: Entry) -> Result<Data, String> {
    let ws = week_start_setting(&st);
    mutate(&st, |d| {
        if d.project(&entry.project_id).is_none() {
            return Err("Bitte ein Projekt wählen.".into());
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
        let start = parse_rfc3339(&entry.start).ok_or("Ungültige Startzeit.")?;
        if let Some(end) = &entry.end {
            let end = parse_rfc3339(end).ok_or("Ungültige Endzeit.")?;
            if end < start {
                return Err("Das Ende liegt vor dem Start.".into());
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
                return Err("Diese Woche ist abgeschlossen — zuerst wieder öffnen.".into());
            }
        }
        entry.locked = false;
        if entry_locked(d, &entry, ws) {
            return Err("Die Zielwoche ist abgeschlossen — zuerst wieder öffnen.".into());
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
pub fn delete_entry(st: State<'_, Shared>, id: String) -> Result<Data, String> {
    let ws = week_start_setting(&st);
    mutate(&st, |d| {
        if let Some(e) = d.entries.iter().find(|e| e.id == id) {
            if entry_locked(d, e, ws) {
                return Err("Diese Woche ist abgeschlossen — zuerst wieder öffnen.".into());
            }
        }
        d.entries.retain(|e| e.id != id);
        Ok(())
    })
}

#[tauri::command]
pub fn start_timer(st: State<'_, Shared>, input: TimerStart) -> Result<Data, String> {
    let ws = week_start_setting(&st);
    mutate(&st, |d| {
        let project = d.project(&input.project_id).ok_or("Bitte ein Projekt wählen.")?.clone();
        if project.archived {
            return Err("Das Projekt ist archiviert.".into());
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
        let now = now_iso();
        for e in d.entries.iter_mut().filter(|e| e.end.is_none()) {
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
            return Err("Die aktuelle Woche ist abgeschlossen — zuerst wieder öffnen.".into());
        }
        d.entries.push(entry);
        Ok(())
    })
}

#[tauri::command]
pub fn stop_timer(st: State<'_, Shared>) -> Result<Data, String> {
    mutate(&st, |d| {
        let now = now_iso();
        for e in d.entries.iter_mut().filter(|e| e.end.is_none()) {
            e.end = Some(now.clone());
            e.updated_at = now.clone();
        }
        Ok(())
    })
}

#[tauri::command]
pub fn running(st: State<'_, Shared>) -> Option<Entry> {
    st.data.lock().unwrap().entries.iter().find(|e| e.end.is_none()).cloned()
}

// --- reports ----------------------------------------------------------------

#[tauri::command]
pub fn summary(
    st: State<'_, Shared>,
    from: String,
    to: String,
    group_by: String,
    filter: Filter,
) -> Result<Summary, String> {
    let range = range_from(&from, &to)?;
    let data = st.data.lock().unwrap();
    Ok(summarize(&data, &range, GroupBy::parse(&group_by), &filter, rounding(&st), Utc::now()))
}

#[tauri::command]
pub fn weekly_totals(st: State<'_, Shared>, weeks: u32, filter: Filter) -> Vec<WeekTotal> {
    let data = st.data.lock().unwrap();
    timelog_core::weekly_totals(
        &data,
        Local::now().date_naive(),
        weeks.clamp(1, 52),
        week_start_setting(&st),
        &filter,
        rounding(&st),
        Utc::now(),
    )
}

#[tauri::command]
pub fn budget_usages(st: State<'_, Shared>) -> Vec<BudgetUsage> {
    let data = st.data.lock().unwrap();
    let r = rounding(&st);
    let now = Utc::now();
    data.projects
        .iter()
        .filter(|p| !p.archived)
        .map(|p| budget_usage(&data, p, r, now))
        .collect()
}

/// CSV erzeugen — `kind`: "entries" | "summary". Speichern übernimmt das
/// Frontend über den Dialog + `write_text_file`.
#[tauri::command]
pub fn export_csv(
    st: State<'_, Shared>,
    from: String,
    to: String,
    kind: String,
    group_by: String,
    filter: Filter,
) -> Result<String, String> {
    let range = range_from(&from, &to)?;
    let data = st.data.lock().unwrap();
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
pub fn export_package(st: State<'_, Shared>, person_id: Option<String>) -> Result<String, String> {
    let data = st.data.lock().unwrap();
    let mut out = data.clone();
    if let Some(p) = person_id.filter(|p| !p.is_empty()) {
        out.entries.retain(|e| e.person_id == p);
        out.locks.retain(|l| l.person_id == p);
        out.persons.retain(|x| x.id == p);
    }
    let pkg = Package::new(out, now_iso());
    serde_json::to_string_pretty(&pkg).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn import_package(st: State<'_, Shared>, json: String) -> Result<ImportResult, String> {
    let pkg = Package::parse(&json)?;
    let mut report = MergeReport::default();
    let data = mutate(&st, |d| {
        report = merge_into(d, &pkg.data);
        Ok(())
    })?;
    Ok(ImportResult { report, data })
}

// --- week locks -------------------------------------------------------------

#[tauri::command]
pub fn lock_week(st: State<'_, Shared>, person_id: String, week_start: String) -> Result<Data, String> {
    let ws = week_start_setting(&st);
    mutate(&st, |d| {
        if d.person(&person_id).is_none() {
            return Err("Person nicht gefunden.".into());
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
pub fn unlock_week(st: State<'_, Shared>, person_id: String, week_start: String) -> Result<Data, String> {
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

#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("Lesen fehlgeschlagen: {e}"))
}

#[tauri::command]
pub fn write_text_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content.as_bytes()).map_err(|e| format!("Schreiben fehlgeschlagen: {e}"))
}

#[tauri::command]
pub fn write_file(path: String, data_base64: String) -> Result<(), String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_base64)
        .map_err(|e| e.to_string())?;
    std::fs::write(&path, bytes).map_err(|e| format!("Schreiben fehlgeschlagen: {e}"))
}

// --- misc -------------------------------------------------------------------

#[tauri::command]
pub fn data_path(st: State<'_, Shared>) -> String {
    st.data_dir.to_string_lossy().to_string()
}

#[tauri::command]
pub async fn check_update(app: AppHandle) -> Result<Option<UpdateInfoDto>, String> {
    use tauri_plugin_updater::UpdaterExt;
    let updater = app.updater().map_err(|e| e.to_string())?;
    match updater.check().await {
        Ok(Some(update)) => Ok(Some(UpdateInfoDto {
            version: update.version.clone(),
            notes: update.body.clone(),
            date: update.date.map(|d| d.to_string()),
        })),
        Ok(None) => Ok(None),
        Err(e) => Err(format!("Update-Prüfung fehlgeschlagen: {e}")),
    }
}

#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;
    let updater = app.updater().map_err(|e| e.to_string())?;
    let update = updater
        .check()
        .await
        .map_err(|e| format!("Update-Prüfung fehlgeschlagen: {e}"))?
        .ok_or("Kein Update verfügbar")?;
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| format!("Update fehlgeschlagen: {e}"))?;
    app.restart();
}
