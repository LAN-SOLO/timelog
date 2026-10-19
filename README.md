# timelog.

Zeiterfassung mit zwei Modi — für Einzelne und Teams, lokal, ohne Konto.

- **Einfach (kostenlos):** Projekte mit Farbe und optionalem Kunden, Stoppuhr, manuelle Einträge mit Inline-Bearbeitung, Tages- und Wochenansicht mit Tagessummen und Soll-Bilanz, Zusammenfassung je Projekt für Heute / Woche / Monat / frei, CSV-Export, Rundung (keine / 5 / 15 min — nur Anzeige und Export).
- **Experte („tracked“, 12 €/Jahr):** Team mit Personen (Soll-Stunden, Stundensatz), Kunden → Projekte → Tätigkeiten, Abrechenbar-Flag, Stunden-/Euro-Budgets mit Ampel, Monitoring-Dashboard (Stunden je Projekt/Person, Ist/Soll, 8-Wochen-Trend), Berichte nach Kunde/Person/Tätigkeit, PDF-Export, Wochenabschluss je Person, Team-Zusammenführung per JSON-Paket (Id-basierter Merge, offline), Leerlauf-Erkennung, Feierabend-Erinnerung, Tastaturkürzel.
- **Daten:** eine JSON-Datei im App-Datenordner, atomar geschrieben; Zeiten in UTC, Anzeige lokal. Backup = Ordner kopieren.
- **Kein Server, kein Cloud-Sync** — Team-Zusammenführung läuft über Export/Import. Kein Ersatz für Arbeitszeiterfassung mit Prüfsiegel, aber Export für die Buchhaltung.

DE/EN, Dunkel/Hell, signierte In-App-Updates. Keine Telemetrie.
Im Vorabzugang ist der Expertenmodus frei umschaltbar (keine Lizenzprüfung).

**Version 1.0.0** — Test-Release nach Funktions- und Sicherheitsaudit, Details in
[`AUDIT-1.0.md`](AUDIT-1.0.md). Neu gegenüber 0.2: Esc verwirft Zeilen-Änderungen
wirklich, Dezimalwerte (37,5 h / 85,50 €) eingebbar, Dashboard-Balken sichtbar,
CSV-Schutz gegen Formel-Injektion, defekte `data.json` wird gesichert statt
überschrieben, Datei-Kommandos auf .csv/.json/.pdf begrenzt, Backend-Meldungen
auf DE/EN.

## Web-Version (Browser / Telefon)

Die Oberfläche läuft auch ohne Tauri als Webapp: `pnpm build` erzeugt in `dist/` eine
statische Seite (relative Pfade, Manifest, Service Worker), die auf jedem Webspace liegen
kann — auch unter einem Unterpfad. Ohne Tauri übernimmt `src/webapi.ts` die Kommandos aus
`src/api.ts` (gleicher Vertrag) und speichert im `localStorage` des Geräts; Exporte kommen
als Download, Import per Dateiauswahl (`src/files.ts`). Unter 760 px Breite schaltet das
Layout auf Telefon um: Ansichten in der Tab-Leiste unten, Projekte als Schublade, Einträge
als Karten, Modals als Sheets, Formularfelder 16 px (kein iOS-Auto-Zoom). „Zum Home-Bildschirm“
ergibt eine installierbare, offline startende App. Kein Sync mit der Desktop-App — Austausch
über Einstellungen → App → Daten exportieren / importieren (Paketformat wie „Team“).

Lokal prüfen: `pnpm dev` und http://localhost:1434 im Browser öffnen (ohne Tauri → Web-Backend).

## Entwicklung

```sh
pnpm install
pnpm tauri dev
cargo test --workspace
pnpm build                       # tsc + Vite
```

Web-UI-E2E (headless Chrome, ohne Zusatzpakete): siehe Kopf von
`scripts/e2e/web-e2e.mjs` — `pnpm dev`, Chrome mit `--remote-debugging-port=9222`,
dann `node scripts/e2e/web-e2e.mjs /tmp`.

Der Rust-Kern (`core/`, Crate `timelog-core`) ist Tauri-frei und testbar:
Dauer/Rundung, Wochen- und Zeitraumlogik, Aggregation je Projekt/Kunde/Person/Tätigkeit,
Wochen-Trend, Budgetverbrauch, CSV-Erzeugung (RFC-4180-Quoting), JSON-Paket-Merge.
Die Kommandos in `src-tauri/src/commands.rs` folgen dem Vertrag in `src/api.ts`.

## Release-Build (lokal)

```sh
TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/timelog-updater.key)" \
TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" \
pnpm tauri build --bundles app,dmg
```

Details und Roadmap: `TIMELOG_PLAN.md`.
