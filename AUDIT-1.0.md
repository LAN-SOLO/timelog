# timelog. 1.0.0 — Funktions- und Sicherheitsaudit

Stand: 2026-10-19 · Basis: `7460951` (0.2.0) · Ziel: Test-Release 1.0.0 für macOS und Windows
(CI-Build später per `workflow_dispatch` aus `main`).

Legende Teststatus:

- **auto** — durch automatisierten Test abgedeckt (`cargo test` oder Web-E2E, siehe unten)
- **e2e** — in der echten Oberfläche (Vite-Dev-Server, headless Chrome) durchgeklickt, Web-Backend
- **statisch** — nur Code-Review (Tauri-nativ: Dialoge, Dateisystem, Updater, Fenster)
- **manuell** — braucht einen Menschen auf macOS/Windows (Checkliste unten)

## 1. Testläufe

| Lauf | Befehl | Ergebnis |
|---|---|---|
| Rust-Kern + App | `cargo test --workspace` | 27 bestanden (Kern 21, App 6), 0 fehlgeschlagen; unter Windows zusätzlich 1 Laufwerksbuchstaben-Test (`cfg(windows)`) |
| Frontend | `pnpm build` (tsc + Vite) | fehlerfrei |
| Web-E2E | `node scripts/e2e/web-e2e.mjs` gegen `pnpm dev` | 59 bestanden, 0 fehlgeschlagen, keine Konsolenfehler |
| Abhängigkeiten | `cargo audit`, `pnpm audit` | siehe Abschnitt 4 |

Das Web-E2E nutzt dieselbe Oberfläche wie die Desktop-App; nur das Backend ist `src/webapi.ts`
(localStorage) statt der Tauri-Kommandos. Die Fachlogik der Tauri-Seite ist über die Rust-Tests
abgedeckt; die IPC-Verdrahtung (Kommandonamen/Argumente in `src/api.ts` ↔ `src-tauri/src/commands.rs`)
wurde statisch geprüft — alle 30 Kommandos stimmen in Name und camelCase-Argumenten überein.

## 2. Funktionsinventar

| Bereich | Funktion | Status |
|---|---|---|
| Projekte | anlegen (Name, Farbe, Kunde per Freitext → neuer Kunde) | e2e |
| | bearbeiten, Budget h/€, Stundensatz, „standardmäßig abrechenbar“ (Experte) | e2e (Dezimalwerte) |
| | archivieren / Archivierte anzeigen, löschen nur ohne Einträge | e2e (Löschsperre), auto-Logik |
| | Projektfilter per Klick in der Seitenleiste | statisch |
| Stoppuhr | Start mit Projekt + Notiz, Stopp, nur ein Timer | e2e |
| | „Erneut starten“ übernimmt Projekt/Tätigkeit/Notiz | e2e |
| | Leerlauf-Erkennung (weiter / jetzt stoppen / bei letzter Aktivität) | statisch |
| | Feierabend-Erinnerung (Experte) | statisch |
| Einträge | „+ Eintrag“ (Anschluss an letzten Eintrag, 1 h) | e2e |
| | Inline: Projekt, Tätigkeit, Von, Bis, Notiz, abrechenbar | e2e (Von/Bis/Notiz) |
| | Enter speichert, **Esc verwirft** | e2e (Fehler gefunden + behoben) |
| | ungültige Uhrzeit, Start nach Ende → Meldung + Zeile zurück | e2e |
| | „Bis“ vor „Von“ = über Mitternacht | e2e |
| | duplizieren, löschen mit Nachfrage | e2e |
| Tag/Woche | Tages-/Wochensummen, Soll, Bilanz, KW-Navigation | e2e |
| | Woche abschließen / öffnen, Sperrwirkung im Backend | e2e |
| Berichte | Zeitraum Heute/Woche/Monat/frei, Gruppierung Projekt/Kunde/Person/Tätigkeit | e2e |
| | Detailliste | e2e |
| | CSV Einträge / Zusammenfassung (DE `;` + Dezimalkomma, EN `,`), RFC-4180-Quoting | auto + e2e |
| | PDF-Bericht (jsPDF, Firmenname, Summen + Details) | e2e (Bytes erzeugt, `%PDF-`); Dateidialog manuell |
| | Rundung 0/5/15 min nur in Summen/Export | auto |
| Dashboard | KPIs, Stunden je Projekt, Ist/Soll je Person, Budget-Ampel, 8-Wochen-Trend | e2e (Balken-Fehler gefunden + behoben), auto (Aggregation) |
| Team | Personen (Dezimal-Soll/-Satz), Kunden, Tätigkeiten anlegen/archivieren/löschen | e2e |
| | eigene Person / Projekt mit Einträgen nicht löschbar | e2e + statisch (Rust) |
| | Paket exportieren (eigene / alles), importieren, Id-Merge idempotent | auto + e2e |
| | fremdes/zu neues Paket abgelehnt | auto + e2e |
| Einstellungen | Sprache, Modus, Hell/Dunkel, Akzent (Live-Vorschau, Esc verwirft) | e2e |
| | Rundung, Wochenbeginn, Soll, Leerlauf, Feierabend, Löschnachfrage | e2e (teilweise), auto (Bereinigung) |
| | Firmenname, Datenordner, Updates prüfen/installieren, Auto-Update | statisch (Tauri) |
| Kürzel (Experte) | s, n, ← →, 1–5, ?, Esc (Esc auch im einfachen Modus) | e2e (s, 2, 3, 4, Esc) |
| Hilfe | Tutorial, Handbuch mit Suche, DE/EN-Umschalter | e2e |
| Web-Version | localStorage-Backend, Export/Import, Telefon-Layout ≤ 760 px, PWA | e2e (Layout, Backend), PWA statisch |
| Daten | atomares Schreiben, Sicherung defekter `data.json` | auto |

## 3. Gefundene und behobene Fehler

1. **Esc in Eintragszeilen speicherte statt zu verwerfen.** `blur()` nach Esc löste den Commit mit
   dem getippten Wert aus. Jetzt: Esc setzt ein Flag, der Commit wird übersprungen. Abgelehnte
   Änderungen (z. B. Start nach Ende) setzen die Zeile auf den gespeicherten Stand zurück.
2. **Dezimalwerte nicht eingebbar** (Soll-Stunden, Stundensatz, Budgets): „37,5“ wurde zu „375“.
   Neues `NumField` hält den Text, akzeptiert Komma und Punkt.
3. **Dashboard-Balken unsichtbar**: `.hbar .fill` war ein Inline-`span` → Breite wirkungslos;
   Wertspalte schnitt „28 % verbraucht“ ab.
4. **Sperranzeige in „Alle Personen“**: die eigene abgeschlossene Woche sperrte optisch auch Einträge
   anderer Personen. Jetzt Sperre je Eintrag nach Woche seiner Person.
5. **Esc schloss Dialoge nur im Expertenmodus.** Jetzt in beiden Modi.
6. **React-Warnung „Cannot update a component while rendering“** in den Einstellungen (setState im
   Updater).
7. **Backend-Fehlermeldungen nur Deutsch** — jetzt in der eingestellten Sprache (alle Kommandos,
   Paket-Import, Updater).
8. **Update-Installationsfehler wurden verschluckt** — erscheinen jetzt als Meldung.
9. **Nicht-transaktionale Änderungen**: schlug das Speichern fehl (volle Platte, unter Windows von
   Virenscanner/Backup gesperrte Datei), war der Bestand im Speicher trotzdem geändert. Jetzt wird
   eine Kopie geändert und erst nach erfolgreichem Speichern übernommen.

## 4. Sicherheit

| # | Befund | Schwere | Status |
|---|---|---|---|
| S1 | `read_text_file`/`write_text_file`/`write_file` akzeptierten beliebige Pfade — jedes Skript im WebView hätte beliebige Dateien lesen/überschreiben können | mittel | **behoben**: nur absolute Pfade, Lesen nur `.json` (reguläre Datei, max. 64 MB), Schreiben nur `.csv`/`.json` bzw. `.pdf`, Ordner abgelehnt; Tests inkl. Windows-Laufwerksbuchstaben |
| S2 | CSV-Formel-Injektion: Notizen/Namen aus importierten Team-Paketen wie `=HYPERLINK(…)` wurden in Excel als Formel ausgeführt | mittel | **behoben**: Freitext mit `= + - @ Tab CR` am Anfang bekommt `'` (Rust + Web, Tests) |
| S3 | Defekte `data.json` → leerer Start und Überschreiben beim nächsten Speichern = Datenverlust | mittel | **behoben**: Sicherung als `data.json.corrupt-<Zeit>` (Web: `timelog.data.corrupt-*`), `fsync` vor `rename` |
| S4 | Einstellungen ungeprüft gespeichert (z. B. Rundung 7, Sprache „xx“) | niedrig | **behoben**: `Settings::sanitized` (Rust) / `sanitizeSettings` (Web) |
| S5 | Capabilities: `opener:default` ohne Nutzung, `dialog:default` breiter als nötig | niedrig | **behoben**: Opener-Plugin entfernt, Dialog nur `allow-open`/`allow-save` |
| S6 | Mutex-Poisoning hätte nach einem Panic jedes weitere Kommando abstürzen lassen | niedrig | **behoben** |
| S7 | `rustls` 0.23.44 (RUSTSEC-2026-0285/0346–0349; Updater-HTTPS) | mittel | **behoben**: 0.23.46 (Patch) |
| S8 | `source-map-js` 1.2.1 (nur Dev/Vite) | niedrig | **behoben**: 1.2.2 |
| S9 | `jspdf` 2.5.2 (+ optional `dompurify`): Advisories zu `addJS`, AcroForm, FreeText-Farbe, XMP, `output('…newwindow')`, Bild-Decodern, Node-`loadFile` | hoch laut Audit | **offen (bewusst)**: Fix nur mit Major-Upgrade auf jsPDF ≥ 4.2.1 + jspdf-autotable 5. timelog nutzt ausschließlich `text`, `line`, `autoTable`, `output('arraybuffer')` — keiner der betroffenen Pfade, keine Bilder, kein HTML (`dompurify` wird nie geladen). Empfehlung: Upgrade in 1.1 mit PDF-Sichtprüfung |
| S10 | `zip` 4.6.1 im Updater (RUSTSEC-2026-0367/0368/0369, Entpacken) | mittel laut Audit | **offen**: kommt mit `tauri-plugin-updater` 2.11; entpackt werden nur Update-Archive, deren Minisign-Signatur vorher gegen den eingebauten Schlüssel geprüft wurde. Mit dem nächsten Updater-Release aktualisieren |
| S11 | `glib` 0.18 unsound, `unic-*`/`proc-macro-error` unmaintained (Linux-/Build-Abhängigkeiten von Tauri) | info | offen, keine Wirkung auf macOS/Windows |

Geprüft und in Ordnung:

- **CSP** `default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:` — kein
  Remote-Inhalt, kein `unsafe-eval`. React escaped alle Ausgaben; kein `dangerouslySetInnerHTML`,
  kein Markdown/HTML-Rendering.
- **Updater**: Minisign-Pubkey gesetzt, Endpoint `https://github.com/…/latest.json`, TLS-Prüfung
  nicht abgeschaltet.
- **IPC-Eingaben**: Zeiten werden als RFC 3339 geparst, Ende ≥ Start, Projekt/Person/Tätigkeit auf
  Existenz geprüft, Sperren serverseitig durchgesetzt, Wochenzahl auf 1–52 begrenzt.
- **Keine Secrets/Krypto** in der App (kein Konto, keine Schlüssel); Telemetrie gibt es nicht.
- **Temp-Dateien**: nur `data.json.tmp`/`settings.json.tmp` im eigenen App-Ordner, bei Fehler entfernt.
- **localStorage** (nur Web-Version) enthält die Zeitdaten selbst — gewollt und im Handbuch erklärt.
- **Fehlermeldungen** enthalten höchstens Dateisystem-Fehlertexte zu vom Nutzer gewählten Pfaden.

## 5. Windows- und macOS-Review (statisch)

- Kein `cfg(target_os)`-Code; Pfade nur über `PathBuf` und Tauri-`app_data_dir`/`app_config_dir`
  (Windows: `%APPDATA%\com.lan-solo.timelog`, macOS: `~/Library/Application Support/com.lan-solo.timelog`).
- Atomares Ersetzen: `std::fs::rename` ersetzt unter Windows das Ziel (`MOVEFILE_REPLACE_EXISTING`);
  unter Windows wird das Umbenennen bis zu fünfmal wiederholt (Virenscanner/Sync-Clients halten
  frische Dateien kurz offen). Schlägt es endgültig fehl (Datei gesperrt), bleibt der Bestand im Speicher unverändert und die Meldung
  „Speichern fehlgeschlagen“ erscheint.
- Dateiendungen werden ohne Groß-/Kleinschreibung geprüft (`.CSV` unter Windows).
- `windows_subsystem = "windows"` in Release-Builds (kein Konsolenfenster).
- `window.confirm` wird nicht benutzt (WebView2/WKWebView-unzuverlässig) — eigener Dialog.
- `.github/workflows/build.yml`: nichts versionsabhängig; MSI verlangt `major.minor.patch` → 1.0.0
  passt. Signatur/Notarisierung unverändert.

## 6. Bekannte Grenzen

- Keine Lizenzprüfung: Expertenmodus („tracked“) im Vorabzugang frei umschaltbar.
- Kein Sync zwischen Geräten — Team-Zusammenführung über JSON-Pakete; beim Merge gewinnt die
  jüngere Änderung, auch gegenüber lokal gesperrten Einträgen.
- Tags werden gespeichert und exportiert, es gibt aber noch keine Oberfläche zum Setzen.
- Leerlauf-Erkennung sieht nur Eingaben im timelog-Fenster, nicht systemweit.
- Einträge erscheinen am Starttag; die Tagesansicht zählt die ganze Dauer dort, Berichte schneiden
  exakt am Zeitraum.
- Linux-Builds werden gebaut, aber nicht aktiv getestet.

## 7. Manuelle Testcheckliste (Windows 10/11 und macOS 13+)

Jeweils mit dem CI-Build 1.0.0, beide Sprachen (Einstellungen → Allgemein), hell und dunkel.

**Start & Daten**
- [ ] Installieren (Windows: NSIS-Setup und MSI; macOS: DMG, startet ohne Gatekeeper-Rückfrage)
- [ ] Erststart zeigt Tutorial; Einstellungen → App zeigt Version 1.0.0 und den Datenordner
- [ ] Update-Prüfung: „Aktuell.“ bzw. Banner (kein Absturz offline)
- [ ] App beenden, `data.json` mit Editor kaputt machen, neu starten → leerer Start, daneben liegt
      `data.json.corrupt-…` mit dem alten Inhalt
- [ ] Windows: `data.json` in einem anderen Programm exklusiv geöffnet halten, Eintrag ändern →
      Meldung „Speichern fehlgeschlagen“, nach Schließen funktioniert Speichern wieder

**Erfassen**
- [ ] Projekt mit neuem Kunden anlegen; Timer starten/stoppen; Uhr läuft in der Kopfzeile
- [ ] „+ Eintrag“, Von/Bis/Notiz ändern (Enter), Esc verwirft, „22:00–01:00“ über Mitternacht
- [ ] Start nach Ende eingeben → Meldung, Zeile springt zurück
- [ ] Duplizieren, Erneut starten, Löschen mit Nachfrage
- [ ] Leerlauf auf 1 Minute stellen, Timer starten, 1 Minute nichts tun → Dialog, alle drei Knöpfe

**Berichte & Export**
- [ ] CSV Einträge und Zusammenfassung speichern (Dialog), in Excel/Numbers öffnen: Umlaute,
      Semikolon (DE) bzw. Komma (EN), Notiz „=1+1“ erscheint als Text `'=1+1`
- [ ] Beim Speichern die Endung entfernen/ändern → Meldung „Dateityp nicht erlaubt“
- [ ] PDF-Bericht (Experte) speichern und öffnen: Firmenname, Summen, Detailliste, Seitenzahlen

**Experte**
- [ ] Person mit 37,5 h / 85,50 € anlegen, Tätigkeit, Kunde; Budgets 12,5 h am Projekt
- [ ] Dashboard: Balken sichtbar, Budget-Ampel-Farben, Trend
- [ ] Woche abschließen → Einträge mit Schloss, „+ Eintrag“ gesperrt; wieder öffnen
- [ ] Paket „Eigene“ exportieren, auf zweitem Rechner/Benutzer importieren, zweiter Import meldet
      0 neu
- [ ] Kürzel s, n, ←/→, 1–5, ?, Esc

**Hilfe & Darstellung**
- [ ] Hilfe: Tutorial, Suche, DE/EN-Umschalter
- [ ] Fenster auf Mindestgröße 900×600 verkleinern — nichts überlappt
- [ ] Windows: hohe DPI (150 %), Dunkel/Hell, Icons ohne weiße Ecken

## 8. Verifikation (unabhängige Zweitprüfung)

Zweiter, skeptischer Durchgang über den Diff `7460951..HEAD` mit eigenen Testläufen.

**Testläufe (selbst ausgeführt)**
- `cargo test --workspace`: 27 bestanden, 0 fehlgeschlagen (core 21, App 6); der
  `cfg(windows)`-Test läuft nur in der Windows-CI.
- `pnpm build` (tsc + vite): fehlerfrei. `cargo clippy --workspace`: nur Stilhinweise
  (abgeleitete `Default`-impls, zu viele Argumente, gleiche `if`-Zweige), keine Fehler.
- Web-E2E `node scripts/e2e/web-e2e.mjs` (headless Chrome via CDP gegen `pnpm dev`):
  60 bestanden, 0 fehlgeschlagen, keine Konsolenfehler — inkl. des neuen Tests „Timer je Person“.
- `pnpm install --frozen-lockfile` und `cargo metadata --locked`: Lockfiles konsistent (CI-tauglich).
- `cargo audit`: unverändert 3 × zip (transitiv über den Updater) plus Unmaintained/Unsound-Warnungen.
  `pnpm audit`: 29 Befunde, alle jspdf (2 kritisch, 8 hoch). Geprüft: `src/pdf.ts` nutzt nur
  `text`/`line`/`autoTable`/`output('arraybuffer')` — kein `addImage`, `html`, `addJS`, AcroForm
  oder Ausgabe in neuem Fenster. Bewertung aus Abschnitt 4 bestätigt; Upgrade bleibt für 1.1.
- Version 1.0.0 geprüft in `package.json`, `tauri.conf.json`, `src-tauri/Cargo.toml`,
  `core/Cargo.toml`, `Cargo.lock` (beide Pakete), `APP_VERSION` und README. Tauri 2.11.5 (Rust)
  passt zu `@tauri-apps/api` 2.11.1, Dialog-Plugin 2.7.3 auf beiden Seiten.

**Bestätigt**
- IPC-Vertrag: 30 Kommandos identisch in `src/api.ts` und `generate_handler!`.
- Dateikommandos: nur absolute Pfade mit erlaubter Endung; Windows-Speichern-Dialog setzt über
  `SetDefaultExtension` (rfd 0.16) die Endung selbst, macOS erzwingt sie über `allowedFileTypes`.
- Esc-Verwerfen, Dezimalfelder, Dashboard-Balken, Wochensperre je Person: per E2E nachvollzogen.

**Zusätzlich gefunden und behoben**
- *Fremde laufende Timer wurden gestoppt bzw. in der Kopfzeile angezeigt.* Ein Team-Paket, das
  eine Kollegin mit laufender Stoppuhr exportiert, brachte einen Eintrag ohne Ende mit. Die
  Kopfzeile zeigte dann ggf. deren Timer, „Stopp“ und jeder eigene Start beendeten ihn (und
  machten ihn durch das neue `updatedAt` beim nächsten Merge zur „jüngeren“ Version). Jetzt gilt
  in Rust und Web-Backend: `start_timer` beendet nur laufende Einträge derselben Person,
  `stop_timer` und `running` betreffen nur die eigene Person, die Kopfzeile zeigt nur den eigenen
  Timer, „Erneut starten“ gibt es nur an eigenen Einträgen. E2E-Test ergänzt; Hilfe DE/EN ergänzt.
- *CSV-Umlaute in Excel unter Windows.* Die CSV war UTF-8 ohne BOM — Excel öffnet das per
  Doppelklick als ANSI („TÃ¤tigkeit“). Das Frontend setzt beim Speichern jetzt einen BOM davor
  (App und Web). Hilfe DE/EN ergänzt.
- *Team-Paket/Sicherung mit BOM wurde abgelehnt.* Unter Windows im Editor gespeicherte JSON-Dateien
  beginnen oft mit einem UTF-8-BOM; `serde_json` meldete „JSON ungültig“. `Package::parse` und das
  Web-Backend entfernen den BOM jetzt (Test ergänzt).
- *Windows: Speichern scheiterte sporadisch am Virenscanner.* `write_atomic` wiederholt das
  Umbenennen unter Windows bis zu fünfmal (max. ~0,4 s), bevor der Fehler gemeldet wird.

**Weiter offen / nur statisch geprüft**
- Laufende Einträge anderer Personen aus einem Team-Paket zählen in Berichten weiter bis „jetzt“,
  bis ein neueres Paket das Ende liefert (bekannte Grenze, keine Datenänderung).
- Der Merge vergleicht Ids linear (O(n²)); bei ~10 000 Einträgen unkritisch, bei sehr großen
  Paketen kann der Import einige Sekunden dauern.
- Native Dialoge, Updater, Leerlauf/Feierabend und das Windows-Umbenennen unter Sperre sind
  weiterhin nur über die Checkliste in Abschnitt 7 prüfbar. Zusätzlich dort prüfen: CSV per
  Doppelklick in Excel (Windows) zeigt Umlaute korrekt; Team-Paket mit laufendem Timer einer
  anderen Person importieren → Kopfzeile bleibt beim eigenen Timer.


## Runde 2

Stand: 2026-10-20 · Basis: `adc6083` · Ziel unverändert 1.0.0 (keine Versionsänderung).
Durchgang über die Fehlermuster L1–L13 aus den anderen Apps plus Reste aus Runde 1.

**Testläufe (selbst ausgeführt)**

| Lauf | Befehl | Ergebnis |
|---|---|---|
| Rust | `cargo test --workspace` | 31 bestanden (Kern 22, App 9), 0 fehlgeschlagen; unter Windows zusätzlich 2 `cfg(windows)`-Tests |
| Windows-Typecheck | `cargo check --target x86_64-pc-windows-msvc --workspace --tests` (vom Mac, ohne Linken) | fehlerfrei, keine Warnungen — inkl. der `cfg(windows)`-Tests |
| Clippy | `cargo clippy --workspace` | nur die bekannten Stilhinweise aus Runde 1 |
| Frontend | `pnpm build` (tsc + Vite) | fehlerfrei |
| Web-E2E | `node scripts/e2e/web-e2e.mjs` | 64 bestanden, 0 fehlgeschlagen |
| UI mit Tauri-Mock | `node scripts/e2e/ui-mock-ipc.mjs` (neu) bei 900×600 sowie `WIDTH=761` und `1240` | je 157 bestanden, 0 fehlgeschlagen: DE/EN × dunkel/hell, alle fünf Ansichten, Einstellungen (4 Reiter), Projekt-Dialog, Lösch-Nachfrage, Hilfe, Telefon 390 px |
| Abhängigkeiten | `cargo audit` | unverändert: 3 × `zip` (S10), Unmaintained/Unsound-Hinweise (S11) |

Der Tauri-Mock leitet `__TAURI_INTERNALS__.invoke` an das Web-Backend weiter, liefert für
`plugin:dialog|save/open` Pfade wie `C:\Users\Jörg Müller\OneDrive\…` und ersetzt
`window.confirm`/`alert` wie tauri-plugin-dialog 2.7 (asynchroner Stub, Aufrufe gezählt). Damit
laufen die `isTauri`-Pfade von `src/files.ts` (Speichern-/Öffnen-Dialog, `write_text_file`,
`write_file`, `read_text_file`) im Browser.

**L1–L13**

| # | Muster | Ergebnis |
|---|---|---|
| L1 | `window.confirm/alert/prompt` | nicht benutzt; eigener Promise-Dialog. Test: Abbrechen löscht nicht, OK löscht, 0 Aufrufe von `window.confirm/alert` |
| L2 | Backend-Fehler in falscher Sprache | Runde 1 übersetzt; **behoben:** restliche Rohtexte (Updater-Initialisierung, Base64, Paket-Export, nicht lesbare Datei) und verständliche Datei-Fehler (`io_hint`: „in einem anderen Programm geöffnet“, Speicherplatz, Berechtigung, schreibgeschützt), Systemtext in Klammern dahinter |
| L3 | Sprache beim Erststart | in Ordnung: `sys-locale` liest unter macOS `CFLocale`, unter Windows `GetUserDefaultLocaleName` (nicht `LANG`); Web: `navigator.language` |
| L4 | BOM | CSV mit BOM, Import mit UTF-8-BOM (Runde 1); **behoben:** Import von UTF-16-Dateien mit BOM (Windows-Editor „Unicode“) in App (`decode_text`) und Web (`decodeText`), Tests |
| L5 | Windows-Dateisystem | Umbenennen mit Wiederholung (Runde 1); **behoben:** reservierte Gerätenamen (`CON`, `NUL`, `COM1`, `LPT9` … auch mit Endung), `\ / : * ? " < > |`, Steuerzeichen, Punkt/Leerzeichen am Ende werden im Backend abgelehnt (nur unter Windows, Test plattformunabhängig); abgebrochene Temp-Datei wird aufgeräumt. Laufwerksbuchstaben: `C:bericht.pdf` ist nicht absolut → abgelehnt. Lange Pfade: Rust-`std` setzt `\\?\` selbst. Umlaute/Leerzeichen: Pfad wird unverändert durchgereicht (Mock-Test) |
| L6 | Kürzel-Beschriftung | keine Strg/⌘-Kürzel; nur Einzeltasten (s, n, ←/→, 1–5, ?, Esc) |
| L7 | Remote-Inhalte | keine: kein HTML-Rendering, kein `iframe`/`object`, CSP `default-src 'self'` |
| L8 | Hauptthread | **behoben:** Alle Tauri-Kommandos waren synchron und liefen damit auf dem Hauptthread — jedes Speichern (fsync + Umbenennen mit bis zu ~0,4 s Wiederholung unter Windows), Paket-Import und Datei-Schreiben fror das Fenster kurz ein. Jetzt `async` (Tokio-Pool); `set_settings` hält die Sperre während des Schreibens, damit zwei Aufrufe nicht dieselbe `settings.json.tmp` beschreiben. Merge mit Id-Index statt O(n²) (Kern + Web) |
| L9 | Lange Aufgaben / Wechsel | **behoben:** offene Leerlauf-Frage wird verworfen, sobald der Timer anderswo gestoppt oder neu gestartet wird (sonst erschien sie beim nächsten Timer mit alten Zeiten, „bei letzter Aktivität stoppen“ setzte ein Ende vor dem Start). Import-Knöpfe (Team, Einstellungen) während des Imports gesperrt |
| L10 | Zeit | **behoben:** KW-Anzeige bei Wochenbeginn Sonntag zeigte die ISO-Woche des Sonntags (So 18.10.–Sa 24.10.2026 als KW 42 statt 43) — neue `weekNumber()` an allen fünf Stellen. **behoben:** Merge verglich `updatedAt` als Text (`10:00+02:00` galt als jünger als `09:00Z`); jetzt als Zeitpunkt (Rust `is_newer`, Web `isNewer`), Tests. DST: Tagesgrenzen über `setDate`/`Local::from_local_datetime` (in Ordnung) |
| L11 | Bestätigung / Fehler sichtbar | **behoben:** `set_settings` verwarf Schreibfehler still (Einstellungen schienen gespeichert, waren nach dem Neustart weg) — jetzt Fehlermeldung, alter Stand bleibt aktiv. Web-Backend: `mutate`/`set_settings` übernehmen erst nach erfolgreichem `localStorage.setItem` (vorher war der Bestand im Speicher bei „Speicher voll“ trotzdem geändert), Test |
| L12 | Texte DE/EN, Hilfe | **behoben:** „1 projekte“ / „1 Einträge“ → Singular/Plural (`projectCount`, `entryCount`). Hilfe DE/EN ergänzt (KW bei Sonntag, UTF-16-Import, Merge nach Zeitpunkt, Datei-in-Programm-geöffnet, reservierte Windows-Namen). Mock-Durchlauf findet keine Texte der jeweils anderen Sprache |
| L13 | Updater | Version 1.0.0 (semver-Vergleich im Plugin), Endpoint/Pubkey unverändert, Fehler mit übersetztem Präfix; **ergänzt:** Detailtext des Prüf-Fehlers als Tooltip in Einstellungen → App |

**Layout (gefunden im Mock-Durchlauf, behoben)**

- Kopfzeile bei gestopptem Timer: Bei 900 px **und** bei der Standardgröße 1240 px lag der
  Personenfilter (Experte, > 1 Person) über dem Start-Knopf — `.timer` hatte `min-width: 260px`,
  der Inhalt war breiter und ragte unter das nächste Element. Jetzt schrumpfen Projektwahl und
  Notizfeld, Knöpfe nicht; der Personenfilter ist auf 200 px begrenzt.
- Kopfzeile bei laufendem Timer (761–1000 px): Vom Projektnamen blieb nur der Farbpunkt, die
  Notiz erschien als „\ /“. Jetzt hat der Projektname Vorrang, Notiz und Startzeit werden dort
  ausgeblendet.
- Team → Wochenabschluss: Knopf „Woche abschließen“ ragte bei 900 px aus dem Panel (Zeile ohne
  Umbruch, Grid-Spalten `1fr` ohne `minmax(0, …)`).
- Web-Version 761–899 px (Tablet, unter dem Desktop-Mindestfenster): Kopfzeile bricht um statt zu
  überlappen; Eintragszeilen im Expertenmodus passen in die Ansicht.

**Weiter offen**

- S9 `jspdf` 2.5.2 → Major-Upgrade (≥ 4.2.1 + jspdf-autotable 5) für 1.1, mit PDF-Sichtprüfung.
- S10 `zip` 4.6.1: Der nächste kompatible Schritt (`tauri-plugin-updater` 2.14) zieht Tauri
  2.11 → 2.12 und rund 30 weitere Crates mit — für einen Test-Build zu groß. Wirkung bleibt gering:
  macOS-Updates kommen als `.app.tar.gz` (tar/flate2), Windows-Updates als NSIS-`.exe`/`.msi`;
  der `zip`-Pfad wird nur für v1-kompatible `.zip`-Artefakte benutzt, und vorher wird die
  Minisign-Signatur geprüft.
- Bekannte Grenzen aus Abschnitt 6 unverändert (u. a.: beim Merge gewinnt die jüngere Änderung
  auch gegenüber lokal gesperrten Einträgen — eine Sperre per Merge zu schützen würde auch das
  Wiederöffnen durch die Projektleitung blockieren).

**Nur auf echter Hardware prüfbar (zusätzlich zu Abschnitt 7)**

- [ ] Windows: Fenster bleibt beim Speichern bedienbar, auch mit aktivem Virenscanner/OneDrive
      (Kommandos laufen jetzt asynchron).
- [ ] Windows: CSV in Excel geöffnet lassen, erneut exportieren und dieselbe Datei überschreiben →
      Meldung „Die Datei ist in einem anderen Programm geöffnet …“; nach dem Schließen klappt es.
- [ ] Windows: Im Speichern-Dialog `NUL.csv` oder `CON.pdf` eingeben → Meldung „Dateiname unter
      Windows nicht erlaubt“, keine Datei, kein Hänger.
- [ ] Windows-Editor: Team-Paket als „Unicode“ (UTF-16) speichern und importieren → wird gelesen.
- [ ] Einstellungen speichern, wenn der Config-Ordner schreibgeschützt ist → Fehlermeldung statt
      stillem Verlust (macOS: Rechte von `~/Library/Application Support/com.lan-solo.timelog`
      entziehen).
- [ ] Wochenbeginn Sonntag: KW in Woche, Berichte, Dashboard, Team stimmt mit dem Kalender
      (Montag) überein.
- [ ] Fenster 900×600 und 1240×800, Experte mit zwei Personen, Timer gestoppt und laufend: nichts
      überlappt in der Kopfzeile (macOS und Windows, 100 % und 150 % DPI).
- [ ] Leerlauf-Dialog offen lassen, Timer über die Kopfzeile stoppen und neu starten → der alte
      Dialog verschwindet.

## Runde 2 – Verifikation

Stand: 2026-10-20 · geprüft: `adc6083..b3ea82b` (Runde 2) · unabhängige, skeptische Zweitprüfung.
Version bleibt 1.0.0.

**Nachgeprüft (selbst ausgeführt)**

| Lauf | Ergebnis |
|---|---|
| `cargo test --workspace` | vor den Korrekturen 31/31, danach 34/34 (Kern 22, App 12) |
| Windows-Typecheck `cargo check --target x86_64-pc-windows-msvc --workspace --tests` | fehlerfrei, keine Warnungen (vor und nach den Korrekturen) |
| `cargo clippy --workspace --tests` | nur Stilhinweise aus Runde 1 (ein neuer `useless format!` im Test behoben) |
| `pnpm build` | fehlerfrei |
| Web-E2E | 64/64 |
| UI mit Tauri-Mock bei 900, 761 und 1240 px | je 157/157 |
| eigene Browser-Prüfung | `weekNumber`: So 18.10.2026 → 43, So 27.12.2026 → 53, So 03.01.2027 → 1, So 29.12.2024 → 1; `decodeText` UTF-16 LE/BE, UTF-8 mit/ohne BOM; Start mit nicht lesbarer `data.json` (gemockt) zeigt die Meldung, Onboarding erscheint nicht |
| `cargo audit` | unverändert (3 × `zip` über den Updater, S10; Unmaintained/Unsound S11) |

Diff-Review: Kein Deadlock durch die asynchronen Kommandos — Sperren werden nur in der
Reihenfolge `data` → `settings` genommen, `set_settings` hält ausschließlich `settings`.
Keine Sperre über ein `await`. `as_chunks` (Rust 1.88) ist mit der CI (`stable`) verfügbar.
`windows_name_problem`, `io_hint` (Windows-Codes 32/33/39/112 nur unter `cfg!(windows)`),
`is_newer`, Leerlauf-Frage, `weekNumber` an allen fünf Stellen und transaktionales
Web-`mutate` stimmen mit den Angaben überein. Keine Behauptung der Runde 2 widerlegt.

**Zusätzlich gefunden und behoben**

- **Datenverlust bei nicht lesbarer `data.json`** (L5/L11, aus der Zeit vor Runde 2): `store::load`
  behandelte JEDEN Lesefehler wie „Datei fehlt“ → leerer Bestand, und das nächste Speichern
  überschrieb die echte Datei. Betroffen: unter Windows von Virenscanner/OneDrive beim Start
  gesperrte Datei, fehlende Rechte, und Inhalt, der kein UTF-8 ist (`read_to_string` scheitert →
  ohne Sicherung überschrieben). Jetzt: Lesen mit Wiederholung (Windows ~1 s); „fehlt“ → leer wie
  bisher; kein UTF-8/kein JSON → Sicherung `data.json.corrupt-…` wie bei S3; sonst bleibt der
  Fehler in `AppState::load_error`, `get_data` meldet ihn sofort (übersetzt, mit `io_hint`), und
  jedes Speichern wird bis zum Neustart abgelehnt. Tests: `unreadable_file_is_an_error_not_empty`,
  `invalid_utf8_is_backed_up_not_lost`.
- **UTF-8-BOM in `data.json`/`settings.json`** (L4): galt als Defekt → leerer Start (Daten gesichert)
  bzw. Standard-Einstellungen. BOM wird jetzt übersprungen. Test `utf8_bom_is_not_corrupt`.
- **Merge mit doppelten Ids im Bestand**: Der neue Id-Index nahm den letzten Treffer, die frühere
  lineare Suche den ersten — wieder erster Treffer (Kern + Web).
- `io_hint` EN „No permission to write here“ erschien auch bei Lesefehlern → „No permission for
  this location“ (wie DE „Keine Berechtigung für diesen Ort“).
- Hilfe DE/EN (Daten & Speicherort) und README ergänzt.

**Restrisiken (bewusst nicht geändert)**

- Asynchrone Kommandos laufen parallel auf dem Tokio-Pool; zwei praktisch gleichzeitig
  abgeschickte Änderungen (z. B. Start und Stopp innerhalb weniger Millisekunden) haben keine
  garantierte Reihenfolge mehr. Jede Änderung ist für sich atomar (eine Sperre über
  Prüfen + Speichern), es entsteht kein halber Zustand. Bei Bedienung per Hand nicht erreichbar.
- Web-Version: Bricht der Nutzer die Dateiauswahl in einem Browser ohne `cancel`-Ereignis ab
  (Safari < 16.4), bleibt der Import-Knopf bis zum Neuladen gesperrt. Desktop-App nicht betroffen.
- Ist `data.json` dauerhaft gesperrt, bleibt die App bis zum Neustart ohne Bestand (gewollt:
  lieber nichts speichern als überschreiben).

**Nur auf echter Hardware prüfbar (zusätzlich)**

- [ ] Windows: `data.json` beim Start sperren (z. B. in einem Programm exklusiv geöffnet halten) →
      Meldung „data.json konnte beim Start nicht gelesen werden …“, nach Schließen + Neustart sind
      alle Einträge da, nichts überschrieben.
- [ ] macOS: Leserechte von `data.json` entziehen → gleiche Meldung, Datei bleibt unverändert.
- [ ] Alle Punkte aus „Runde 2 → Nur auf echter Hardware prüfbar“ und Abschnitt 7.

## Runde 3

Stand: 2026-10-20 · Basis: `5a357d7` · Version bleibt 1.0.0. Schwerpunkt: jede Aussage in
Hilfe (DE/EN), README und Oberflächentexten gegen den Code prüfen, Nutzerreisen inkl.
Fehlerfällen, Reste aus Runde 2.

**Testläufe (selbst ausgeführt)**

| Lauf | Ergebnis |
|---|---|
| `cargo test --workspace` | 34 bestanden (Kern 22, App 12), 0 fehlgeschlagen |
| Windows-Typecheck `cargo check --target x86_64-pc-windows-msvc --workspace --tests` | fehlerfrei, keine Warnungen (keine Rust-Änderung in dieser Runde) |
| `cargo clippy --workspace --tests` | nur die bekannten Stilhinweise (abgeleitete `Default`, Feldzuweisung nach `Default`, gleiche `if`-Zweige, 8 Argumente) |
| `pnpm build` (tsc + Vite) | fehlerfrei |
| Web-E2E `scripts/e2e/web-e2e.mjs` | 64/64 |
| UI mit Tauri-Mock bei 900, 761, 1240 px | je 157/157 |
| **Nutzerreisen `scripts/e2e/journeys.mjs` (neu)** | 76/76 (13 Reisen × DE/EN). Gegenprobe: mit dem Stand vor Runde 3 schlagen J7 (Reihenfolge) und J12 (Web-Import) fehl |

**Nutzerreisen (DE und EN, Tauri-Mock bzw. Web-Backend, headless Chromium)**

| # | Reise | Ergebnis |
|---|---|---|
| J1 | Erststart: Tutorial erscheint, Esc schließt es, Onboarding ohne Projekte, nach Neustart kein Tutorial | ok (Esc war wirkungslos → behoben) |
| J2 | Projekt mit neuem Kunden über den Dialog | ok |
| J3 | Timer starten, **Neustart mitten im Timer** (Seite neu geladen) → läuft mit Notiz weiter, Stopp | ok |
| J4 | **Gesperrte Datei** beim Speichern einer Zeile (`save_entry` liefert „Speichern fehlgeschlagen … os error 32“) → Meldung, Zeile springt zurück, Bestand unverändert | ok |
| J5 | CSV-Export: **Dialog abgebrochen** (Plugin liefert `null`) → nichts geschrieben, keine Meldung; **Platte voll** (`write_text_file` scheitert, os error 28) → Fehlermeldung statt „gespeichert“; danach CSV mit BOM | ok |
| J6 | **Schreibgeschützter Konfigurationsordner** (`set_settings` scheitert, os error 30) → Meldung, Dialog bleibt offen, alte Sprache bleibt | ok |
| J7 | Reihenfolge: langsamer Start + schneller Stopp ohne `await` → Backend führt Start vor Stopp aus, kein Timer läuft; Gegenprobe mit rohem `invoke` zeigt das alte Überholen; Lesekommandos warten nicht; ein Fehler hält die Schlange nicht an | ok (Fehler → behoben) |
| J8 | Expertenmodus: „s“ zweimal schnell bei 300 ms Latenz → genau ein Timer, drittes „s“ stoppt | ok (vorher zwei Starts möglich → behoben) |
| J9 | „?“ öffnet das Handbuch, „s“/„3“ wirken dort nicht, Esc schließt | ok (vorher: Esc wirkungslos, „s“ startete hinter dem Handbuch den Timer → behoben) |
| J10 | Team-Paket: Öffnen-Dialog abgebrochen → Knopf wieder frei, Import, zweiter Import „0 neu“ | ok |
| J11 | Woche abschließen → „+ Eintrag“ gesperrt, Backend lehnt Änderung ab, wieder öffnen | ok |
| J12 | **Web-Version, Dateiauswahl abbrechen ohne `cancel`-Ereignis** (Safari < 16.4 nachgestellt) → nach Fokus-Rückkehr ist der Import-Knopf frei und erneut nutzbar | ok (Rest aus Runde 2 → behoben) |
| J13 | Projektfilter per Klick in der Seitenleiste, zweiter Klick hebt auf; ← → wechseln die KW | ok |

Nicht als Reise automatisierbar (nur Code-Review + Checkliste): echte volle Platte/Sperre/
Schreibschutz im Dateisystem (im Mock als Fehler des Kommandos nachgestellt — die Texte
kommen aus `io_hint`, Rust-Tests decken die Erkennung ab), App-Absturz statt Neuladen,
native Dialoge, Updater.

**Behoben**

1. **Reihenfolge ändernder Kommandos** (Rest aus Runde 2): Seit Runde 2 laufen die Kommandos
   asynchron auf dem Tokio-Pool; zwei kurz hintereinander abgeschickte Änderungen konnten
   sich überholen. Folgen: Start + Stopp endeten mit laufendem Timer; eine Notiz-Änderung am
   laufenden Eintrag (Commit beim Verlassen des Feldes) direkt vor „Stopp“ konnte nach dem
   Stopp ankommen und den Eintrag mit `end: null` wieder „anlaufen“ lassen. Jetzt reiht
   `src/api.ts` alle ändernden Kommandos (`set_settings`, `save_*`, `delete_*`,
   `start_timer`, `stop_timer`, `import_package`, `lock_week`, `unlock_week`) in eine
   Warteschlange — das nächste wird erst gesendet, wenn das vorige beantwortet ist. Lesende
   Kommandos und die Update-Prüfung laufen weiter sofort. Gilt für App und Web-Version.
   Backend unverändert (jede Änderung bleibt für sich atomar). Ein Tray-Menü gibt es nicht.
2. **Doppelter Start per Kürzel/Doppelklick**: „s“ entschied nach dem zuletzt gerenderten
   Zustand; ein zweiter Druck vor der Antwort startete einen zweiten Timer (der erste wurde
   mit ~0 s beendet). Jetzt wird Start/Stopp ignoriert, solange ein Timer-Kommando
   unterwegs ist, und „s“ liest den Stand aus der letzten Backend-Antwort.
3. **Esc schloss Tutorial und Handbuch nicht** (Hilfe versprach „Esc — Dialog schließen“).
   Jetzt in beiden Modi, auch aus dem Suchfeld.
4. **Kürzel hinter offenem Handbuch**: „s“, „1–5“, „←/→“ wirkten hinter dem Handbuch (Timer
   startete unbemerkt). Jetzt ruhen die Kürzel, solange Tutorial/Handbuch offen sind.
5. **Web: Import-Knopf blieb nach abgebrochener Dateiauswahl gesperrt** (Browser ohne
   `cancel`-Ereignis). Kommt nach der Fokus-Rückkehr 1,5 s lang keine Datei, gilt die
   Auswahl als abgebrochen (`src/files.ts`); `change` hat Vorrang.
6. `localStorage` für „Tutorial gesehen“ in try/catch (gesperrter Speicher im privaten Modus
   warf sonst beim Start bzw. beim Schließen).

**Falsche Aussagen in Hilfe/README korrigiert (DE und EN)**

- „Leerlauf-Erkennung“ stand unter den Expertenfunktionen (Hilfe „Einfach & Experte“,
  README) — sie wirkt in beiden Modi (Einstellungen → Erfassung, auch im einfachen Modus
  sichtbar). Jetzt bei „Einfach“ aufgeführt.
- „s — Timer starten (letztes Projekt)“: gestartet wird das in der Kopfzeile gewählte
  Projekt (vorausgewählt ist das zuletzt benutzte) — Text präzisiert.
- „Personen mit Einträgen werden archiviert statt gelöscht“: es wird nicht automatisch
  archiviert, das Löschen wird abgelehnt — „lassen sich nicht löschen, nur archivieren“.
- „Tätigkeiten … — der Timer übernimmt das Flag“: Der Timer in der Kopfzeile startet ohne
  Tätigkeit; das Flag übernimmt ein Eintrag beim Wählen der Tätigkeit in der Zeile bzw.
  „Erneut starten“ an einem Eintrag mit Tätigkeit — Text korrigiert.
- „Esc — Dialog schließen“: stimmte für Tutorial/Handbuch nicht (Code behoben); Hinweis
  ergänzt, dass die Leerlauf-Frage eine Antwort verlangt.
- Ergänzt: Kürzel ruhen bei offenem Handbuch; zweiter Start/Stopp-Druck während des
  Speicherns wird ignoriert, Änderungen in Eingabereihenfolge; Web-Import nach Abbrechen.

Geprüft und zutreffend (Code-Review, teils E2E): Uhrzeitformate `9:30`/`0930`/`9.30`,
„+ Eintrag“ ab Ende des letzten Eintrags sonst 09:00 (1 h), „Bis“ vor „Von“ = Folgetag,
Duplizieren mit gleichen Zeiten, Löschnachfrage abschaltbar, zukünftige Tage in der Woche
ausgeblendet, KW bei Sonntag, Rundung nur in Summen/Export, Projektsatz vor Personensatz
(`rate_for`), Euro-Budget = gerundete abrechenbare Zeit × Satz, Ampel-Schwellen 80/100 %
(Budget) und 80/100 % (Ist/Soll), Trend 8 Wochen, Dashboard-Standard Monat, CSV-Spalten
und Formelschutz `= + - @` (zusätzlich Tab/CR), BOM, PDF A4/Courier mit Seitenzahlen,
Paket „Eigene“ (nur eigene Person/Einträge/Sperren, alle Projekte/Kunden/Tätigkeiten),
Import-Grenze 64 MB/.json, Feierabend-Erinnerung einmal je Tag, Leerlauf nur Eingaben im
Fenster, Service Worker „Netz zuerst“ (neue Version beim nächsten Laden, offline startfähig).
DE/EN-Hilfe: gleiche Abschnitte, gleiche Absatzzahl und gleiche Zahlen je Abschnitt
(maschinell verglichen).

**jsPDF-Advisories (S9) neu bewertet**

`pnpm audit`: 13 Advisories zu `jspdf` (behoben erst ab 3.0.1 … 4.2.1) und 16 zu
`dompurify` (optionale Abhängigkeit von jspdf, nur von `html()` geladen). 2.5.2 ist die
letzte 2.x-Version — ein Patch/Minor-Update existiert nicht, jede Behebung ist ein
Major-Sprung (laut Vorgabe nicht in dieser Runde). Betroffene Pfade gegen `src/pdf.ts`
geprüft: ReDoS/DoS (`addImage`-Datenpfade, BMP/GIF/PNG-Decoder), Local File Inclusion
(Node-`loadFile`), AcroForm-/`addJS`-/FreeText-/XMP-Injektion, „HTML Injection in New
Window paths“ (`output('dataurlnewwindow' | 'pdfobjectnewwindow' …)`) — timelog benutzt
ausschließlich `new jsPDF({unit,format})`, `setFont/FontSize/TextColor/DrawColor`, `text`,
`line`, `addPage`, `setPage`, `getNumberOfPages`, `autoTable` und `output('arraybuffer')`;
keine Bilder, kein HTML, keine Formulare, kein JavaScript, kein neues Fenster, läuft im
Browser/WebView (kein Node-Dateizugriff). Nutzertext (Notizen, Namen) gelangt nur über
`text()`/`autoTable` als Zeichenkette in den Inhaltsstrom, den jsPDF escaped. Bewertung:
nicht ausnutzbar; Upgrade auf jsPDF 4.x + jspdf-autotable 5 bleibt für 1.1 (mit
PDF-Sichtprüfung).

**Weiter offen**

- S9 (siehe oben) und S10 (`zip` über den Updater) unverändert.
- Ist `data.json` dauerhaft gesperrt, bleibt die App bis zum Neustart ohne Bestand (gewollt).
- Die Warteschlange ordnet Änderungen eines Fensters; mehrere Fenster gibt es nicht.

**Nur auf echter Hardware prüfbar (zusätzlich)**

- [ ] macOS und Windows: Start/Stopp in der Kopfzeile schnell doppelt klicken bzw. „s“
      zweimal drücken → genau ein Eintrag, Timer-Zustand passt zur Kopfzeile.
- [ ] Notiz am laufenden Eintrag ändern und sofort „Stopp“ klicken → Timer bleibt gestoppt,
      Notiz gespeichert.
- [ ] Handbuch mit „?“ öffnen, „s“ drücken → kein Timer startet; Esc schließt das Handbuch.
- [ ] Web-Version in Safari < 16.4 (iOS 15/16.3): Einstellungen → App → Daten importieren,
      Auswahl abbrechen → Knopf nach ~1,5 s wieder bedienbar.
- [ ] Echte Fehlerfälle aus J4–J6 im Dateisystem (Datei in Excel offen, volle Platte bzw.
      kleiner USB-Stick als Ziel, schreibgeschützter Konfigurationsordner) — Meldungstexte
      wie in Runde 2 beschrieben.
