//! CSV-Erzeugung mit korrektem Quoting (RFC 4180): Felder mit Trennzeichen,
//! Anführungszeichen oder Zeilenumbrüchen werden in Anführungszeichen gesetzt,
//! Anführungszeichen verdoppelt. Zeilenende CRLF, UTF-8 ohne BOM.

use chrono::{DateTime, Local, Utc};

use crate::model::{Data, Entry};
use crate::summary::{amount_for, rate_for, GroupBy, Summary};
use crate::time::{duration_secs, fmt_hm, fmt_hours, overlap_secs, parse_rfc3339, round_secs, Range};

pub fn csv_field(s: &str, delim: char) -> String {
    let needs = s.contains(delim)
        || s.contains('"')
        || s.contains('\n')
        || s.contains('\r')
        || s.starts_with(' ')
        || s.ends_with(' ');
    if needs {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

pub fn csv_line(fields: &[String], delim: char) -> String {
    let mut out = fields
        .iter()
        .map(|f| csv_field(f, delim))
        .collect::<Vec<_>>()
        .join(&delim.to_string());
    out.push_str("\r\n");
    out
}

/// Spaltenüberschriften je Sprache.
pub struct Labels {
    pub entries: [&'static str; 17],
    pub summary_group: [&'static str; 4],
    pub summary_cols: [&'static str; 6],
    pub total: &'static str,
    pub yes: &'static str,
    pub no: &'static str,
    pub unassigned: &'static str,
}

pub fn labels(lang: &str) -> Labels {
    if lang == "de" {
        Labels {
            entries: [
                "Datum", "Start", "Ende", "Dauer", "Stunden", "Gerundet", "Stunden gerundet", "Person", "Kunde",
                "Projekt", "Tätigkeit", "Abrechenbar", "Satz", "Betrag", "Tags", "Notiz", "Gesperrt",
            ],
            summary_group: ["Projekt", "Kunde", "Person", "Tätigkeit"],
            summary_cols: ["Einträge", "Dauer", "Stunden", "Gerundet", "Abrechenbar (h)", "Betrag"],
            total: "Summe",
            yes: "ja",
            no: "nein",
            unassigned: "(ohne Zuordnung)",
        }
    } else {
        Labels {
            entries: [
                "Date", "Start", "End", "Duration", "Hours", "Rounded", "Hours rounded", "Person", "Client",
                "Project", "Task", "Billable", "Rate", "Amount", "Tags", "Note", "Locked",
            ],
            summary_group: ["Project", "Client", "Person", "Task"],
            summary_cols: ["Entries", "Duration", "Hours", "Rounded", "Billable (h)", "Amount"],
            total: "Total",
            yes: "yes",
            no: "no",
            unassigned: "(unassigned)",
        }
    }
}

fn fmt_local(utc: DateTime<Utc>, pattern: &str) -> String {
    utc.with_timezone(&Local).format(pattern).to_string()
}

fn fmt_money(v: f64, lang: &str) -> String {
    let s = format!("{:.2}", v);
    if lang == "de" {
        s.replace('.', ",")
    } else {
        s
    }
}

fn fmt_dec(v: &str, lang: &str) -> String {
    if lang == "de" {
        v.replace('.', ",")
    } else {
        v.to_string()
    }
}

/// Einträge im Zeitraum als CSV (alle Felder). `simple` lässt Person/Kunde/Tätigkeit/
/// Abrechenbar/Satz/Betrag/Gesperrt weg (einfacher Modus).
pub fn entries_csv(
    data: &Data,
    entries: &[&Entry],
    range: &Range,
    rounding_min: u32,
    lang: &str,
    delim: char,
    simple: bool,
    now: DateTime<Utc>,
) -> String {
    let l = labels(lang);
    let keep: Vec<usize> = if simple {
        vec![0, 1, 2, 3, 4, 5, 6, 9, 14, 15]
    } else {
        (0..17).collect()
    };
    let mut out = String::new();
    let head: Vec<String> = keep.iter().map(|&i| l.entries[i].to_string()).collect();
    out.push_str(&csv_line(&head, delim));

    let mut sorted: Vec<&Entry> = entries.to_vec();
    sorted.sort_by(|a, b| a.start.cmp(&b.start));
    for e in sorted {
        if overlap_secs(e, range, now) <= 0 {
            continue;
        }
        let start = parse_rfc3339(&e.start);
        let end = e.end.as_deref().and_then(parse_rfc3339);
        let secs = duration_secs(e, now);
        let rounded = round_secs(secs, rounding_min);
        let project = data.project(&e.project_id);
        let client = project
            .and_then(|p| p.client_id.as_deref())
            .and_then(|c| data.client(c))
            .map(|c| c.name.clone())
            .unwrap_or_default();
        let rate = rate_for(data, e);
        let all: Vec<String> = vec![
            start.map(|d| fmt_local(d, "%Y-%m-%d")).unwrap_or_default(),
            start.map(|d| fmt_local(d, "%H:%M")).unwrap_or_default(),
            end.map(|d| fmt_local(d, "%H:%M")).unwrap_or_default(),
            fmt_hm(secs),
            fmt_dec(&fmt_hours(secs), lang),
            fmt_hm(rounded),
            fmt_dec(&fmt_hours(rounded), lang),
            data.person(&e.person_id).map(|p| p.name.clone()).unwrap_or_default(),
            client,
            project.map(|p| p.name.clone()).unwrap_or_default(),
            e.task_id
                .as_deref()
                .and_then(|t| data.task(t))
                .map(|t| t.name.clone())
                .unwrap_or_default(),
            if e.billable { l.yes } else { l.no }.to_string(),
            if rate > 0.0 { fmt_money(rate, lang) } else { String::new() },
            fmt_money(amount_for(data, e, rounded), lang),
            e.tags.join(", "),
            e.note.clone(),
            if e.locked { l.yes } else { l.no }.to_string(),
        ];
        let row: Vec<String> = keep.iter().map(|&i| all[i].clone()).collect();
        out.push_str(&csv_line(&row, delim));
    }
    out
}

/// Zusammenfassung als CSV mit Summenzeile.
pub fn summary_csv(summary: &Summary, by: GroupBy, lang: &str, delim: char, simple: bool) -> String {
    let l = labels(lang);
    let group_label = match by {
        GroupBy::Project => l.summary_group[0],
        GroupBy::Client => l.summary_group[1],
        GroupBy::Person => l.summary_group[2],
        GroupBy::Task => l.summary_group[3],
    };
    let ncols = if simple { 4 } else { 6 };
    let mut head = vec![group_label.to_string()];
    head.extend(l.summary_cols[..ncols].iter().map(|s| s.to_string()));
    let mut out = csv_line(&head, delim);
    let row = |label: &str, entries: u32, secs: i64, rounded: i64, billable: i64, amount: f64| {
        let mut r = vec![
            label.to_string(),
            entries.to_string(),
            fmt_hm(secs),
            fmt_dec(&fmt_hours(secs), lang),
            fmt_hm(rounded),
        ];
        if !simple {
            r.push(fmt_dec(&fmt_hours(billable), lang));
            r.push(fmt_money(amount, lang));
        }
        r
    };
    for r in &summary.rows {
        let label = if r.label.is_empty() { l.unassigned } else { r.label.as_str() };
        out.push_str(&csv_line(
            &row(label, r.entries, r.seconds, r.rounded_seconds, r.billable_seconds, r.amount),
            delim,
        ));
    }
    out.push_str(&csv_line(
        &row(
            l.total,
            summary.entries,
            summary.total_seconds,
            summary.total_rounded_seconds,
            summary.total_billable_seconds,
            summary.total_amount,
        ),
        delim,
    ));
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Person, Project};
    use crate::summary::{summarize, Filter};
    use chrono::TimeZone;

    #[test]
    fn quoting_rules() {
        assert_eq!(csv_field("plain", ';'), "plain");
        assert_eq!(csv_field("a;b", ';'), "\"a;b\"");
        assert_eq!(csv_field("a,b", ';'), "a,b");
        assert_eq!(csv_field("a,b", ','), "\"a,b\"");
        assert_eq!(csv_field("say \"hi\"", ';'), "\"say \"\"hi\"\"\"");
        assert_eq!(csv_field("line1\nline2", ';'), "\"line1\nline2\"");
        assert_eq!(csv_field(" lead", ';'), "\" lead\"");
        assert_eq!(csv_field("", ';'), "");
    }

    #[test]
    fn line_uses_crlf_and_delimiter() {
        let l = csv_line(&["a".into(), "b;c".into(), "d".into()], ';');
        assert_eq!(l, "a;\"b;c\";d\r\n");
    }

    fn data() -> Data {
        let mut d = Data::default();
        d.persons.push(Person { id: "p".into(), name: "Anna".into(), ..Person::default() });
        d.projects.push(Project {
            id: "pr".into(),
            name: "Web; Relaunch".into(),
            hourly_rate: 100.0,
            ..Project::default()
        });
        d.entries.push(Entry {
            id: "e".into(),
            person_id: "p".into(),
            project_id: "pr".into(),
            start: "2026-09-07T08:00:00Z".into(),
            end: Some("2026-09-07T09:30:00Z".into()),
            note: "Kickoff \"intern\"".into(),
            tags: vec!["a".into(), "b".into()],
            ..Entry::default()
        });
        d
    }

    fn range() -> Range {
        Range {
            from: Utc.with_ymd_and_hms(2026, 9, 1, 0, 0, 0).unwrap(),
            to: Utc.with_ymd_and_hms(2026, 10, 1, 0, 0, 0).unwrap(),
        }
    }

    #[test]
    fn entries_csv_full_and_simple() {
        let d = data();
        let refs: Vec<&Entry> = d.entries.iter().collect();
        let full = entries_csv(&d, &refs, &range(), 0, "de", ';', false, Utc::now());
        let lines: Vec<&str> = full.split("\r\n").filter(|l| !l.is_empty()).collect();
        assert_eq!(lines.len(), 2);
        assert!(lines[0].starts_with("Datum;Start;Ende;Dauer;Stunden;Gerundet"));
        assert_eq!(lines[0].split(';').count(), 17);
        assert!(lines[1].contains("\"Web; Relaunch\""));
        assert!(lines[1].contains("\"Kickoff \"\"intern\"\"\""));
        assert!(lines[1].contains(";1:30;1,50;1:30;1,50;Anna;"));
        assert!(lines[1].contains(";ja;100,00;150,00;a, b;"));

        let simple = entries_csv(&d, &refs, &range(), 15, "en", ',', true, Utc::now());
        let sl: Vec<&str> = simple.split("\r\n").filter(|l| !l.is_empty()).collect();
        assert_eq!(sl[0], "Date,Start,End,Duration,Hours,Rounded,Hours rounded,Project,Tags,Note");
        assert!(sl[1].contains(",1:30,1.50,1:30,1.50,Web; Relaunch,\"a, b\","));
    }

    #[test]
    fn summary_csv_has_total_row() {
        let d = data();
        let s = summarize(&d, &range(), GroupBy::Project, &Filter::default(), 0, Utc::now());
        let csv = summary_csv(&s, GroupBy::Project, "en", ',', false);
        let lines: Vec<&str> = csv.split("\r\n").filter(|l| !l.is_empty()).collect();
        assert_eq!(lines[0], "Project,Entries,Duration,Hours,Rounded,Billable (h),Amount");
        assert_eq!(lines[1], "Web; Relaunch,1,1:30,1.50,1:30,1.50,150.00");
        assert_eq!(lines[2], "Total,1,1:30,1.50,1:30,1.50,150.00");
        let simple = summary_csv(&s, GroupBy::Project, "de", ';', true);
        assert!(simple.starts_with("Projekt;Einträge;Dauer;Stunden;Gerundet\r\n"));
    }
}
