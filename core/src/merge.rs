//! Team-Zusammenführung ohne Server: JSON-Paket exportieren, beim Projektleiter
//! importieren. Merge ist Id-basiert — kein Datensatz wird doppelt angelegt,
//! bei Konflikten gewinnt der jüngere `updatedAt`.

use serde::{Deserialize, Serialize};

use crate::model::{Data, Entry};

pub const PACKAGE_FORMAT: &str = "timelog-package";
pub const PACKAGE_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Package {
    pub format: String,
    pub version: u32,
    pub exported_at: String,
    pub data: Data,
}

impl Package {
    pub fn new(data: Data, exported_at: String) -> Package {
        Package {
            format: PACKAGE_FORMAT.into(),
            version: PACKAGE_VERSION,
            exported_at,
            data,
        }
    }

    pub fn parse(json: &str) -> Result<Package, String> {
        Package::parse_localized(json, false)
    }

    /// Wie `parse`, Fehlermeldung auf Deutsch (`en == false`) oder Englisch.
    pub fn parse_localized(json: &str, en: bool) -> Result<Package, String> {
        // Unter Windows gespeicherte Dateien (Editor/Notepad) beginnen oft mit
        // einem UTF-8-BOM — serde_json lehnt den sonst als ungültig ab.
        let json = json.strip_prefix('\u{feff}').unwrap_or(json);
        let p: Package = serde_json::from_str(json).map_err(|e| {
            if en {
                format!("Invalid JSON: {e}")
            } else {
                format!("JSON ungültig: {e}")
            }
        })?;
        if p.format != PACKAGE_FORMAT {
            return Err(if en { "Not a timelog package (format)" } else { "Kein timelog-Paket (format)" }.into());
        }
        if p.version > PACKAGE_VERSION {
            return Err(if en {
                format!("Package version {} is newer than this app", p.version)
            } else {
                format!("Paketversion {} ist neuer als diese App", p.version)
            });
        }
        Ok(p)
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeReport {
    pub added: u32,
    pub updated: u32,
    pub unchanged: u32,
    pub entries_added: u32,
}

/// Ist `a` jünger als `b`? Zeitstempel werden als Zeitpunkte verglichen —
/// ein reiner Textvergleich hielte z. B. „10:00+02:00“ (= 08:00 UTC) für
/// jünger als „09:00Z“. Nicht lesbare Werte fallen auf den Textvergleich zurück.
pub fn is_newer(a: &str, b: &str) -> bool {
    match (crate::time::parse_rfc3339(a), crate::time::parse_rfc3339(b)) {
        (Some(x), Some(y)) => x > y,
        (Some(_), None) => true,
        (None, Some(_)) => false,
        (None, None) => a > b,
    }
}

/// Generischer Id-Merge für eine Sammlung (Index über die Ids, damit auch
/// große Pakete in linearer Zeit zusammengeführt werden).
fn merge_vec<T, FId, FUpd>(target: &mut Vec<T>, incoming: &[T], id: FId, updated_at: FUpd, rep: &mut MergeReport) -> u32
where
    T: Clone + PartialEq,
    FId: Fn(&T) -> &str,
    FUpd: Fn(&T) -> &str,
{
    // Erster Treffer gewinnt (wie zuvor die lineare Suche), falls der
    // Bestand doch doppelte Ids enthält.
    let mut index: std::collections::HashMap<String, usize> = std::collections::HashMap::with_capacity(target.len());
    for (i, t) in target.iter().enumerate() {
        index.entry(id(t).to_string()).or_insert(i);
    }
    let mut added = 0;
    for item in incoming {
        if id(item).is_empty() {
            continue;
        }
        match index.get(id(item)).copied() {
            None => {
                index.insert(id(item).to_string(), target.len());
                target.push(item.clone());
                rep.added += 1;
                added += 1;
            }
            Some(i) => {
                let existing = &mut target[i];
                if existing == item {
                    rep.unchanged += 1;
                } else if is_newer(updated_at(item), updated_at(existing)) {
                    *existing = item.clone();
                    rep.updated += 1;
                } else {
                    rep.unchanged += 1;
                }
            }
        }
    }
    added
}

/// Paket in den Bestand mischen. `me_person_id` bleibt unangetastet.
pub fn merge_into(target: &mut Data, incoming: &Data) -> MergeReport {
    let mut rep = MergeReport::default();
    merge_vec(&mut target.persons, &incoming.persons, |p| &p.id, |p| &p.updated_at, &mut rep);
    merge_vec(&mut target.clients, &incoming.clients, |c| &c.id, |c| &c.updated_at, &mut rep);
    merge_vec(&mut target.projects, &incoming.projects, |p| &p.id, |p| &p.updated_at, &mut rep);
    merge_vec(&mut target.tasks, &incoming.tasks, |t| &t.id, |t| &t.updated_at, &mut rep);
    rep.entries_added = merge_vec(
        &mut target.entries,
        &incoming.entries,
        |e: &Entry| &e.id,
        |e: &Entry| &e.updated_at,
        &mut rep,
    );
    for l in &incoming.locks {
        if !target.is_week_locked(&l.person_id, &l.week_start) {
            target.locks.push(l.clone());
        }
    }
    rep
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Person, Project, WeekLock};

    fn entry(id: &str, note: &str, updated: &str) -> Entry {
        Entry {
            id: id.into(),
            person_id: "p".into(),
            project_id: "pr".into(),
            start: "2026-09-07T08:00:00Z".into(),
            end: Some("2026-09-07T09:00:00Z".into()),
            note: note.into(),
            updated_at: updated.into(),
            ..Entry::default()
        }
    }

    #[test]
    fn merge_adds_updates_and_skips_duplicates() {
        let mut target = Data::default();
        target.me_person_id = "me".into();
        target.persons.push(Person { id: "p".into(), name: "Anna".into(), updated_at: "2026-09-01T00:00:00Z".into(), ..Person::default() });
        target.projects.push(Project { id: "pr".into(), name: "Web".into(), updated_at: "2026-09-01T00:00:00Z".into(), ..Project::default() });
        target.entries.push(entry("e1", "alt", "2026-09-01T00:00:00Z"));
        target.entries.push(entry("e2", "bleibt", "2026-09-05T00:00:00Z"));

        let mut incoming = Data::default();
        incoming.me_person_id = "other".into();
        incoming.persons.push(Person { id: "p".into(), name: "Anna M.".into(), updated_at: "2026-09-02T00:00:00Z".into(), ..Person::default() });
        incoming.projects.push(target.projects[0].clone()); // identisch
        incoming.entries.push(entry("e1", "neu", "2026-09-03T00:00:00Z")); // jünger → ersetzt
        incoming.entries.push(entry("e2", "älter", "2026-09-04T00:00:00Z")); // älter → bleibt
        incoming.entries.push(entry("e3", "neu dazu", "2026-09-06T00:00:00Z"));
        incoming.entries.push(entry("e3", "Duplikat im Paket", "2026-09-06T00:00:00Z"));
        incoming.locks.push(WeekLock { person_id: "p".into(), week_start: "2026-09-07".into() });
        incoming.locks.push(WeekLock { person_id: "p".into(), week_start: "2026-09-07".into() });

        let rep = merge_into(&mut target, &incoming);
        assert_eq!(target.me_person_id, "me");
        assert_eq!(target.persons[0].name, "Anna M.");
        assert_eq!(target.entries.len(), 3);
        assert_eq!(target.entries.iter().find(|e| e.id == "e1").unwrap().note, "neu");
        assert_eq!(target.entries.iter().find(|e| e.id == "e2").unwrap().note, "bleibt");
        assert_eq!(target.locks.len(), 1);
        assert_eq!(rep.added, 1);
        assert_eq!(rep.entries_added, 1);
        assert_eq!(rep.updated, 2); // Person + e1
        assert_eq!(rep.unchanged, 3); // Projekt, e2, e3-Duplikat

        // Idempotent: zweiter Import ändert nichts
        let rep2 = merge_into(&mut target, &incoming);
        assert_eq!(rep2.added, 0);
        assert_eq!(rep2.updated, 0);
        assert_eq!(target.entries.len(), 3);
    }

    #[test]
    fn newer_compares_instants_not_text() {
        // 10:00+02:00 = 08:00Z ist ÄLTER als 09:00Z
        assert!(!is_newer("2026-10-19T10:00:00+02:00", "2026-10-19T09:00:00Z"));
        assert!(is_newer("2026-10-19T09:00:00Z", "2026-10-19T10:00:00+02:00"));
        assert!(is_newer("2026-10-19T09:00:00.500Z", "2026-10-19T09:00:00Z"));
        assert!(is_newer("2026-10-19T09:00:00Z", "kaputt"));
        assert!(!is_newer("kaputt", "2026-10-19T09:00:00Z"));

        let mut target = Data::default();
        target.entries.push(entry("e", "lokal", "2026-10-19T09:00:00Z"));
        let mut incoming = Data::default();
        incoming.entries.push(entry("e", "fremd", "2026-10-19T10:00:00+02:00"));
        merge_into(&mut target, &incoming);
        assert_eq!(target.entries[0].note, "lokal");
    }

    #[test]
    fn package_roundtrip_and_validation() {
        let mut d = Data::default();
        d.entries.push(entry("e", "n", "2026-09-01T00:00:00Z"));
        let p = Package::new(d.clone(), "2026-09-07T12:00:00Z".into());
        let json = serde_json::to_string(&p).unwrap();
        let back = Package::parse(&json).unwrap();
        // Mit UTF-8-BOM (Windows-Editor) ebenso lesbar
        assert!(Package::parse(&format!("\u{feff}{json}")).is_ok());
        assert_eq!(back.data, d);
        assert!(Package::parse("{\"format\":\"other\",\"version\":1,\"exportedAt\":\"\",\"data\":{}}").is_err());
        assert!(Package::parse("nicht json").is_err());
        assert!(Package::parse_localized("nope", true).unwrap_err().starts_with("Invalid JSON"));
        assert!(Package::parse_localized("{\"format\":\"timelog-package\",\"version\":99,\"exportedAt\":\"\",\"data\":{}}", true)
            .unwrap_err()
            .contains("newer"));
    }
}
