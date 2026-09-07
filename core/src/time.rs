//! Dauer, Rundung, Wochen- und Zeitraumlogik.

use chrono::{DateTime, Datelike, Duration, Local, NaiveDate, TimeZone, Utc, Weekday};

use crate::model::Entry;

/// Erster Wochentag — aus den Einstellungen ("monday" | "sunday").
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WeekStart {
    Monday,
    Sunday,
}

impl WeekStart {
    pub fn parse(s: &str) -> WeekStart {
        if s.eq_ignore_ascii_case("sunday") {
            WeekStart::Sunday
        } else {
            WeekStart::Monday
        }
    }
}

pub fn parse_rfc3339(s: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|d| d.with_timezone(&Utc))
}

/// Dauer eines Eintrags in Sekunden; ein laufender Eintrag wird bis `now` gezählt.
/// Negative Dauern (kaputte Daten) ergeben 0.
pub fn duration_secs(entry: &Entry, now: DateTime<Utc>) -> i64 {
    let Some(start) = parse_rfc3339(&entry.start) else {
        return 0;
    };
    let end = entry
        .end
        .as_deref()
        .and_then(parse_rfc3339)
        .unwrap_or(now);
    (end - start).num_seconds().max(0)
}

/// Rundet Sekunden auf `rounding_min` Minuten — kaufmännisch (halbe Einheit aufwärts).
/// `rounding_min == 0` lässt den Wert unverändert. Eine Dauer > 0 wird nie auf 0 gerundet.
pub fn round_secs(secs: i64, rounding_min: u32) -> i64 {
    if rounding_min == 0 || secs <= 0 {
        return secs.max(0);
    }
    let unit = rounding_min as i64 * 60;
    let rounded = ((secs + unit / 2) / unit) * unit;
    if rounded == 0 {
        unit
    } else {
        rounded
    }
}

/// Erster Tag der Woche, in der `date` liegt.
pub fn week_start_of(date: NaiveDate, ws: WeekStart) -> NaiveDate {
    let offset = match ws {
        WeekStart::Monday => date.weekday().num_days_from_monday(),
        WeekStart::Sunday => date.weekday().num_days_from_sunday(),
    };
    date - Duration::days(offset as i64)
}

/// Lokales Datum eines UTC-Zeitpunkts.
pub fn local_date(utc: DateTime<Utc>) -> NaiveDate {
    utc.with_timezone(&Local).date_naive()
}

/// Wochenschlüssel (YYYY-MM-DD des ersten Wochentags, lokale Zeit) eines Eintrags.
pub fn entry_week_start(entry: &Entry, ws: WeekStart) -> Option<String> {
    parse_rfc3339(&entry.start).map(|d| week_start_of(local_date(d), ws).to_string())
}

/// Lokaler Tagesbeginn (00:00) eines Datums als UTC-Zeitpunkt.
pub fn local_day_start_utc(date: NaiveDate) -> DateTime<Utc> {
    let naive = date.and_hms_opt(0, 0, 0).expect("valid time");
    match Local.from_local_datetime(&naive) {
        chrono::LocalResult::Single(d) => d.with_timezone(&Utc),
        chrono::LocalResult::Ambiguous(a, _) => a.with_timezone(&Utc),
        chrono::LocalResult::None => Local
            .from_local_datetime(&(naive + Duration::hours(1)))
            .single()
            .map(|d| d.with_timezone(&Utc))
            .unwrap_or_else(Utc::now),
    }
}

/// Halboffener Zeitraum [from, to) in UTC.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Range {
    pub from: DateTime<Utc>,
    pub to: DateTime<Utc>,
}

impl Range {
    pub fn contains(&self, t: DateTime<Utc>) -> bool {
        t >= self.from && t < self.to
    }

    /// Zeitraum aus zwei lokalen Datumsangaben (inklusive `last`).
    pub fn local_days(first: NaiveDate, last: NaiveDate) -> Range {
        Range {
            from: local_day_start_utc(first),
            to: local_day_start_utc(last + Duration::days(1)),
        }
    }

    /// Kalenderwoche, die `date` enthält.
    pub fn week_of(date: NaiveDate, ws: WeekStart) -> Range {
        let start = week_start_of(date, ws);
        Range::local_days(start, start + Duration::days(6))
    }

    /// Monat, der `date` enthält.
    pub fn month_of(date: NaiveDate) -> Range {
        let first = NaiveDate::from_ymd_opt(date.year(), date.month(), 1).expect("valid");
        let next = if date.month() == 12 {
            NaiveDate::from_ymd_opt(date.year() + 1, 1, 1)
        } else {
            NaiveDate::from_ymd_opt(date.year(), date.month() + 1, 1)
        }
        .expect("valid");
        Range::local_days(first, next - Duration::days(1))
    }
}

/// Sekunden eines Eintrags, die in den Zeitraum fallen (Überlappung, lokal berechnet).
pub fn overlap_secs(entry: &Entry, range: &Range, now: DateTime<Utc>) -> i64 {
    let Some(start) = parse_rfc3339(&entry.start) else {
        return 0;
    };
    let end = entry
        .end
        .as_deref()
        .and_then(parse_rfc3339)
        .unwrap_or(now);
    let s = start.max(range.from);
    let e = end.min(range.to);
    (e - s).num_seconds().max(0)
}

/// Formatiert Sekunden als `h:mm` (z. B. 7:05) — für CSV/PDF.
pub fn fmt_hm(secs: i64) -> String {
    let secs = secs.max(0);
    format!("{}:{:02}", secs / 3600, (secs % 3600) / 60)
}

/// Dezimalstunden mit zwei Nachkommastellen (Punkt) — für CSV-Rechenspalten.
pub fn fmt_hours(secs: i64) -> String {
    format!("{:.2}", secs.max(0) as f64 / 3600.0)
}

pub fn weekday_is(date: NaiveDate, wd: Weekday) -> bool {
    date.weekday() == wd
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(start: &str, end: Option<&str>) -> Entry {
        Entry {
            start: start.into(),
            end: end.map(String::from),
            ..Entry::default()
        }
    }

    #[test]
    fn duration_of_finished_entry() {
        let e = entry("2026-09-07T08:00:00Z", Some("2026-09-07T09:30:00Z"));
        assert_eq!(duration_secs(&e, Utc::now()), 5400);
    }

    #[test]
    fn duration_of_running_entry_uses_now() {
        let e = entry("2026-09-07T08:00:00Z", None);
        let now = Utc.with_ymd_and_hms(2026, 9, 7, 8, 10, 0).unwrap();
        assert_eq!(duration_secs(&e, now), 600);
    }

    #[test]
    fn duration_never_negative() {
        let e = entry("2026-09-07T09:00:00Z", Some("2026-09-07T08:00:00Z"));
        assert_eq!(duration_secs(&e, Utc::now()), 0);
        assert_eq!(duration_secs(&entry("garbage", None), Utc::now()), 0);
    }

    #[test]
    fn rounding_rules() {
        assert_eq!(round_secs(0, 15), 0);
        assert_eq!(round_secs(1234, 0), 1234);
        // 7 min → 5, 8 min → 10 (Halbe Einheit aufwärts)
        assert_eq!(round_secs(7 * 60, 5), 5 * 60);
        assert_eq!(round_secs(8 * 60, 5), 10 * 60);
        assert_eq!(round_secs(150, 5), 300); // exakt halbe Einheit → aufwärts
        // 1:07 → 1:00, 1:08 → 1:15
        assert_eq!(round_secs(3600 + 7 * 60, 15), 3600);
        assert_eq!(round_secs(3600 + 8 * 60, 15), 3600 + 15 * 60);
        // Dauer > 0 wird nie zu 0
        assert_eq!(round_secs(30, 15), 15 * 60);
    }

    #[test]
    fn week_start_monday_and_sunday() {
        let wed = NaiveDate::from_ymd_opt(2026, 9, 9).unwrap(); // Mittwoch
        assert_eq!(
            week_start_of(wed, WeekStart::Monday),
            NaiveDate::from_ymd_opt(2026, 9, 7).unwrap()
        );
        assert_eq!(
            week_start_of(wed, WeekStart::Sunday),
            NaiveDate::from_ymd_opt(2026, 9, 6).unwrap()
        );
        let sun = NaiveDate::from_ymd_opt(2026, 9, 13).unwrap();
        assert_eq!(
            week_start_of(sun, WeekStart::Monday),
            NaiveDate::from_ymd_opt(2026, 9, 7).unwrap()
        );
        assert_eq!(week_start_of(sun, WeekStart::Sunday), sun);
    }

    #[test]
    fn week_and_month_ranges_span_expected_days() {
        let d = NaiveDate::from_ymd_opt(2026, 2, 10).unwrap();
        let w = Range::week_of(d, WeekStart::Monday);
        assert_eq!((w.to - w.from).num_days(), 7);
        let m = Range::month_of(d);
        assert_eq!((m.to - m.from).num_days(), 28);
        let dec = Range::month_of(NaiveDate::from_ymd_opt(2026, 12, 31).unwrap());
        assert_eq!((dec.to - dec.from).num_days(), 31);
    }

    #[test]
    fn overlap_clips_to_range() {
        let r = Range {
            from: Utc.with_ymd_and_hms(2026, 9, 7, 0, 0, 0).unwrap(),
            to: Utc.with_ymd_and_hms(2026, 9, 8, 0, 0, 0).unwrap(),
        };
        let e = entry("2026-09-06T23:00:00Z", Some("2026-09-07T01:00:00Z"));
        assert_eq!(overlap_secs(&e, &r, Utc::now()), 3600);
        let outside = entry("2026-09-09T10:00:00Z", Some("2026-09-09T11:00:00Z"));
        assert_eq!(overlap_secs(&outside, &r, Utc::now()), 0);
    }

    #[test]
    fn formatting() {
        assert_eq!(fmt_hm(5400), "1:30");
        assert_eq!(fmt_hm(59), "0:00");
        assert_eq!(fmt_hours(5400), "1.50");
        assert_eq!(fmt_hours(-5), "0.00");
    }
}
