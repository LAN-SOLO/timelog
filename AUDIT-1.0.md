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
  schlägt es fehl (Datei gesperrt), bleibt der Bestand im Speicher unverändert und die Meldung
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
