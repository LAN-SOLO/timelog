//! timelog-core — Tauri-freie Fachlogik der Zeiterfassung:
//! Datenmodell, Dauer/Rundung, Wochen- und Zeitraumlogik, Aggregation,
//! CSV-Erzeugung und Id-basierter JSON-Merge für die Team-Zusammenführung.

pub mod csv;
pub mod merge;
pub mod model;
pub mod summary;
pub mod time;

pub use csv::{csv_field, csv_line, entries_csv, summary_csv};
pub use merge::{merge_into, MergeReport, Package};
pub use model::{Client, Data, Entry, Person, Project, Task, WeekLock};
pub use summary::{budget_usage, summarize, weekly_totals, BudgetUsage, Filter, GroupBy, Summary, SummaryRow, WeekTotal};
pub use time::{
    duration_secs, entry_week_start, fmt_hm, fmt_hours, local_date, overlap_secs, parse_rfc3339, round_secs,
    week_start_of, Range, WeekStart,
};
