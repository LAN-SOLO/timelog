import { useEffect, useState } from 'react';
import { Lang } from '../i18n';

// Selbstständiges Hilfe-System: schwebender ?-Button, First-Run-Tutorial
// und durchsuchbares Handbuch. Inhalte liegen bewusst hier, nicht in i18n.ts.

const SEEN_KEY = 'timelog.tutorialSeen';

interface Step {
  title: string;
  body: string[];
}

interface Section {
  id: string;
  title: string;
  body: string[];
}

interface Content {
  labels: {
    fab: string;
    tutorial: string;
    manual: string;
    search: string;
    next: string;
    back: string;
    skip: string;
    done: string;
    stepOf: (n: number, total: number) => string;
    noResults: string;
  };
  tutorial: Step[];
  sections: Section[];
}

const de: Content = {
  labels: {
    fab: 'Hilfe & Handbuch',
    tutorial: 'Tutorial',
    manual: 'Handbuch',
    search: 'Handbuch durchsuchen …',
    next: 'Weiter',
    back: 'Zurück',
    skip: 'Überspringen',
    done: 'Los geht’s',
    stepOf: (n, total) => `Schritt ${n} von ${total}`,
    noResults: 'Keine Treffer',
  },
  tutorial: [
    {
      title: 'Willkommen bei timelog.',
      body: [
        'timelog ist eine schlanke Zeiterfassung: Zeiten je Projekt erfassen — per Stoppuhr oder von Hand — und als Zusammenfassung auswerten.',
        'Zwei Modi: „Einfach“ genügt für eine Person und ihre Projekte. „Experte“ (Tarif „tracked“) ergänzt Team, Kunden, Tätigkeiten, Budgets, Dashboard, PDF-Berichte, Wochenabschluss und die Team-Zusammenführung.',
        'Alles bleibt auf Ihrem Rechner: eine JSON-Datei im Datenordner, atomar geschrieben. Kein Konto, keine Cloud, keine Telemetrie.',
        'Dieses Tutorial dauert zwei Minuten. Sie finden es jederzeit wieder über den ?-Knopf unten rechts.',
      ],
    },
    {
      title: 'Projekte anlegen',
      body: [
        'Links in der Seitenleiste: „+“ neben „Projekte“. Ein Projekt braucht nur einen Namen und eine Farbe — optional einen Kunden.',
        '• Der Kundenname ist ein Freitextfeld mit Vorschlägen: Ein unbekannter Name wird beim Speichern als neuer Kunde angelegt.',
        '• Experte: Stunden- oder Euro-Budget, Stundensatz und „standardmäßig abrechenbar“ je Projekt.',
        '• Projekte mit Einträgen lassen sich nicht löschen, aber archivieren — sie verschwinden aus den Auswahllisten, ihre Zeiten bleiben in den Berichten.',
        '• Ein Klick auf ein Projekt in der Seitenleiste filtert Einträge und Berichte darauf; ein zweiter Klick hebt den Filter auf.',
      ],
    },
    {
      title: 'Stoppuhr & Einträge',
      body: [
        'Oben in der Kopfzeile: Projekt wählen, optional eine Notiz, „Start“. Der laufende Timer zeigt hh:mm:ss und das Projekt; „Stopp“ beendet ihn. Es läuft immer nur ein Timer.',
        '• „+ Eintrag“ legt in der Tages- oder Wochenansicht einen Eintrag von Hand an — Startzeit schließt an den letzten Eintrag des Tages an, Dauer eine Stunde. Danach direkt in der Zeile anpassen.',
        '• Alle Felder sind in der Zeile bearbeitbar: Projekt, Von, Bis, Notiz — Enter oder Feld verlassen speichert, Esc verwirft. Ein „Bis“ vor „Von“ bedeutet: über Mitternacht.',
        '• Duplizieren kopiert einen Eintrag, „Erneut starten“ startet den Timer mit Projekt, Tätigkeit und Notiz des Eintrags.',
        '• Die Rundung (keine / 5 / 15 Minuten) wirkt nur in Summen und Exporten — die Rohdaten bleiben sekundengenau.',
      ],
    },
    {
      title: 'Woche & Berichte',
      body: [
        '„Woche“ zeigt sieben Tage mit Tagessummen, Wochensumme und — wenn Sie Soll-Stunden gesetzt haben — die Bilanz. Mit ← → wechseln Sie die Kalenderwoche.',
        '• „Berichte“: Zeitraum (Heute / Woche / Monat / frei) und Gruppierung wählen; die Tabelle zeigt Einträge, Dauer, Stunden und Summen.',
        '• CSV-Export gibt es zweimal: alle Einträge im Zeitraum oder die Zusammenfassung. Deutsch mit Semikolon und Komma als Dezimaltrenner, Englisch mit Komma und Punkt — passend für Tabellenkalkulationen.',
        '• Experte: Gruppierung nach Kunde, Person oder Tätigkeit, Spalten für abrechenbare Zeit und Betrag, PDF-Bericht mit Firmenname und Detailliste.',
      ],
    },
    {
      title: 'Expertenmodus: Team & Monitoring',
      body: [
        'Der Umschalter sitzt in der Kopfzeile. Im Expertenmodus kommen zwei Ansichten dazu:',
        '• „Team“: Personen (Soll-Stunden, Stundensatz, Farbe), Kunden, Tätigkeiten je Projekt, Wochenabschluss und die Team-Zusammenführung per JSON-Paket.',
        '• „Dashboard“: Stunden gesamt, Anteil abrechenbar, aktive Projekte und Personen; Balken je Projekt, Ist/Soll je Person, Budget-Ampel (grün < 80 %, gelb ab 80 %, rot ab 100 %) und der Trend der letzten acht Wochen.',
        '• Einträge tragen eine Person; mit dem Personen-Filter in der Kopfzeile sehen Sie die Zeiten einzelner Teammitglieder.',
        'Der Modus ändert nichts an Ihren Daten — nur daran, wie viel Werkzeug sichtbar ist.',
      ],
    },
    {
      title: 'Team ohne Server',
      body: [
        'timelog hat keinen Server und keinen Cloud-Sync — bewusst. Die Zusammenführung läuft über Dateien:',
        '• Jede Person exportiert unter „Team“ ihre Einträge als JSON-Paket und schickt es der Projektleitung (Mail, Netzlaufwerk, Chat).',
        '• Die Projektleitung importiert die Pakete. Der Abgleich ist Id-basiert: Nichts wird doppelt angelegt, bei Konflikten gewinnt die jüngere Änderung. Ein zweiter Import desselben Pakets ändert nichts.',
        '• Wochenabschluss: Eine Woche je Person abschließen sperrt ihre Einträge — keine Änderungen, keine neuen Einträge. Wieder öffnen geht jederzeit im Expertenmodus.',
        'Hinweis: timelog ersetzt keine Arbeitszeiterfassung mit Prüfsiegel — es liefert aber die Exporte für Buchhaltung und Abrechnung.',
      ],
    },
  ],
  sections: [
    {
      id: 'modes',
      title: 'Einfach & Experte (tracked)',
      body: [
        'Der Modus-Schalter sitzt in der Kopfzeile; die Einstellung wird gespeichert.',
        '• Einfach (kostenlos): Projekte mit Farbe und optionalem Kunden, Stoppuhr, manuelle Einträge, Tages- und Wochenansicht, Soll-Stunden mit Wochenbilanz, Zusammenfassung je Projekt, CSV-Export, Rundung.',
        '• Experte (Tarif „tracked“, 12 € im Jahr): zusätzlich Team mit Personen, Kunden → Projekte → Tätigkeiten, Abrechenbar-Flag, Budgets und Stundensätze, Dashboard, Berichte nach Kunde/Person/Tätigkeit, PDF-Export, Wochenabschluss, Team-Zusammenführung, Leerlauf-Erkennung, Feierabend-Erinnerung, Tastaturkürzel.',
        '• Im Vorabzugang ist der Expertenmodus frei umschaltbar — es gibt keine Lizenzprüfung.',
      ],
    },
    {
      id: 'projects',
      title: 'Projekte & Kunden',
      body: [
        'Projekte legen Sie über „+“ in der Seitenleiste an; der Stift neben dem Namen öffnet den Dialog zum Bearbeiten.',
        '• Kunde: Freitext mit Vorschlägen — ein unbekannter Name wird als neuer Kunde angelegt. Kunden verwalten Sie im Expertenmodus unter „Team“.',
        '• Budget (Experte): Stunden oder Euro. Der Verbrauch erscheint als Ampel im Dashboard; Euro-Verbrauch rechnet mit gerundeter abrechenbarer Zeit × Stundensatz.',
        '• Stundensatz (Experte): der Projektsatz gewinnt; 0 bedeutet, der Satz der Person gilt.',
        '• Archivieren statt löschen, sobald Einträge existieren. Archivierte Projekte blendet die Seitenleiste ein, wenn Sie es wünschen.',
      ],
    },
    {
      id: 'timer',
      title: 'Stoppuhr',
      body: [
        'Projekt wählen, optional Notiz, „Start“. Der Timer läuft als Eintrag ohne Ende; die Kopfzeile zählt hh:mm:ss.',
        '• Ein neuer Start beendet einen laufenden Timer automatisch — es gibt immer nur einen.',
        '• Die Startzeit lässt sich nachträglich in der Zeile korrigieren, auch während der Timer läuft.',
        '• „Erneut starten“ an einem Eintrag übernimmt Projekt, Tätigkeit und Notiz.',
        '• Leerlauf-Erkennung (Einstellungen → Erfassung): Läuft der Timer x Minuten ohne Eingabe in timelog, fragt die App nach — weiterlaufen, jetzt stoppen oder bei der letzten Aktivität stoppen.',
        '• Feierabend-Erinnerung (Experte): ab der eingestellten Uhrzeit erinnert timelog einmal am Tag an einen laufenden Timer.',
      ],
    },
    {
      id: 'entries',
      title: 'Einträge bearbeiten',
      body: [
        'Jede Zeile ist ein Formular: Projekt, Tätigkeit (Experte), Von, Bis, Dauer, Notiz, abrechenbar (Experte), Aktionen.',
        '• Uhrzeiten als HH:MM eingeben (auch 9:30 oder 0930). Enter oder Verlassen des Feldes speichert, Esc stellt den alten Wert wieder her.',
        '• Ein „Bis“ vor „Von“ wird als Folgetag verstanden — Nachtschichten sind kein Problem.',
        '• Der Eintrag erscheint an dem Tag, an dem er beginnt. Die Dauer zählt komplett zu diesem Tag; Berichte schneiden dagegen exakt am Zeitraum.',
        '• „+ Eintrag“ legt einen Eintrag ab dem Ende des letzten Eintrags des Tages an (sonst 09:00), Dauer eine Stunde.',
        '• Duplizieren kopiert die Zeile mit denselben Zeiten; Löschen fragt nach, wenn Sie das in den Einstellungen so wollen.',
        '• Gesperrte Einträge (abgeschlossene Woche) tragen ein Schloss und lassen sich nicht ändern.',
      ],
    },
    {
      id: 'week',
      title: 'Tag & Woche',
      body: [
        '„Heute“ zeigt einen Tag, „Woche“ sieben Tage mit Tagessummen. Zukünftige Tage ohne Einträge bleiben ausgeblendet.',
        '• Wochenbeginn (Montag/Sonntag) und Soll-Stunden pro Woche stehen in den Einstellungen; im Expertenmodus gelten die Soll-Stunden der gefilterten Person, wenn gesetzt.',
        '• Die Wochenbilanz zeigt Ist minus Soll — grün bei Überschuss, rot bei Fehlstunden.',
        '• Experte: „Woche abschließen“ sperrt die Woche für die gewählte Person. Das Schloss-Symbol oben zeigt den Zustand; „Woche öffnen“ hebt die Sperre auf.',
        '• Tastatur (Experte): ← → wechseln Tag bzw. Woche.',
      ],
    },
    {
      id: 'reports',
      title: 'Berichte & Export',
      body: [
        'Zeitraum: Heute, Woche, Monat oder frei (zwei Datumsfelder). Gruppierung: Projekt — im Expertenmodus auch Kunde, Person, Tätigkeit.',
        '• Die Tabelle zeigt je Gruppe Einträge, Dauer (exakt), Stunden (dezimal, gerundet), bei aktiver Rundung die gerundete Dauer, im Expertenmodus abrechenbare Zeit und Betrag.',
        '• Berichte schneiden Einträge exakt am Zeitraum — ein Eintrag über Mitternacht zählt anteilig.',
        '• CSV Einträge: alle Einträge im Zeitraum mit Datum, Start, Ende, Dauer, Stunden, Gerundet, Projekt, Tags, Notiz — im Expertenmodus zusätzlich Person, Kunde, Tätigkeit, Abrechenbar, Satz, Betrag, Gesperrt.',
        '• CSV Zusammenfassung: die Tabelle mit Summenzeile. Deutsch: Semikolon und Dezimalkomma; Englisch: Komma und Dezimalpunkt. Felder mit Sonderzeichen werden korrekt in Anführungszeichen gesetzt.',
        '• PDF (Experte): A4, Courier, Firmenname aus den Einstellungen, Summentabelle und Detailliste. „Detailliste anzeigen“ zeigt dieselbe Liste in der App.',
      ],
    },
    {
      id: 'dashboard',
      title: 'Dashboard (Experte)',
      body: [
        'Monitoring für Geschäftsführung und Projektleitung — Zeitraum frei wählbar, Standard ist der Monat.',
        '• Kacheln: Stunden gesamt, Anteil abrechenbar, aktive Projekte (mit Zeiten im Zeitraum), Personen mit Zeiten.',
        '• Stunden je Projekt: Balken relativ zum größten Projekt, in Projektfarbe.',
        '• Ist / Soll je Person: Soll = Wochen-Soll × Wochen im Zeitraum. Grün ab 100 %, gelb ab 80 %, rot darunter. Ohne Soll zeigt der Balken den Anteil an der Gesamtzeit.',
        '• Budget-Ampel: Verbrauch über alle Zeiten (nicht nur den Zeitraum) — grün unter 80 %, gelb ab 80 %, rot ab 100 %.',
        '• Trend: die letzten acht Wochen als Säulen, abrechenbar (Akzentfarbe) und nicht abrechenbar (grau) gestapelt.',
        '• Der Personen-Filter in der Kopfzeile wirkt auch hier.',
      ],
    },
    {
      id: 'team',
      title: 'Team, Wochenabschluss, Zusammenführung',
      body: [
        '„Team“ (Experte) verwaltet Personen, Kunden und Tätigkeiten.',
        '• Personen: Name, E-Mail, Soll-Stunden/Woche, Stundensatz, Farbe. Die Person „ich“ ist die dieser Installation; sie lässt sich nicht löschen. Personen mit Einträgen werden archiviert statt gelöscht.',
        '• Tätigkeiten gehören zu einem Projekt und können „standardmäßig abrechenbar“ sein — der Timer übernimmt das Flag.',
        '• Wochenabschluss: Person und Woche wählen, abschließen. Gesperrte Wochen listet das Panel; jede lässt sich dort wieder öffnen.',
        '• Paket exportieren: „Eigene Einträge“ enthält nur Ihre Person, Einträge und Sperren plus alle Projekte/Kunden/Tätigkeiten; „Alles“ den kompletten Bestand.',
        '• Paket importieren: Id-basierter Merge — neue Datensätze kommen dazu, geänderte werden übernommen, wenn sie jünger sind, identische bleiben unverändert. Das Ergebnis erscheint als Meldung.',
        '• Tipp für Teams: Die Projektleitung legt Kunden, Projekte und Tätigkeiten an, exportiert „Alles“ und verteilt das Paket — so nutzen alle dieselben Ids.',
      ],
    },
    {
      id: 'shortcuts',
      title: 'Tastaturkürzel (Experte)',
      body: [
        '• s — Timer starten (letztes Projekt) / stoppen',
        '• n — neuer Eintrag in der aktuellen Ansicht',
        '• ← → — Tag, Woche bzw. Zeitraum wechseln',
        '• 1 … 5 — Ansicht: Heute, Woche, Berichte, Dashboard, Team',
        '• ? — Handbuch · Esc — Dialog schließen',
        'Kürzel sind inaktiv, solange ein Eingabefeld den Fokus hat.',
      ],
    },
    {
      id: 'settings',
      title: 'Einstellungen',
      body: [
        '• Allgemein: Sprache, Modus (Einfach / Experte „tracked“), Darstellung Dunkel/Hell, Akzentfarbe.',
        '• Erfassung: Rundung (keine / 5 / 15 Minuten), Wochenbeginn, Soll-Stunden pro Woche, Leerlauf-Erkennung, Feierabend-Erinnerung (Experte), Nachfrage vor dem Löschen.',
        '• Berichte: Firmenname für den PDF-Kopf.',
        '• App: Updates (manuell oder automatisch), Datenordner, Tastaturkürzel.',
      ],
    },
    {
      id: 'data',
      title: 'Daten & Sicherung',
      body: [
        'Alle Daten liegen in einer Datei „data.json“ im Datenordner der App (Pfad unter Einstellungen → App). Geschrieben wird atomar: erst eine Temp-Datei, dann umbenannt.',
        '• Zeiten werden in UTC gespeichert und lokal angezeigt — ein Rechnerwechsel über Zeitzonen hinweg verschiebt keine Stunden.',
        '• Sicherung: Ordner kopieren genügt. Oder unter „Team“ ein Paket „Alles exportieren“ — es ist dieselbe Struktur und lässt sich importieren.',
        '• Einstellungen liegen getrennt in „settings.json“ im Konfigurationsordner.',
      ],
    },
    {
      id: 'updates',
      title: 'Updates',
      body: [
        'timelog prüft beim Start still auf neue Versionen und zeigt ein Banner. Mit Auto-Update installiert es direkt.',
        'Updates sind signiert — die App installiert nur Pakete, deren Signatur zum eingebauten Schlüssel passt.',
      ],
    },
    {
      id: 'mobile',
      title: 'Telefon & Browser',
      body: [
        'timelog läuft auch als Webapp im Browser — auf dem Telefon mit angepasster Oberfläche: Die Ansichten liegen in der Leiste am unteren Rand, „Projekte“ öffnet die Projektliste als Schublade, Einträge werden als Karten mit Projekt, Von/Bis, Dauer und Notiz gezeigt.',
        '• Zum Startbildschirm hinzufügen (Safari: Teilen → „Zum Home-Bildschirm“; Chrome: Menü → „App installieren“) — dann startet timelog wie eine App, ohne Browserleiste, auch ohne Netz.',
        '• Die Daten der Web-Version liegen im Speicher dieses Browsers auf diesem Gerät. Es gibt keinen Abgleich mit der Desktop-App — Austausch läuft über „Daten exportieren / importieren“ (Einstellungen → App) bzw. das Team-Paket.',
        '• Wichtig: Wer die Website-Daten des Browsers löscht, löscht auch die Einträge. Regelmäßig exportieren.',
        '• CSV- und PDF-Exporte kommen als Download; auf iOS landen sie über das Teilen-Menü in „Dateien“.',
      ],
    },
    {
      id: 'trouble',
      title: 'Problemlösung',
      body: [
        '• „Diese Woche ist abgeschlossen“: Die Woche der Person ist gesperrt — unter „Team“ oder in der Wochenansicht wieder öffnen.',
        '• „Ungültige Uhrzeit“: Format HH:MM, 24-Stunden. Das Feld springt auf den alten Wert zurück.',
        '• „Das Ende liegt vor dem Start“: Beim Bearbeiten der Startzeit nach dem Ende — erst das Ende anpassen.',
        '• Projekt lässt sich nicht löschen: Es hat Einträge. Archivieren Sie es stattdessen.',
        '• Import meldet 0 neu: Das Paket war bereits importiert — der Merge ist idempotent.',
        '• Dauer im Bericht kleiner als in der Tagesansicht: Berichte schneiden am Zeitraum, die Tagesansicht zählt den ganzen Eintrag zum Starttag.',
      ],
    },
  ],
};

const en: Content = {
  labels: {
    fab: 'Help & manual',
    tutorial: 'Tutorial',
    manual: 'Manual',
    search: 'Search the manual …',
    next: 'Next',
    back: 'Back',
    skip: 'Skip',
    done: 'Let’s go',
    stepOf: (n, total) => `Step ${n} of ${total}`,
    noResults: 'No results',
  },
  tutorial: [
    {
      title: 'Welcome to timelog.',
      body: [
        'timelog is lean time tracking: record time per project — with a stopwatch or by hand — and review it as a summary.',
        'Two modes: “Simple” is enough for one person and their projects. “Expert” (the “tracked” plan) adds team, clients, tasks, budgets, a dashboard, PDF reports, week close and team merge.',
        'Everything stays on your machine: one JSON file in the data folder, written atomically. No account, no cloud, no telemetry.',
        'This tutorial takes two minutes. You can always find it again via the ? button at the bottom right.',
      ],
    },
    {
      title: 'Create projects',
      body: [
        'In the sidebar: “+” next to “Projects”. A project only needs a name and a colour — optionally a client.',
        '• The client field is free text with suggestions: an unknown name is created as a new client on save.',
        '• Expert: hours or euro budget, hourly rate and “billable by default” per project.',
        '• Projects with entries cannot be deleted, but archived — they disappear from pickers, their time stays in reports.',
        '• Clicking a project in the sidebar filters entries and reports to it; a second click removes the filter.',
      ],
    },
    {
      title: 'Stopwatch & entries',
      body: [
        'In the header: pick a project, optionally a note, “Start”. The running timer shows hh:mm:ss and the project; “Stop” ends it. Only one timer runs at a time.',
        '• “+ Entry” adds an entry by hand in the day or week view — starting where the last entry of the day ended, one hour long. Adjust it right in the row.',
        '• Every field is editable inline: project, from, to, note — Enter or leaving the field saves, Esc reverts. A “to” before “from” means: past midnight.',
        '• Duplicate copies an entry; “Start again” starts the timer with the entry’s project, task and note.',
        '• Rounding (none / 5 / 15 minutes) applies to totals and exports only — raw data stays exact to the second.',
      ],
    },
    {
      title: 'Week & reports',
      body: [
        '“Week” shows seven days with day totals, the week total and — if you set target hours — the balance. Use ← → to change the week.',
        '• “Reports”: choose a period (today / week / month / custom) and grouping; the table shows entries, duration, hours and totals.',
        '• CSV export comes in two flavours: all entries in the period, or the summary. German uses semicolons and decimal commas, English commas and decimal points — ready for spreadsheets.',
        '• Expert: group by client, person or task, columns for billable time and amount, PDF report with company name and detail list.',
      ],
    },
    {
      title: 'Expert mode: team & monitoring',
      body: [
        'The switch sits in the header. Expert mode adds two views:',
        '• “Team”: people (target hours, hourly rate, colour), clients, tasks per project, week close and team merge via JSON package.',
        '• “Dashboard”: total hours, billable share, active projects and people; bars per project, actual/target per person, budget status (green < 80 %, yellow from 80 %, red from 100 %) and the trend of the last eight weeks.',
        '• Entries carry a person; the person filter in the header shows individual team members’ time.',
        'The mode does not change your data — only how much tooling is visible.',
      ],
    },
    {
      title: 'Team without a server',
      body: [
        'timelog has no server and no cloud sync — on purpose. Merging works through files:',
        '• Each person exports their entries under “Team” as a JSON package and sends it to the project lead (mail, network share, chat).',
        '• The project lead imports the packages. Merging is id-based: nothing is duplicated, on conflict the newer change wins. Importing the same package twice changes nothing.',
        '• Week close: closing a week for a person locks their entries — no changes, no new entries. Reopening is always possible in expert mode.',
        'Note: timelog does not replace certified working-time recording — but it delivers the exports for accounting and billing.',
      ],
    },
  ],
  sections: [
    {
      id: 'modes',
      title: 'Simple & Expert (tracked)',
      body: [
        'The mode switch sits in the header; the setting is saved.',
        '• Simple (free): projects with colour and optional client, stopwatch, manual entries, day and week view, target hours with week balance, summary per project, CSV export, rounding.',
        '• Expert (“tracked” plan, €12 per year): additionally team with people, clients → projects → tasks, billable flag, budgets and hourly rates, dashboard, reports by client/person/task, PDF export, week close, team merge, idle detection, end-of-day reminder, keyboard shortcuts.',
        '• During early access, expert mode can be switched freely — there is no licence check.',
      ],
    },
    {
      id: 'projects',
      title: 'Projects & clients',
      body: [
        'Create projects via “+” in the sidebar; the pencil next to the name opens the edit dialog.',
        '• Client: free text with suggestions — an unknown name is created as a new client. Manage clients in expert mode under “Team”.',
        '• Budget (expert): hours or euros. Usage appears as a status light on the dashboard; euro usage is rounded billable time × hourly rate.',
        '• Hourly rate (expert): the project rate wins; 0 means the person’s rate applies.',
        '• Archive rather than delete once entries exist. The sidebar can show archived projects on request.',
      ],
    },
    {
      id: 'timer',
      title: 'Stopwatch',
      body: [
        'Pick a project, optionally a note, “Start”. The timer is an entry without an end; the header counts hh:mm:ss.',
        '• A new start automatically stops a running timer — there is only ever one.',
        '• The start time can be corrected in the row later, even while the timer runs.',
        '• “Start again” on an entry takes over project, task and note.',
        '• Idle detection (Settings → Tracking): if the timer runs x minutes without input in timelog, the app asks — keep running, stop now, or stop at the last activity.',
        '• End-of-day reminder (expert): from the configured hour, timelog reminds you once a day about a running timer.',
      ],
    },
    {
      id: 'entries',
      title: 'Editing entries',
      body: [
        'Every row is a form: project, task (expert), from, to, duration, note, billable (expert), actions.',
        '• Enter times as HH:MM (9:30 or 0930 work too). Enter or leaving the field saves, Esc restores the old value.',
        '• A “to” before “from” is read as the next day — night shifts are fine.',
        '• The entry appears on the day it starts. Its whole duration counts for that day; reports, by contrast, cut exactly at the period.',
        '• “+ Entry” creates an entry starting where the last entry of the day ended (otherwise 09:00), one hour long.',
        '• Duplicate copies the row with the same times; delete asks first if you enabled that in settings.',
        '• Locked entries (closed week) carry a lock and cannot be changed.',
      ],
    },
    {
      id: 'week',
      title: 'Day & week',
      body: [
        '“Today” shows one day, “Week” seven days with day totals. Future days without entries stay hidden.',
        '• Week start (Monday/Sunday) and target hours per week live in settings; in expert mode the filtered person’s target hours apply if set.',
        '• The week balance shows actual minus target — green for surplus, red for missing hours.',
        '• Expert: “Close week” locks the week for the selected person. The lock icon at the top shows the state; “Reopen week” lifts the lock.',
        '• Keyboard (expert): ← → change day or week.',
      ],
    },
    {
      id: 'reports',
      title: 'Reports & export',
      body: [
        'Period: today, week, month or custom (two date fields). Grouping: project — in expert mode also client, person, task.',
        '• The table shows per group: entries, duration (exact), hours (decimal, rounded), with rounding active the rounded duration, in expert mode billable time and amount.',
        '• Reports cut entries exactly at the period — an entry across midnight counts proportionally.',
        '• CSV entries: all entries in the period with date, start, end, duration, hours, rounded, project, tags, note — in expert mode additionally person, client, task, billable, rate, amount, locked.',
        '• CSV summary: the table with a total row. German: semicolon and decimal comma; English: comma and decimal point. Fields with special characters are quoted correctly.',
        '• PDF (expert): A4, Courier, company name from settings, summary table and detail list. “Show detail list” shows the same list in the app.',
      ],
    },
    {
      id: 'dashboard',
      title: 'Dashboard (expert)',
      body: [
        'Monitoring for management and project leads — any period, month by default.',
        '• Tiles: total hours, billable share, active projects (with time in the period), people with time.',
        '• Hours per project: bars relative to the largest project, in project colour.',
        '• Actual / target per person: target = weekly target × weeks in the period. Green from 100 %, yellow from 80 %, red below. Without a target the bar shows the share of total time.',
        '• Budget status: usage across all time (not just the period) — green below 80 %, yellow from 80 %, red from 100 %.',
        '• Trend: the last eight weeks as columns, billable (accent colour) and non-billable (grey) stacked.',
        '• The person filter in the header applies here too.',
      ],
    },
    {
      id: 'team',
      title: 'Team, week close, merge',
      body: [
        '“Team” (expert) manages people, clients and tasks.',
        '• People: name, email, target hours/week, hourly rate, colour. The person “me” is this installation’s; it cannot be deleted. People with entries are archived rather than deleted.',
        '• Tasks belong to a project and can be “billable by default” — the timer picks up the flag.',
        '• Week close: choose person and week, close. The panel lists closed weeks; each can be reopened there.',
        '• Export package: “My entries” contains only your person, entries and locks plus all projects/clients/tasks; “Everything” the whole data set.',
        '• Import package: id-based merge — new records are added, changed ones are taken over if newer, identical ones stay unchanged. The result appears as a message.',
        '• Tip for teams: the project lead creates clients, projects and tasks, exports “Everything” and distributes the package — so everyone uses the same ids.',
      ],
    },
    {
      id: 'shortcuts',
      title: 'Keyboard shortcuts (expert)',
      body: [
        '• s — start timer (last project) / stop',
        '• n — new entry in the current view',
        '• ← → — change day, week or period',
        '• 1 … 5 — view: today, week, reports, dashboard, team',
        '• ? — manual · Esc — close dialog',
        'Shortcuts are inactive while an input field has focus.',
      ],
    },
    {
      id: 'settings',
      title: 'Settings',
      body: [
        '• General: language, mode (simple / expert “tracked”), dark/light, accent colour.',
        '• Tracking: rounding (none / 5 / 15 minutes), week start, target hours per week, idle detection, end-of-day reminder (expert), confirm before delete.',
        '• Reports: company name for the PDF header.',
        '• App: updates (manual or automatic), data folder, keyboard shortcuts.',
      ],
    },
    {
      id: 'data',
      title: 'Data & backup',
      body: [
        'All data lives in one file, “data.json”, in the app’s data folder (path under Settings → App). Writes are atomic: temp file first, then rename.',
        '• Times are stored in UTC and shown locally — moving between time zones does not shift hours.',
        '• Backup: copy the folder. Or export a package “Everything” under “Team” — same structure, importable.',
        '• Settings live separately in “settings.json” in the config folder.',
      ],
    },
    {
      id: 'updates',
      title: 'Updates',
      body: [
        'timelog silently checks for new versions on launch and shows a banner. With auto-update it installs right away.',
        'Updates are signed — the app only installs packages whose signature matches the built-in key.',
      ],
    },
    {
      id: 'mobile',
      title: 'Phone & browser',
      body: [
        'timelog also runs as a web app in the browser — on a phone with an adapted layout: views sit in the bar at the bottom, “Projects” opens the project list as a drawer, entries appear as cards with project, from/to, duration and note.',
        '• Add to home screen (Safari: Share → “Add to Home Screen”; Chrome: menu → “Install app”) — timelog then starts like an app, without browser chrome, even offline.',
        '• The web version keeps its data in this browser’s storage on this device. There is no sync with the desktop app — exchange data via “Export / Import data” (Settings → App) or the team package.',
        '• Important: clearing the browser’s site data deletes the entries as well. Export regularly.',
        '• CSV and PDF exports arrive as downloads; on iOS they land in “Files” via the share sheet.',
      ],
    },
    {
      id: 'trouble',
      title: 'Troubleshooting',
      body: [
        '• “This week is closed”: the person’s week is locked — reopen it under “Team” or in the week view.',
        '• “Invalid time”: format HH:MM, 24-hour. The field reverts to the old value.',
        '• “End is before start”: when editing the start past the end — adjust the end first.',
        '• Project cannot be deleted: it has entries. Archive it instead.',
        '• Import reports 0 new: the package was already imported — merging is idempotent.',
        '• Duration in the report smaller than in the day view: reports cut at the period, the day view counts the whole entry on its start day.',
      ],
    },
  ],
};

export function Help({ lang, openSignal = 0 }: { lang: Lang; openSignal?: number }) {
  const c = lang === 'de' ? de : en;
  const [mode, setMode] = useState<'closed' | 'tutorial' | 'manual'>(() =>
    localStorage.getItem(SEEN_KEY) ? 'closed' : 'tutorial'
  );
  const [step, setStep] = useState(0);
  const [sel, setSel] = useState(c.sections[0].id);
  const [q, setQ] = useState('');

  useEffect(() => {
    if (openSignal > 0) setMode('manual');
  }, [openSignal]);

  const close = () => {
    localStorage.setItem(SEEN_KEY, '1');
    setMode('closed');
    setStep(0);
  };

  const query = q.trim().toLowerCase();
  const filtered = query
    ? c.sections.filter(
        (s) => s.title.toLowerCase().includes(query) || s.body.some((p) => p.toLowerCase().includes(query))
      )
    : c.sections;
  const current = filtered.find((s) => s.id === sel) ?? filtered[0] ?? null;

  const para = (p: string, i: number) =>
    p.startsWith('• ') ? (
      <div key={i} className="hlp-li">
        {p.slice(2)}
      </div>
    ) : (
      <p key={i}>{p}</p>
    );

  return (
    <>
      <button className="hlp-fab" title={c.labels.fab} onClick={() => setMode('manual')}>
        ?
      </button>
      {mode !== 'closed' && (
        <div className="hlp-overlay" onClick={close}>
          <div className="hlp-modal" onClick={(e) => e.stopPropagation()}>
            <div className="hlp-head">
              <span className="hlp-brand">
                <span className="hlp-name">timelog</span>
                <span className="hlp-dot">.</span>
              </span>
              <button
                className={`hlp-tab ${mode === 'tutorial' ? 'active' : ''}`}
                onClick={() => {
                  setMode('tutorial');
                  setStep(0);
                }}
              >
                {c.labels.tutorial}
              </button>
              <button className={`hlp-tab ${mode === 'manual' ? 'active' : ''}`} onClick={() => setMode('manual')}>
                {c.labels.manual}
              </button>
              <span className="hlp-spacer" />
              <button className="hlp-close" onClick={close}>
                ✕
              </button>
            </div>

            {mode === 'tutorial' && (
              <div className="hlp-tut">
                <div className="hlp-step-count">{c.labels.stepOf(step + 1, c.tutorial.length)}</div>
                <h2>{c.tutorial[step].title}</h2>
                {c.tutorial[step].body.map(para)}
                <div className="hlp-tut-nav">
                  <button className="hlp-ghost" onClick={close}>
                    {c.labels.skip}
                  </button>
                  <span className="hlp-dots">
                    {c.tutorial.map((_, i) => (
                      <span key={i} className={i === step ? 'on' : ''} />
                    ))}
                  </span>
                  {step > 0 && <button onClick={() => setStep(step - 1)}>{c.labels.back}</button>}
                  {step < c.tutorial.length - 1 ? (
                    <button className="hlp-primary" onClick={() => setStep(step + 1)}>
                      {c.labels.next}
                    </button>
                  ) : (
                    <button className="hlp-primary" onClick={close}>
                      {c.labels.done}
                    </button>
                  )}
                </div>
              </div>
            )}

            {mode === 'manual' && (
              <div className="hlp-body">
                <div className="hlp-toc">
                  <input type="text" placeholder={c.labels.search} value={q} onChange={(e) => setQ(e.target.value)} />
                  {filtered.length === 0 && <div className="hlp-empty">{c.labels.noResults}</div>}
                  {filtered.map((s) => (
                    <button
                      key={s.id}
                      className={`hlp-toc-item ${current?.id === s.id ? 'active' : ''}`}
                      onClick={() => setSel(s.id)}
                    >
                      {s.title}
                    </button>
                  ))}
                </div>
                <div className="hlp-content">
                  {current && (
                    <>
                      <h2>{current.title}</h2>
                      {current.body.map(para)}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
