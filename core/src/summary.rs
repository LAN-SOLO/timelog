//! Aggregation: Stunden je Projekt / Kunde / Person / Tätigkeit, Wochen-Trend, Budgets.

use chrono::{DateTime, Duration, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

use crate::model::{Data, Entry, Project};
use crate::time::{overlap_secs, round_secs, week_start_of, Range, WeekStart};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GroupBy {
    Project,
    Client,
    Person,
    Task,
}

impl GroupBy {
    pub fn parse(s: &str) -> GroupBy {
        match s {
            "client" => GroupBy::Client,
            "person" => GroupBy::Person,
            "task" => GroupBy::Task,
            _ => GroupBy::Project,
        }
    }
}

/// Filter für Zusammenfassung und Export.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Filter {
    pub person_id: Option<String>,
    pub project_id: Option<String>,
    pub client_id: Option<String>,
}

impl Filter {
    pub fn matches(&self, data: &Data, e: &Entry) -> bool {
        if let Some(p) = &self.person_id {
            if &e.person_id != p {
                return false;
            }
        }
        if let Some(p) = &self.project_id {
            if &e.project_id != p {
                return false;
            }
        }
        if let Some(c) = &self.client_id {
            let cid = data.project(&e.project_id).and_then(|p| p.client_id.clone());
            if cid.as_deref() != Some(c.as_str()) {
                return false;
            }
        }
        true
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryRow {
    /// Id der Gruppe ("" = ohne Zuordnung).
    pub key: String,
    pub label: String,
    pub color: Option<String>,
    pub seconds: i64,
    pub rounded_seconds: i64,
    pub billable_seconds: i64,
    /// Betrag in Euro (gerundete abrechenbare Zeit × Satz).
    pub amount: f64,
    pub entries: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub rows: Vec<SummaryRow>,
    pub total_seconds: i64,
    pub total_rounded_seconds: i64,
    pub total_billable_seconds: i64,
    pub total_amount: f64,
    pub entries: u32,
}

/// Stundensatz eines Eintrags: Projektsatz, sonst Personensatz, sonst 0.
pub fn rate_for(data: &Data, e: &Entry) -> f64 {
    let pr = data.project(&e.project_id).map(|p| p.hourly_rate).unwrap_or(0.0);
    if pr > 0.0 {
        return pr;
    }
    data.person(&e.person_id).map(|p| p.hourly_rate).unwrap_or(0.0)
}

/// Betrag eines Eintrags (nur abrechenbar) auf Basis gerundeter Sekunden.
pub fn amount_for(data: &Data, e: &Entry, rounded_secs: i64) -> f64 {
    if !e.billable {
        return 0.0;
    }
    let rate = rate_for(data, e);
    if rate <= 0.0 {
        return 0.0;
    }
    ((rounded_secs as f64 / 3600.0) * rate * 100.0).round() / 100.0
}

fn group_key(data: &Data, e: &Entry, by: GroupBy) -> (String, String, Option<String>) {
    match by {
        GroupBy::Project => match data.project(&e.project_id) {
            Some(p) => (p.id.clone(), p.name.clone(), Some(p.color.clone())),
            None => (String::new(), String::new(), None),
        },
        GroupBy::Client => {
            let cid = data.project(&e.project_id).and_then(|p| p.client_id.clone());
            match cid.and_then(|c| data.client(&c)) {
                Some(c) => (c.id.clone(), c.name.clone(), None),
                None => (String::new(), String::new(), None),
            }
        }
        GroupBy::Person => match data.person(&e.person_id) {
            Some(p) => (p.id.clone(), p.name.clone(), Some(p.color.clone())),
            None => (String::new(), String::new(), None),
        },
        GroupBy::Task => match e.task_id.as_deref().and_then(|t| data.task(t)) {
            Some(t) => {
                let proj = data.project(&t.project_id).map(|p| p.name.clone()).unwrap_or_default();
                let label = if proj.is_empty() { t.name.clone() } else { format!("{} · {}", proj, t.name) };
                (t.id.clone(), label, None)
            }
            None => (String::new(), String::new(), None),
        },
    }
}

/// Zusammenfassung über den Zeitraum. Einträge werden auf den Zeitraum beschnitten
/// (Überlappung); die Rundung wirkt je Eintrag, danach wird summiert.
pub fn summarize(
    data: &Data,
    range: &Range,
    by: GroupBy,
    filter: &Filter,
    rounding_min: u32,
    now: DateTime<Utc>,
) -> Summary {
    let mut groups: BTreeMap<String, SummaryRow> = BTreeMap::new();
    let mut total = 0;
    let mut total_r = 0;
    let mut total_b = 0;
    let mut total_amount = 0.0;
    let mut count = 0u32;

    for e in &data.entries {
        if !filter.matches(data, e) {
            continue;
        }
        let secs = overlap_secs(e, range, now);
        if secs <= 0 {
            continue;
        }
        let rounded = round_secs(secs, rounding_min);
        let amount = amount_for(data, e, rounded);
        let (key, label, color) = group_key(data, e, by);
        let row = groups.entry(key.clone()).or_insert(SummaryRow {
            key,
            label,
            color,
            seconds: 0,
            rounded_seconds: 0,
            billable_seconds: 0,
            amount: 0.0,
            entries: 0,
        });
        row.seconds += secs;
        row.rounded_seconds += rounded;
        if e.billable {
            row.billable_seconds += rounded;
        }
        row.amount += amount;
        row.entries += 1;
        total += secs;
        total_r += rounded;
        if e.billable {
            total_b += rounded;
        }
        total_amount += amount;
        count += 1;
    }

    let mut rows: Vec<SummaryRow> = groups.into_values().collect();
    rows.sort_by(|a, b| b.seconds.cmp(&a.seconds).then(a.label.cmp(&b.label)));
    for r in &mut rows {
        r.amount = (r.amount * 100.0).round() / 100.0;
    }
    Summary {
        rows,
        total_seconds: total,
        total_rounded_seconds: total_r,
        total_billable_seconds: total_b,
        total_amount: (total_amount * 100.0).round() / 100.0,
        entries: count,
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeekTotal {
    /// YYYY-MM-DD des ersten Wochentags.
    pub week_start: String,
    pub seconds: i64,
    pub billable_seconds: i64,
}

/// Wochensummen der letzten `weeks` Wochen (älteste zuerst, inkl. aktueller Woche).
pub fn weekly_totals(
    data: &Data,
    today: NaiveDate,
    weeks: u32,
    ws: WeekStart,
    filter: &Filter,
    rounding_min: u32,
    now: DateTime<Utc>,
) -> Vec<WeekTotal> {
    let current = week_start_of(today, ws);
    let mut out = Vec::new();
    for i in (0..weeks as i64).rev() {
        let start = current - Duration::days(7 * i);
        let range = Range::local_days(start, start + Duration::days(6));
        let s = summarize(data, &range, GroupBy::Project, filter, rounding_min, now);
        out.push(WeekTotal {
            week_start: start.to_string(),
            seconds: s.total_rounded_seconds,
            billable_seconds: s.total_billable_seconds,
        });
    }
    out
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BudgetUsage {
    pub project_id: String,
    pub used_seconds: i64,
    pub used_amount: f64,
    /// Verbrauch in Prozent (Stunden-Budget), None = kein Budget.
    pub hours_pct: Option<f64>,
    /// Verbrauch in Prozent (Euro-Budget), None = kein Budget.
    pub amount_pct: Option<f64>,
}

/// Budgetverbrauch eines Projekts über alle Zeiten.
pub fn budget_usage(data: &Data, project: &Project, rounding_min: u32, now: DateTime<Utc>) -> BudgetUsage {
    let mut secs = 0;
    let mut amount = 0.0;
    for e in data.entries.iter().filter(|e| e.project_id == project.id) {
        let d = round_secs(crate::time::duration_secs(e, now), rounding_min);
        secs += d;
        amount += amount_for(data, e, d);
    }
    let pct = |used: f64, budget: f64| if budget > 0.0 { Some(used / budget * 100.0) } else { None };
    BudgetUsage {
        project_id: project.id.clone(),
        used_seconds: secs,
        used_amount: (amount * 100.0).round() / 100.0,
        hours_pct: pct(secs as f64 / 3600.0, project.budget_hours),
        amount_pct: pct(amount, project.budget_amount),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Client, Person, Task};
    use chrono::TimeZone;

    fn fixture() -> Data {
        let mut d = Data::default();
        d.me_person_id = "p1".into();
        d.persons.push(Person { id: "p1".into(), name: "Anna".into(), hourly_rate: 80.0, ..Person::default() });
        d.persons.push(Person { id: "p2".into(), name: "Ben".into(), ..Person::default() });
        d.clients.push(Client { id: "c1".into(), name: "ACME".into(), ..Client::default() });
        d.projects.push(Project {
            id: "pr1".into(),
            client_id: Some("c1".into()),
            name: "Website".into(),
            hourly_rate: 100.0,
            budget_hours: 10.0,
            ..Project::default()
        });
        d.projects.push(Project { id: "pr2".into(), name: "Intern".into(), ..Project::default() });
        d.tasks.push(Task { id: "t1".into(), project_id: "pr1".into(), name: "Design".into(), ..Task::default() });
        let e = |id: &str, person: &str, project: &str, start: &str, end: &str, billable: bool| Entry {
            id: id.into(),
            person_id: person.into(),
            project_id: project.into(),
            start: start.into(),
            end: Some(end.into()),
            billable,
            ..Entry::default()
        };
        d.entries.push(e("e1", "p1", "pr1", "2026-09-07T08:00:00Z", "2026-09-07T10:00:00Z", true));
        d.entries.push(e("e2", "p1", "pr2", "2026-09-07T10:00:00Z", "2026-09-07T10:30:00Z", false));
        d.entries.push(e("e3", "p2", "pr1", "2026-09-08T08:00:00Z", "2026-09-08T09:00:00Z", true));
        // außerhalb des Zeitraums
        d.entries.push(e("e4", "p1", "pr1", "2026-10-01T08:00:00Z", "2026-10-01T09:00:00Z", true));
        d.entries[0].task_id = Some("t1".into());
        d
    }

    fn range() -> Range {
        Range {
            from: Utc.with_ymd_and_hms(2026, 9, 7, 0, 0, 0).unwrap(),
            to: Utc.with_ymd_and_hms(2026, 9, 14, 0, 0, 0).unwrap(),
        }
    }

    #[test]
    fn by_project_sums_and_sorts() {
        let d = fixture();
        let s = summarize(&d, &range(), GroupBy::Project, &Filter::default(), 0, Utc::now());
        assert_eq!(s.rows.len(), 2);
        assert_eq!(s.rows[0].label, "Website");
        assert_eq!(s.rows[0].seconds, 3 * 3600);
        assert_eq!(s.rows[0].entries, 2);
        assert_eq!(s.rows[1].label, "Intern");
        assert_eq!(s.rows[1].seconds, 1800);
        assert_eq!(s.total_seconds, 3 * 3600 + 1800);
        assert_eq!(s.total_billable_seconds, 3 * 3600);
        // Projektsatz 100 €/h × 3 h abrechenbar
        assert_eq!(s.total_amount, 300.0);
        assert_eq!(s.entries, 3);
    }

    #[test]
    fn by_client_person_task() {
        let d = fixture();
        let now = Utc::now();
        let c = summarize(&d, &range(), GroupBy::Client, &Filter::default(), 0, now);
        assert_eq!(c.rows[0].label, "ACME");
        assert_eq!(c.rows[0].seconds, 3 * 3600);
        assert_eq!(c.rows[1].key, ""); // Intern ohne Kunde
        let p = summarize(&d, &range(), GroupBy::Person, &Filter::default(), 0, now);
        assert_eq!(p.rows[0].label, "Anna");
        assert_eq!(p.rows[0].seconds, 2 * 3600 + 1800);
        assert_eq!(p.rows[1].label, "Ben");
        let t = summarize(&d, &range(), GroupBy::Task, &Filter::default(), 0, now);
        let design = t.rows.iter().find(|r| r.key == "t1").unwrap();
        assert_eq!(design.label, "Website · Design");
        assert_eq!(design.seconds, 2 * 3600);
    }

    #[test]
    fn filter_by_person_and_rounding_per_entry() {
        let mut d = fixture();
        // 1:07 → mit 15-min-Rundung 1:00
        d.entries[2].end = Some("2026-09-08T09:07:00Z".into());
        let f = Filter { person_id: Some("p2".into()), ..Filter::default() };
        let s = summarize(&d, &range(), GroupBy::Project, &f, 15, Utc::now());
        assert_eq!(s.rows.len(), 1);
        assert_eq!(s.total_seconds, 3600 + 7 * 60);
        assert_eq!(s.total_rounded_seconds, 3600);
    }

    #[test]
    fn person_rate_used_when_project_has_none() {
        let d = fixture();
        let f = Filter { project_id: Some("pr2".into()), ..Filter::default() };
        let s = summarize(&d, &range(), GroupBy::Project, &f, 0, Utc::now());
        // nicht abrechenbar → 0
        assert_eq!(s.total_amount, 0.0);
        let mut d2 = d.clone();
        d2.entries[1].billable = true;
        let s2 = summarize(&d2, &range(), GroupBy::Project, &f, 0, Utc::now());
        assert_eq!(s2.total_amount, 40.0); // 0,5 h × 80 €/h (Personensatz)
    }

    #[test]
    fn weekly_totals_cover_requested_weeks() {
        let d = fixture();
        let today = NaiveDate::from_ymd_opt(2026, 9, 9).unwrap();
        let w = weekly_totals(&d, today, 8, WeekStart::Monday, &Filter::default(), 0, Utc::now());
        assert_eq!(w.len(), 8);
        assert_eq!(w[7].week_start, "2026-09-07");
        assert_eq!(w[0].week_start, "2026-07-20");
        assert!(w[7].seconds >= 3 * 3600); // je nach lokaler Zeitzone liegt e2 auch drin
        assert_eq!(w[0].seconds, 0);
    }

    #[test]
    fn budget_usage_percent() {
        let d = fixture();
        let b = budget_usage(&d, &d.projects[0], 0, Utc::now());
        assert_eq!(b.used_seconds, 4 * 3600);
        assert_eq!(b.hours_pct, Some(40.0));
        assert_eq!(b.amount_pct, None);
        assert_eq!(b.used_amount, 400.0);
    }
}
