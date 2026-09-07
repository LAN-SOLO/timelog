# timelog. — Plan

Zeiterfassung mit zwei Modi für Einzelne und Teams. Tauri 2 + React (Vite, TypeScript),
Rust-Workspace mit Tauri-freiem Kern. Terminal-Look wie die anderen LAN-SOLO-Apps
(Mono-UI 13 px, `--radius: 4px`, Uppercase-Mono-Labels, `//`-Hinweiszeilen), Dunkel/Hell,
DE/EN, signierte In-App-Updates. Kein Server, kein Konto, keine Telemetrie.

## Zwei Modi — und der Tarif

**Einfach (Free, 0 €)** — das Nötigste für eine Person:
- Projekte (Name, Farbe, optional Kunde), archivieren
- Stoppuhr mit Projekt und Notiz, ein Timer gleichzeitig, sichtbar in der Kopfzeile
- Manuelle Einträge (von–bis), Inline-Bearbeitung, duplizieren, erneut starten, löschen
- Tages- und Wochenansicht mit Tagessummen, Kalenderwoche wechseln
- Soll-Stunden pro Woche → Wochenbilanz
- Zusammenfassung je Projekt (heute / Woche / Monat / frei), CSV-Export (Einträge + Zusammenfassung)
- Rundung keine / 5 / 15 min — nur Anzeige/Export, Rohdaten bleiben exakt

**Experte = Tarif „tracked“ (12 €/Jahr)** — alles aus Einfach plus:
- Team: Personen mit Wochen-Soll, Stundensatz, Farbe; Einträge tragen eine Person; Personen-Filter
- Struktur: Kunden → Projekte → Tätigkeiten; Abrechenbar-Flag je Eintrag (Standard je Tätigkeit/Projekt)
- Budgets: Stunden oder Euro je Projekt, Ampel bei 80 % / 100 %; Stundensatz je Projekt oder Person
- Dashboard: Stunden gesamt, abrechenbar %, aktive Projekte, Personen; Balken je Projekt;
  Ist/Soll je Person; Budget-Ampel; Trend der letzten 8 Wochen (CSS-Säulen, keine Chart-Lib)
- Berichte nach Projekt / Kunde / Person / Tätigkeit mit Detailliste; PDF-Export (jspdf, Courier, Firmenname)
- Wochenabschluss je Person (Sperre), wieder öffnen
- Team-Zusammenführung ohne Server: JSON-Paket exportieren, beim PL importieren (Id-Merge, jüngere Änderung gewinnt)
- Komfort: Leerlauf-Erkennung, Feierabend-Erinnerung, Tastaturkürzel (s, n, ← →, 1–5, ?)

Im Code gibt es (wie bei allen bisherigen Apps) noch keine Lizenzprüfung: Der Expertenmodus ist
umschaltbar und trägt das Badge „tracked“ mit dem Hinweis „im Vorabzugang freigeschaltet“.

## Datenmodell

Person{id,name,email,weeklyHours,hourlyRate,color,archived,updatedAt} ·
Client{id,name,archived,updatedAt} ·
Project{id,clientId?,name,color,budgetHours,budgetAmount,hourlyRate,billableDefault,archived,updatedAt} ·
Task{id,projectId,name,billableDefault,archived,updatedAt} ·
Entry{id,personId,projectId,taskId?,start(RFC3339 UTC),end?(null = läuft),note,billable,tags[],locked,updatedAt} ·
WeekLock{personId,weekStart(YYYY-MM-DD lokal)} ·
Data{mePersonId,persons,clients,projects,tasks,entries,locks}

`updatedAt` steuert den Merge. `data.json` liegt im App-Datenordner (atomar: Temp-Datei + rename),
`settings.json` im Konfigurationsordner.

## Architektur

- `core/` (`timelog-core`): reine Logik ohne Tauri — `model` (Datentypen), `time` (Dauer, Rundung,
  Wochenbeginn, Zeiträume, Überlappung), `summary` (Aggregation je Gruppe, Wochen-Trend, Budgetverbrauch,
  Satz-Auflösung Projekt → Person), `csv` (RFC-4180-Quoting, DE `;`/Dezimalkomma, EN `,`/Punkt),
  `merge` (Paketformat `timelog-package` v1, Id-Merge). Unit-Tests hier.
- `src-tauri/`: `store` (JSON-Datei, atomar, Default-Person „Ich/Me“), `settings`, `commands`
  laut `src/api.ts` (CRUD, Timer, summary/weekly_totals/budget_usages, export_csv, export/import_package,
  lock/unlock_week, read/write_file, Updater).
- `src/`: React-UI — `App.tsx` (Kopfzeile mit Timer, Modus, Personen-Filter; Leerlauf-Dialog,
  Shortcuts, Update-Banner), `components/` (Sidebar, EntryList mit Inline-Zeilen, Reports, Dashboard,
  Team, ProjectModal, SettingsModal, Help, RangeBar), `pdf.ts` (jspdf + autotable), `i18n.ts` (DE Sie-Form / EN),
  `util.ts` (Datum/Zeit lokal ↔ UTC), `styles.css` (Terminal-Look, `html[data-theme='light']`, Akzente).

## Roadmap

- 0.1: Projekte, Stoppuhr, Einträge inline, Tag/Woche, Berichte + CSV, beide Modi, Team (Personen,
  Kunden, Tätigkeiten), Budgets, Dashboard, PDF, Wochenabschluss, Paket-Export/Import, Leerlauf-
  Erkennung, Feierabend-Erinnerung, Shortcuts, Handbuch, Updater.
- 0.2: Tags im UI (Eingabe + Filter), CSV-Import, Kalender-Grid der Woche, Eintrag per Dauer statt
  von–bis, Tätigkeiten direkt aus der Zeile anlegen, Logo im PDF, Zeitraum-Vergleich im Dashboard.
- 0.3: Menüleisten-/Tray-Timer, globale Kürzel, Erinnerung „Timer vergessen?“ beim Start,
  Rechnungsübergabe an invoices (Positionen aus abrechenbaren Stunden), Lizenzprüfung „tracked“.
