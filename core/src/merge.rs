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
        let p: Package = serde_json::from_str(json).map_err(|e| format!("JSON ungültig: {e}"))?;
        if p.format != PACKAGE_FORMAT {
            return Err("Kein timelog-Paket (format)".into());
        }
        if p.version > PACKAGE_VERSION {
            return Err(format!("Paketversion {} ist neuer als diese App", p.version));
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

/// Generischer Id-Merge für eine Sammlung.
fn merge_vec<T, FId, FUpd>(target: &mut Vec<T>, incoming: &[T], id: FId, updated_at: FUpd, rep: &mut MergeReport) -> u32
where
    T: Clone + PartialEq,
    FId: Fn(&T) -> &str,
    FUpd: Fn(&T) -> &str,
{
    let mut added = 0;
    for item in incoming {
        if id(item).is_empty() {
            continue;
        }
        match target.iter_mut().find(|t| id(t) == id(item)) {
            None => {
                target.push(item.clone());
                rep.added += 1;
                added += 1;
            }
            Some(existing) => {
                if existing == item {
                    rep.unchanged += 1;
                } else if updated_at(item) > updated_at(existing) {
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
    fn package_roundtrip_and_validation() {
        let mut d = Data::default();
        d.entries.push(entry("e", "n", "2026-09-01T00:00:00Z"));
        let p = Package::new(d.clone(), "2026-09-07T12:00:00Z".into());
        let json = serde_json::to_string(&p).unwrap();
        let back = Package::parse(&json).unwrap();
        assert_eq!(back.data, d);
        assert!(Package::parse("{\"format\":\"other\",\"version\":1,\"exportedAt\":\"\",\"data\":{}}").is_err());
        assert!(Package::parse("nicht json").is_err());
    }
}
