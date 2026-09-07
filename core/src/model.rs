//! Datenmodell — Vertrag zu `src/api.ts` (camelCase über serde).
//! Zeiten liegen als RFC 3339 in UTC vor; die Anzeige rechnet lokal um.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Person {
    pub id: String,
    pub name: String,
    pub email: String,
    /// Soll-Stunden pro Woche (0 = kein Soll).
    pub weekly_hours: f64,
    /// Stundensatz in Euro (0 = keiner).
    pub hourly_rate: f64,
    pub color: String,
    pub archived: bool,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Client {
    pub id: String,
    pub name: String,
    pub archived: bool,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub client_id: Option<String>,
    pub name: String,
    pub color: String,
    /// Stundenbudget (0 = keins).
    pub budget_hours: f64,
    /// Euro-Budget (0 = keins).
    pub budget_amount: f64,
    /// Stundensatz in Euro (0 = Satz der Person verwenden).
    pub hourly_rate: f64,
    pub billable_default: bool,
    pub archived: bool,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub billable_default: bool,
    pub archived: bool,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Entry {
    pub id: String,
    pub person_id: String,
    pub project_id: String,
    pub task_id: Option<String>,
    /// RFC 3339 (UTC).
    pub start: String,
    /// RFC 3339 (UTC); `None` = Timer läuft.
    pub end: Option<String>,
    pub note: String,
    pub billable: bool,
    pub tags: Vec<String>,
    /// Gesetzt, wenn die Woche der Person abgeschlossen ist.
    pub locked: bool,
    pub updated_at: String,
}

/// Wochenabschluss: `week_start` = lokales Datum (YYYY-MM-DD) des ersten Wochentags.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct WeekLock {
    pub person_id: String,
    pub week_start: String,
}

/// Der komplette Datenbestand — eine JSON-Datei, atomar geschrieben.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Data {
    /// Id der Person, die diese Installation nutzt.
    pub me_person_id: String,
    pub persons: Vec<Person>,
    pub clients: Vec<Client>,
    pub projects: Vec<Project>,
    pub tasks: Vec<Task>,
    pub entries: Vec<Entry>,
    pub locks: Vec<WeekLock>,
}

impl Default for Person {
    fn default() -> Self {
        Person {
            id: String::new(),
            name: String::new(),
            email: String::new(),
            weekly_hours: 0.0,
            hourly_rate: 0.0,
            color: "#38bdf8".into(),
            archived: false,
            updated_at: String::new(),
        }
    }
}

impl Default for Client {
    fn default() -> Self {
        Client {
            id: String::new(),
            name: String::new(),
            archived: false,
            updated_at: String::new(),
        }
    }
}

impl Default for Project {
    fn default() -> Self {
        Project {
            id: String::new(),
            client_id: None,
            name: String::new(),
            color: "#38bdf8".into(),
            budget_hours: 0.0,
            budget_amount: 0.0,
            hourly_rate: 0.0,
            billable_default: true,
            archived: false,
            updated_at: String::new(),
        }
    }
}

impl Default for Task {
    fn default() -> Self {
        Task {
            id: String::new(),
            project_id: String::new(),
            name: String::new(),
            billable_default: true,
            archived: false,
            updated_at: String::new(),
        }
    }
}

impl Default for Entry {
    fn default() -> Self {
        Entry {
            id: String::new(),
            person_id: String::new(),
            project_id: String::new(),
            task_id: None,
            start: String::new(),
            end: None,
            note: String::new(),
            billable: true,
            tags: Vec::new(),
            locked: false,
            updated_at: String::new(),
        }
    }
}

impl Default for WeekLock {
    fn default() -> Self {
        WeekLock {
            person_id: String::new(),
            week_start: String::new(),
        }
    }
}

impl Data {
    pub fn person(&self, id: &str) -> Option<&Person> {
        self.persons.iter().find(|p| p.id == id)
    }
    pub fn client(&self, id: &str) -> Option<&Client> {
        self.clients.iter().find(|c| c.id == id)
    }
    pub fn project(&self, id: &str) -> Option<&Project> {
        self.projects.iter().find(|p| p.id == id)
    }
    pub fn task(&self, id: &str) -> Option<&Task> {
        self.tasks.iter().find(|t| t.id == id)
    }
    pub fn is_week_locked(&self, person_id: &str, week_start: &str) -> bool {
        self.locks
            .iter()
            .any(|l| l.person_id == person_id && l.week_start == week_start)
    }
}
