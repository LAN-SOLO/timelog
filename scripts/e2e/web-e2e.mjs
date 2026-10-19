// timelog Web-UI E2E (headless Chrome via CDP, Web-Backend src/webapi.ts)
//
//   pnpm dev                                    # http://localhost:1434
//   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
//     --headless=new --remote-debugging-port=9222 --user-data-dir=/tmp/tl-e2e about:blank
//   node scripts/e2e/web-e2e.mjs /tmp           # Screenshots landen in /tmp
//
// Läuft gegen das Web-Backend (localStorage) — gleicher Kommando-Vertrag wie
// die Tauri-Kommandos. Löscht den localStorage von localhost:1434!
import { connect } from './cdp.mjs';
const c = await connect();
const U = 'http://localhost:1434/';
const OUT = process.argv[2] || '.';
let pass = 0,
  fail = 0;
const ok = (cond, name, extra = '') => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
};
const q = (sel) => c.ev(`!!document.querySelector(${JSON.stringify(sel)})`);
const click = (sel, i = 0) => c.ev(`(()=>{const el=document.querySelectorAll(${JSON.stringify(sel)})[${i}]; if(!el) return false; el.click(); return true})()`);
const clickText = (sel, text) =>
  c.ev(`(()=>{const el=[...document.querySelectorAll(${JSON.stringify(sel)})].find(b=>b.textContent.trim().includes(${JSON.stringify(text)})); if(!el) return false; el.click(); return true})()`);
const focus = (sel, i = 0) => c.ev(`(()=>{const el=document.querySelectorAll(${JSON.stringify(sel)})[${i}]; el.focus(); el.select && el.select(); return true})()`);
const stored = () => c.ev(`JSON.parse(localStorage.getItem('timelog.data'))`);
const W = (expr) => c.ev(`(async()=>{const w=await import('/src/webapi.ts'); const call=w.call; ${expr}})()`);

await c.setWidth(1300);
await c.nav(U);
await c.ev(`localStorage.clear(); localStorage.setItem('timelog.tutorialSeen','1'); localStorage.setItem('timelog.settings', JSON.stringify({language:'de'})); true`);
await c.nav(U);

// --- Onboarding + Projekt anlegen (UI) ---
ok(await q('.onboard'), 'Onboarding ohne Projekte sichtbar');
await clickText('.onboard button', 'Projekt anlegen');
await c.sleep(200);
ok(await q('.modal.project'), 'Projekt-Dialog öffnet');
await focus('.modal.project input[type=text]');
await c.type('Website');
await focus('.modal.project input[list=tl-clients]');
await c.type('ACME');
await clickText('.modal.project button', 'Speichern');
await c.sleep(300);
let d = await stored();
ok(d.projects.length === 1 && d.projects[0].name === 'Website', 'Projekt gespeichert');
ok(d.clients.length === 1 && d.clients[0].name === 'ACME' && d.projects[0].clientId === d.clients[0].id, 'Neuer Kunde per Freitext angelegt');

// --- Timer ---
await focus('.timer input[type=text]');
await c.type('Kickoff');
await clickText('.timer button', 'Start');
await c.sleep(1300);
d = await stored();
ok(d.entries.length === 1 && d.entries[0].end === null && d.entries[0].note === 'Kickoff', 'Timer startet laufenden Eintrag mit Notiz');
ok(await q('.timer .clock'), 'Kopfzeile zeigt Uhr');
await clickText('.timer button', 'Stopp');
await c.sleep(300);
d = await stored();
ok(d.entries[0].end !== null, 'Timer stoppt');

// --- + Eintrag & Inline-Bearbeitung ---
await clickText('.viewbar button.primary', 'Eintrag');
await c.sleep(300);
d = await stored();
ok(d.entries.length === 2, '+ Eintrag legt Eintrag an');
const rows = await c.ev(`document.querySelectorAll('.erow').length`);
ok(rows === 2, 'Tagesansicht zeigt 2 Zeilen', String(rows));
// Notiz bearbeiten + Enter
await focus('.erow .c-note', 1);
await c.type('Konzept');
await c.key('Enter', 'Enter', 13);
await c.sleep(300);
d = await stored();
ok(d.entries.some((e) => e.note === 'Konzept'), 'Notiz per Enter gespeichert');
// Esc verwirft
const before = (await stored()).entries.map((e) => e.note).sort().join('|');
await focus('.erow .c-note', 1);
await c.type('VERWERFEN');
await c.key('Escape', 'Escape', 27);
await c.sleep(300);
const after = (await stored()).entries.map((e) => e.note).sort().join('|');
const shown = await c.ev(`document.querySelectorAll('.erow .c-note')[1].value`);
ok(before === after && !shown.includes('VERWERFEN'), 'Esc verwirft Änderung (Notiz)', `${after} / shown=${shown}`);
// Esc bei Zeitfeld
const startBefore = (await stored()).entries.map((e) => e.start).sort().join('|');
await focus('.erow .c-from', 1);
await c.type('0700');
await c.key('Escape', 'Escape', 27);
await c.sleep(300);
ok((await stored()).entries.map((e) => e.start).sort().join('|') === startBefore, 'Esc verwirft Änderung (Von)');
// Ungültige Zeit
await focus('.erow .c-from', 1);
await c.type('25:99');
await c.key('Enter', 'Enter', 13);
await c.sleep(300);
ok(await q('.toast'), 'Ungültige Uhrzeit → Fehlermeldung');
// Start nach Ende → Backend lehnt ab, Feld setzt sich zurück
const e1 = await c.ev(`document.querySelectorAll('.erow .c-to')[1].value`);
await focus('.erow .c-from', 1);
await c.type('23:58');
await c.key('Enter', 'Enter', 13);
await c.sleep(400);
const fromShown = await c.ev(`document.querySelectorAll('.erow .c-from')[1].value`);
const toastTxt = await c.ev(`document.querySelector('.toast')?.textContent ?? ''`);
ok(fromShown !== '23:58' && /Ende liegt vor dem Start/.test(toastTxt), 'Start nach Ende: abgelehnt + Feld zurückgesetzt', `${fromShown} / ${toastTxt} / to=${e1}`);
// Ende über Mitternacht
await focus('.erow .c-to', 1);
await c.type('01:00');
await c.key('Enter', 'Enter', 13);
await c.sleep(300);
d = await stored();
const night = d.entries.find((e) => e.note === 'Konzept');
ok(night && new Date(night.end) > new Date(night.start) && new Date(night.end).getDate() !== new Date(night.start).getDate(), '„Bis“ vor „Von“ = Folgetag');
// Duplizieren
await c.ev(`document.querySelectorAll('.erow')[1].querySelector('.acts button[title="Duplizieren"]').click(); true`);
await c.sleep(300);
ok((await stored()).entries.length === 3, 'Duplizieren');
// Löschen mit Nachfrage
await c.ev(`document.querySelectorAll('.erow')[2].querySelector('.acts button.danger').click(); true`);
await c.sleep(200);
ok(await q('.overlay .modal'), 'Löschen fragt nach');
await c.key('Escape', 'Escape', 27);
await c.sleep(200);
ok(!(await q('.overlay .modal')) && (await stored()).entries.length === 3, 'Esc bricht Nachfrage ab (einfacher Modus)');
await c.ev(`document.querySelectorAll('.erow')[2].querySelector('.acts button.danger').click(); true`);
await c.sleep(200);
await clickText('.overlay .modal button', 'OK');
await c.sleep(300);
ok((await stored()).entries.length === 2, 'Löschen nach OK');
// Erneut starten
await c.ev(`document.querySelectorAll('.erow')[0].querySelector('.acts button[title="Erneut starten"]').click(); true`);
await c.sleep(300);
d = await stored();
ok(d.entries.filter((e) => !e.end).length === 1 && d.entries.length === 3, 'Erneut starten startet Timer');
await clickText('.timer button', 'Stopp');
await c.sleep(200);

// --- Woche ---
await clickText('.sb-item', 'Woche');
await c.sleep(300);
ok(await q('.weekfoot'), 'Wochenansicht mit Fußzeile');

// --- Einstellungen: Dezimal-Soll, Rundung, Hell ---
await c.ev(`document.querySelector('.header button[title="Einstellungen"]').click(); true`);
await c.sleep(200);
await clickText('.set-tabs button', 'Erfassung');
await c.sleep(100);
await focus('.modal.settings input[inputmode=decimal]');
await c.type('37,5');
const typed = await c.ev(`document.querySelector('.modal.settings input[inputmode=decimal]').value`);
ok(typed === '37,5', 'Dezimaleingabe 37,5 im Soll-Feld bleibt stehen', typed);
await c.ev(`(()=>{const s=document.querySelector('.modal.settings select'); const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set; set.call(s,'15'); s.dispatchEvent(new Event('change',{bubbles:true})); return true})()`);
await clickText('.set-tabs button', 'Allgemein');
await c.sleep(100);
await c.ev(`(()=>{const s=[...document.querySelectorAll('.modal.settings select')][2]; const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set; set.call(s,'light'); s.dispatchEvent(new Event('change',{bubbles:true})); return true})()`);
await clickText('.modal.settings .btnrow button', 'Speichern');
await c.sleep(300);
const st = await c.ev(`JSON.parse(localStorage.getItem('timelog.settings'))`);
ok(st.weeklyHours === 37.5 && st.rounding === 15 && st.theme === 'light', 'Einstellungen gespeichert (37.5 h, 15 min, hell)', JSON.stringify({ w: st.weeklyHours, r: st.rounding, t: st.theme }));
ok((await c.ev(`document.documentElement.getAttribute('data-theme')`)) === 'light', 'Hell-Modus aktiv');
await c.shot(`${OUT}/timelog-week-light.png`);
// Esc verwirft Live-Vorschau
await c.ev(`document.querySelector('.header button[title="Einstellungen"]').click(); true`);
await c.sleep(200);
await c.ev(`(()=>{const s=[...document.querySelectorAll('.modal.settings select')][2]; const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set; set.call(s,'dark'); s.dispatchEvent(new Event('change',{bubbles:true})); return true})()`);
await c.sleep(100);
await c.key('Escape', 'Escape', 27);
await c.sleep(200);
ok(!(await q('.modal.settings')) && (await c.ev(`document.documentElement.getAttribute('data-theme')`)) === 'light', 'Esc schließt Einstellungen und verwirft Vorschau');

// --- Expertenmodus ---
await clickText('.header .seg button', 'Experte');
await c.sleep(300);
ok((await c.ev(`JSON.parse(localStorage.getItem('timelog.settings')).mode`)) === 'expert', 'Expertenmodus umgeschaltet');
ok(await clickText('.sb-item', 'Team'), 'Team-Ansicht erreichbar');
await c.sleep(300);
// Person anlegen mit Dezimalwerten
await clickText('.team button', 'Person anlegen');
await c.sleep(100);
await focus('.tform input[type=text]', 0);
await c.type('Anna');
await focus('.tform input[inputmode=decimal]', 0);
await c.type('37,5');
await focus('.tform input[inputmode=decimal]', 1);
await c.type('85,50');
await clickText('.tform button', 'Speichern');
await c.sleep(300);
d = await stored();
const anna = d.persons.find((p) => p.name === 'Anna');
ok(anna && anna.weeklyHours === 37.5 && anna.hourlyRate === 85.5, 'Person mit 37,5 h und 85,50 €/h', JSON.stringify(anna && [anna.weeklyHours, anna.hourlyRate]));
// Tätigkeit
await clickText('.team button', 'Tätigkeit anlegen');
await c.sleep(100);
await focus('.tform input[type=text]', 0);
await c.type('Design');
await clickText('.tform button', 'Speichern');
await c.sleep(300);
ok((await stored()).tasks.length === 1, 'Tätigkeit angelegt');
// Kunde
await clickText('.team button', 'Kunde anlegen');
await c.sleep(100);
await focus('.tform input[type=text]', 0);
await c.type('Beta GmbH');
await c.key('Enter', 'Enter', 13);
await c.sleep(300);
ok((await stored()).clients.length === 2, 'Kunde per Enter angelegt');
// Projekt-Budget dezimal
await c.ev(`document.querySelector('.sidebar .sb-item.archived, .sidebar div.sb-item button.icon').click(); true`);
await c.sleep(200);
ok(await q('.modal.project'), 'Projekt bearbeiten öffnet');
await focus('.modal.project input[inputmode=decimal]', 0);
await c.type('12,5');
await focus('.modal.project input[inputmode=decimal]', 2);
await c.type('99,9');
await clickText('.modal.project button', 'Speichern');
await c.sleep(300);
d = await stored();
ok(d.projects[0].budgetHours === 12.5 && d.projects[0].hourlyRate === 99.9, 'Projekt-Budget 12,5 h / Satz 99,9', JSON.stringify([d.projects[0].budgetHours, d.projects[0].hourlyRate]));

// Tastaturkürzel
await c.ev(`document.activeElement && document.activeElement.blur(); true`);
await c.key('4', 'Digit4', 52);
await c.sleep(300);
ok(await q('.kpis'), 'Kürzel 4 → Dashboard');
await c.shot(`${OUT}/timelog-dashboard.png`);
await c.key('3', 'Digit3', 51);
await c.sleep(300);
ok(await q('.view h1') && (await c.ev(`document.querySelector('.view h1').textContent`)) === 'Berichte', 'Kürzel 3 → Berichte');
for (const g of ['Kunde', 'Person', 'Tätigkeit', 'Projekt']) {
  await clickText('.viewbar .seg button', g);
  await c.sleep(200);
}
ok(await q('.rtable'), 'Berichtstabelle');
await clickText('.btnrow button', 'Detailliste anzeigen');
await c.sleep(200);
ok(await q('.rtable.detail'), 'Detailliste');
for (const r of ['Heute', 'Monat', 'Frei', 'Woche']) await clickText('.viewbar .seg button', r);
await c.key('s', 'KeyS', 83);
await c.sleep(300);
ok((await stored()).entries.some((e) => !e.end), 'Kürzel s startet Timer');
await c.key('s', 'KeyS', 83);
await c.sleep(300);
ok(!(await stored()).entries.some((e) => !e.end), 'Kürzel s stoppt Timer');

// Woche abschließen (Team) & Sperrwirkung
await c.key('2', 'Digit2', 50);
await c.sleep(300);
await clickText('.viewbar button', 'Woche abschließen');
await c.sleep(200);
await clickText('.overlay .modal button', 'OK');
await c.sleep(300);
d = await stored();
ok(d.locks.length === 1 && d.entries.filter((e) => e.personId === d.mePersonId).every((e) => e.locked || new Date(e.start) < new Date(Date.now() - 8 * 864e5)), 'Woche abgeschlossen, Einträge gesperrt');
ok((await c.ev(`document.querySelector('.viewbar button.primary').disabled`)) === true, '+ Eintrag in gesperrter Woche deaktiviert');
const rLocked = await W(`try { await call('delete_entry', {id: ${JSON.stringify(d.entries[0].id)}}); return 'deleted'; } catch(e) { return String(e); }`);
ok(/abgeschlossen/.test(rLocked), 'Backend verweigert Löschen in gesperrter Woche', rLocked);
await clickText('.viewbar button', 'Woche öffnen');
await c.sleep(300);
ok((await stored()).locks.length === 0, 'Woche wieder geöffnet');

// --- Web-Backend-Vertrag direkt ---
// frisch laden: der per import() geholte Modul-Zustand ist eine eigene Instanz
await c.nav(U);
const csv = await W(`const n=new Date(); const f=new Date(n.getTime()-30*864e5).toISOString(); const t=new Date(n.getTime()+2*864e5).toISOString(); return await call('export_csv',{from:f,to:t,kind:'entries',groupBy:'project',filter:{}});`);
ok(csv.startsWith('Datum;Start;Ende;Dauer'), 'CSV Einträge (DE, Semikolon)');
await W(`const d=await call('get_data'); const e=d.entries[0]; await call('save_entry',{entry:{...e, note:'=HYPERLINK(1)'}}); return true;`);
const csv2 = await W(`const n=new Date(); return await call('export_csv',{from:new Date(n.getTime()-30*864e5).toISOString(),to:new Date(n.getTime()+2*864e5).toISOString(),kind:'entries',groupBy:'project',filter:{}});`);
ok(csv2.includes(";'=HYPERLINK(1);"), 'CSV-Formel-Injektion neutralisiert (Web)');
const sum = await W(`const n=new Date(); return await call('export_csv',{from:new Date(n.getTime()-30*864e5).toISOString(),to:new Date(n.getTime()+2*864e5).toISOString(),kind:'summary',groupBy:'client',filter:{}});`);
ok(sum.split('\r\n')[0].startsWith('Kunde;Einträge;Dauer') && sum.includes('Summe;'), 'CSV Zusammenfassung nach Kunde mit Summenzeile');
const pkg = await W(`return await call('export_package',{personId:null});`);
const p = JSON.parse(pkg);
ok(p.format === 'timelog-package' && p.version === 1, 'Paket-Export');
const imp = await W(`return await call('import_package',{json:${JSON.stringify(pkg)}});`);
ok(imp.report.added === 0 && imp.report.updated === 0, 'Re-Import idempotent', JSON.stringify(imp.report));
const bad = await W(`try { await call('import_package',{json:'{"format":"x"}'}); return 'ok'; } catch(e) { return String(e); }`);
ok(/Kein timelog-Paket/.test(bad), 'Fremdes JSON abgelehnt');
// Laufender Eintrag einer Kollegin aus einem Team-Paket: eigener Start/Stopp lässt ihn in Ruhe
const tm = await W(`const d=await call('get_data'); const now=new Date().toISOString();
  const pk={format:'timelog-package',version:1,exportedAt:now,data:{...d, mePersonId:'tm-1', locks:[],
    persons:[{id:'tm-1',name:'Kollegin',email:'',weeklyHours:0,hourlyRate:0,color:'#888',archived:false,updatedAt:now}],
    entries:[{id:'tm-run',personId:'tm-1',projectId:d.projects[0].id,taskId:null,start:now,end:null,note:'läuft',billable:true,tags:[],locked:false,updatedAt:now}]}};
  await call('import_package',{json:JSON.stringify(pk)});
  await call('start_timer',{input:{projectId:d.projects[0].id,taskId:null,note:'',personId:null}});
  const r1=await call('running'); const a=await call('get_data');
  await call('stop_timer'); const b=await call('get_data');
  const other=(x)=>x.entries.find(e=>e.id==='tm-run');
  const res={own:r1&&r1.personId===a.mePersonId, otherRunAfterStart:!other(a).end, otherRunAfterStop:!other(b).end, ownStopped:!b.entries.some(e=>!e.end&&e.personId===b.mePersonId)};
  await call('save_entry',{entry:{...other(b), end:new Date().toISOString()}});
  return res;`);
ok(tm.own && tm.otherRunAfterStart && tm.otherRunAfterStop && tm.ownStopped, 'Timer je Person: Team-Import bleibt unberührt', JSON.stringify(tm));
const wt = await W(`return await call('weekly_totals',{weeks:8,filter:{}});`);
ok(wt.length === 8, 'Wochen-Trend 8 Wochen');
const bu = await W(`return await call('budget_usages');`);
ok(bu.length === 1 && bu[0].hoursPct !== null, 'Budgetverbrauch');
const delp = await W(`const d=await call('get_data'); try { await call('delete_project',{id:d.projects[0].id}); return 'x'; } catch(e) { return String(e); }`);
ok(/Einträge/.test(delp), 'Projekt mit Einträgen nicht löschbar');
const delme = await W(`const d=await call('get_data'); try { await call('delete_person',{id:d.mePersonId}); return 'x'; } catch(e) { return String(e); }`);
ok(/eigene Person/.test(delme), 'Eigene Person nicht löschbar');
const sane = await W(`await call('set_settings',{settings:{...(await call('get_settings')), rounding:7, language:'xx'}}); return await call('get_settings');`);
ok(sane.rounding === 0 && ['de', 'en'].includes(sane.language), 'Web: ungültige Einstellungen bereinigt');
await W(`await call('set_settings',{settings:{...(await call('get_settings')), language:'de'}}); return 1;`);

// PDF-Bericht (jsPDF) im Browser erzeugen
const pdfInfo = await c.ev(`(async()=>{const w=await import('/src/webapi.ts'); const {buildReportPdf}=await import('/src/pdf.ts'); const {dicts}=await import('/src/i18n.ts');
 const data=await w.call('get_data'); const settings={...(await w.call('get_settings')), companyName:'ACME GmbH'}; const n=new Date();
 const from=new Date(n.getTime()-30*864e5).toISOString(), to=new Date(n.getTime()+2*864e5).toISOString();
 const summary=await w.call('summary',{from,to,groupBy:'person',filter:{}});
 const r=buildReportPdf({summary,groupBy:'person',rangeLabel:'Test',entries:data.entries,data,settings,t:dicts.de,lang:'de',now:n});
 return {len:r.bytes.length, head:String.fromCharCode(...r.bytes.slice(0,5)), name:r.suggestedName};})()`);
ok(pdfInfo.head === '%PDF-' && pdfInfo.len > 2000 && /^timelog_zeitbericht_\d{4}-\d{2}-\d{2}\.pdf$/.test(pdfInfo.name), 'PDF-Bericht erzeugt', JSON.stringify(pdfInfo));

// --- Defekter localStorage-Bestand wird gesichert ---
await c.ev(`localStorage.setItem('timelog.data','{kaputt'); true`);
await c.nav(U);
const keys = await c.ev(`Object.keys(localStorage).filter(k=>k.startsWith('timelog.data.corrupt-')).length`);
ok(keys === 1, 'Defekter Web-Bestand als timelog.data.corrupt-* gesichert');

// --- Telefon-Layout & Hilfe ---
await c.setWidth(390, 844);
await c.sleep(500);
ok((await c.ev(`getComputedStyle(document.querySelector('.tabbar')).display`)) !== 'none', 'Telefon: Tab-Leiste sichtbar');
await c.shot(`${OUT}/timelog-phone.png`);
await c.setWidth(1300);
await c.ev(`document.querySelector('.hlp-fab').click(); true`);
await c.sleep(200);
ok(await q('.hlp-modal'), 'Hilfe öffnet');
await clickText('.hlp-lang button', 'EN');
await c.sleep(100);
ok((await c.ev(`document.querySelector('.hlp-content h2').textContent`)).length > 0 && (await c.ev(`document.querySelector('.hlp-toc input').placeholder`)).startsWith('Search'), 'Hilfe auf EN umschaltbar');

const errs = c.logs.filter((l) => /^EXC|^error/i.test(l));
ok(errs.length === 0, 'keine JS-Exceptions/Konsolenfehler', errs.slice(0, 3).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
c.close();
process.exit(fail ? 1 : 0);
