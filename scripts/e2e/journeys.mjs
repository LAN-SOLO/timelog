// timelog — Nutzerreisen vom Erststart bis zu den Expertenfunktionen, inkl.
// Fehlerfällen (Dialog abgebrochen, Platte voll, gesperrte Datei, schreib-
// geschützter Konfigurationsordner, Neustart mitten im Timer) in DE und EN.
//
//   pnpm dev; headless Chrome mit --remote-debugging-port (siehe web-e2e.mjs)
//   [CDP_PORT=9222] node scripts/e2e/journeys.mjs
//
// Tauri-Mock wie ui-mock-ipc.mjs (invoke → Web-Backend, Dialog-Plugin liefert
// Pfade bzw. null bei „Abbrechen“ wie tauri-plugin-dialog 2.7, window.confirm
// als asynchroner Stub). Zusätzlich: Latenz und Fehler je Kommando, und
// `__exec` protokolliert die Reihenfolge, in der das Backend Kommandos ausführt.
import { connect } from './cdp.mjs';
const c = await connect();
const U = 'http://localhost:1434/';
let pass = 0,
  fail = 0;
const ok = (cond, name, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
};
const q = (sel) => c.ev(`!!document.querySelector(${JSON.stringify(sel)})`);
const click = (sel, i = 0) => c.ev(`(()=>{const el=document.querySelectorAll(${JSON.stringify(sel)})[${i}]; if(!el) return false; el.click(); return true})()`);
const clickText = (sel, text) =>
  c.ev(`(()=>{const el=[...document.querySelectorAll(${JSON.stringify(sel)})].find(b=>b.textContent.trim().includes(${JSON.stringify(text)})); if(!el) return false; el.click(); return true})()`);
// Meldungen seit dem letzten clearToast() (MutationObserver im Mock, DOM bleibt unberührt)
const toast = () => c.ev(`(window.__toasts||[]).join(' | ')`);
const clearToast = () => c.ev(`window.__toasts = []; true`);
const stored = () => c.ev(`JSON.parse(localStorage.getItem('timelog.data')||'null')`);
const myRunning = (d) => d.entries.filter((e) => !e.end && e.personId === d.mePersonId).length;
const setVal = (sel, v, i = 0) =>
  c.ev(`(()=>{const el=document.querySelectorAll(${JSON.stringify(sel)})[${i}]; if(!el) return false;
    const proto=el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto,'value').set.call(el, ${JSON.stringify(v)});
    el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); return true})()`);

const MOCK = `
window.__calls = []; window.__exec = []; window.__written = {}; window.__confirmCalls = 0;
window.__delay = {}; window.__fail = {}; window.__dialog = { save: 'auto', open: 'auto' };
window.__toasts = [];
new MutationObserver(() => { const t = document.querySelector('.toast'); const s = t ? t.textContent : '';
  if (s && s !== window.__lastToast) window.__toasts.push(s); window.__lastToast = s; })
  .observe(document, { subtree: true, childList: true, characterData: true });
window.confirm = () => { window.__confirmCalls++; return Promise.resolve(false); };
window.alert = () => { window.__confirmCalls++; return Promise.resolve(); };
if (!localStorage.getItem('__webOnly')) window.__TAURI_INTERNALS__ = {
  metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
  transformCallback: (cb) => { const id = Math.random(); window['_' + id] = cb; return id; },
  convertFileSrc: (p) => p,
  invoke: async (cmd, args = {}) => {
    window.__calls.push(cmd);
    const d = window.__delay[cmd]; if (d) await new Promise((r) => setTimeout(r, d));
    window.__exec.push(cmd);
    if (window.__fail[cmd]) throw window.__fail[cmd];
    if (cmd === 'plugin:dialog|save') return window.__dialog.save === null ? null : 'C:\\\\Users\\\\Jörg Müller\\\\' + (args.options?.defaultPath || 'x');
    if (cmd === 'plugin:dialog|open') return window.__dialog.open === null ? null : 'C:\\\\Users\\\\Jörg Müller\\\\paket.json';
    if (cmd === 'write_text_file') { window.__written[args.path] = args.content; return null; }
    if (cmd === 'write_file') { window.__written[args.path] = atob(args.dataBase64).slice(0, 8); return null; }
    if (cmd === 'read_text_file') return window.__importJson;
    if (cmd === 'check_update') return null;
    if (cmd === 'data_path') return 'C:\\\\Users\\\\Jörg Müller\\\\AppData\\\\Roaming\\\\com.lan-solo.timelog';
    const w = await import('/src/webapi.ts');
    return w.call(cmd, args);
  },
};`;
await c.send('Page.addScriptToEvaluateOnNewDocument', { source: MOCK });
await c.setWidth(1240, 800);

const L = {
  de: { newProject: 'Neues Projekt', save: 'Speichern', import: 'importieren', zero: '0 neu', saveFail: 'Speichern fehlgeschlagen', lock: 'Woche abschließen', unlock: 'Woche öffnen' },
  en: { newProject: 'New project', save: 'Save', import: 'Import', zero: '0 new', saveFail: 'Saving failed', lock: 'Close week', unlock: 'Reopen week' },
};

async function fresh(lang, { expert = false, tutorialSeen = false, web = false } = {}) {
  await c.nav(U);
  for (let i = 0; i < 20 && (await c.ev('location.origin')) !== new URL(U).origin; i++) await c.sleep(500);
  await c.ev(`localStorage.clear(); ${tutorialSeen ? "localStorage.setItem('timelog.tutorialSeen','1');" : ''}
    ${web ? "localStorage.setItem('__webOnly','1');" : ''}
    localStorage.setItem('timelog.settings', JSON.stringify({language:'${lang}', mode:'${expert ? 'expert' : 'simple'}', confirmDelete:true})); true`);
  await c.nav(U);
}
const inv = (cmd, args = {}) => c.ev(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)})`);

for (const lang of ['de', 'en']) {
  const l = L[lang];
  const T = (s) => `${lang}: ${s}`;

  // J1 Erststart: Tutorial, Esc schließt, Onboarding, kein zweites Tutorial nach Neustart
  await fresh(lang);
  ok(await q('.hlp-modal .hlp-tut'), T('J1 Erststart zeigt das Tutorial'));
  await c.key('Escape', 'Escape', 27);
  await c.sleep(200);
  ok(!(await q('.hlp-modal')), T('J1 Esc schließt das Tutorial'));
  ok(await q('.onboard button.primary'), T('J1 Onboarding ohne Projekte'));
  await c.nav(U);
  ok(!(await q('.hlp-modal')), T('J1 nach Neustart kein Tutorial mehr'));

  // J2 Projekt mit neuem Kunden über den Dialog anlegen
  await click('.onboard button.primary');
  await c.sleep(200);
  await setVal('.modal.project input', lang === 'de' ? 'Bürosanierung' : 'Office refit', 0);
  await setVal('.modal.project input', 'Müller & Söhne', 1);
  await click('.modal.project button.primary');
  await c.sleep(400);
  let d = await stored();
  ok(d.projects.length === 1 && d.clients.length === 1 && d.projects[0].clientId === d.clients[0].id, T('J2 Projekt + neuer Kunde gespeichert'), JSON.stringify([d.projects.length, d.clients.length]));

  // J3 Timer starten, „Neustart“ mitten im Timer, stoppen
  await setVal('.timer input', 'Angebot');
  await click('.timer button.primary');
  await c.sleep(400);
  ok(await q('.timer .clock'), T('J3 Timer läuft in der Kopfzeile'));
  await c.nav(U);
  ok(await q('.timer .clock'), T('J3 nach Neustart läuft der Timer weiter'));
  ok((await c.ev(`document.querySelector('.timer .tnote')?.textContent||''`)).includes('Angebot'), T('J3 Notiz nach Neustart erhalten'));
  await click('.timer button.primary');
  await c.sleep(400);
  d = await stored();
  ok(!(await q('.timer .clock')) && d.entries.length === 1 && d.entries[0].end, T('J3 Stopp beendet den Eintrag'));

  // J4 Gesperrte Datei beim Speichern einer Zeile → Meldung, Zeile springt zurück
  await c.ev(`window.__fail.save_entry = '${l.saveFail}: (os error 32)'; true`);
  await c.ev(`(()=>{const el=document.querySelector('.erow input.c-note')||[...document.querySelectorAll('.erow input')].pop(); el.focus(); return true})()`);
  await setVal('.erow input.c-note', 'geändert');
  await c.key('Enter', 'Enter', 13);
  await c.sleep(400);
  ok((await toast()).includes(l.saveFail), T('J4 gesperrte Datei: Meldung erscheint'), await toast());
  ok((await c.ev(`document.querySelector('.erow input.c-note')?.value`)) === 'Angebot', T('J4 Zeile auf gespeicherten Stand zurück'));
  d = await stored();
  ok(d.entries[0].note === 'Angebot', T('J4 Bestand unverändert'));
  await c.ev(`delete window.__fail.save_entry; true`);
  await clearToast();

  // J5 Berichte: CSV-Export abgebrochen, dann „Platte voll“, dann erfolgreich
  await clickText('.sidebar button, .sb-item, nav button', lang === 'de' ? 'Berichte' : 'Reports');
  await c.sleep(400);
  await c.ev(`window.__dialog.save = null; window.__written = {}; true`);
  await click('.exports button', 0);
  await c.sleep(500);
  ok(Object.keys(await c.ev('window.__written')).length === 0 && !(await toast()), T('J5 Speichern-Dialog abgebrochen: nichts geschrieben, keine Meldung'));
  await c.ev(`window.__dialog.save = 'auto'; window.__fail.write_text_file = '${lang === 'de' ? 'Datei nicht geschrieben: Kein Speicherplatz mehr frei' : 'File not written: no space left on the device'} (os error 28)'; true`);
  await click('.exports button', 0);
  await c.sleep(500);
  const t5 = await toast();
  ok(/os error 28/.test(t5) && !/gespeichert|saved/i.test(t5), T('J5 Platte voll: Fehlermeldung statt Erfolg'), t5);
  await c.ev(`delete window.__fail.write_text_file; true`);
  await clearToast();
  await click('.exports button', 0);
  await c.sleep(500);
  const w5 = await c.ev('Object.entries(window.__written)');
  ok(w5.length === 1 && w5[0][1].charCodeAt(0) === 0xfeff && w5[0][1].includes(lang === 'de' ? 'Bürosanierung' : 'Office refit'), T('J5 CSV mit BOM und Umlauten geschrieben'));

  // J6 Einstellungen bei schreibgeschütztem Konfigurationsordner
  await c.ev(`window.__fail.set_settings = '${lang === 'de' ? 'Einstellungen nicht gespeichert: Schreibgeschützt' : 'Settings not saved: read-only'} (os error 30)'; true`);
  await click('.header button.icon:last-child');
  await c.sleep(250);
  await setVal('.modal.settings select', lang === 'de' ? 'en' : 'de', 0);
  await click('.modal.settings .btnrow button.primary');
  await c.sleep(400);
  ok(/os error 30/.test(await toast()) && (await q('.modal.settings')), T('J6 schreibgeschützt: Meldung, Dialog bleibt offen'));
  await c.key('Escape', 'Escape', 27);
  await c.sleep(200);
  ok(JSON.parse(await c.ev(`localStorage.getItem('timelog.settings')`)).language === lang, T('J6 alte Sprache bleibt gespeichert'));
  await c.ev(`delete window.__fail.set_settings; true`);
  await clearToast();

  // J7 Reihenfolge: Start (langsam) und Stopp (schnell) kurz hintereinander
  const order = await c.ev(`(async()=>{
    const { api } = await import('/src/api.ts');
    const d0 = JSON.parse(localStorage.getItem('timelog.data'));
    window.__exec = []; window.__delay = { start_timer: 400, stop_timer: 0 };
    const a = api.startTimer({ projectId: d0.projects[0].id, taskId: null, note: 'race', personId: null });
    const b = api.stopTimer();
    await Promise.all([a, b]);
    window.__delay = {};
    const d = JSON.parse(localStorage.getItem('timelog.data'));
    return { exec: window.__exec.filter((x) => x.endsWith('_timer')), running: d.entries.filter((e) => !e.end).length };
  })()`);
  ok(order.exec.join() === 'start_timer,stop_timer' && order.running === 0, T('J7 ändernde Kommandos in Aufrufreihenfolge (Start vor Stopp)'), JSON.stringify(order));
  // Gegenprobe ohne Warteschlange (rohes invoke): die Reihenfolge kehrt sich um — das war das Problem
  const raw = await c.ev(`(async()=>{
    const d0 = JSON.parse(localStorage.getItem('timelog.data'));
    const inv = window.__TAURI_INTERNALS__.invoke;
    window.__exec = []; window.__delay = { start_timer: 400 };
    await Promise.all([inv('start_timer',{input:{projectId:d0.projects[0].id,taskId:null,note:'raw',personId:null}}), inv('stop_timer')]);
    window.__delay = {};
    const r = window.__exec.filter((x) => x.endsWith('_timer')).join();
    await inv('stop_timer');
    return r;
  })()`);
  ok(raw === 'stop_timer,start_timer', T('J7 Gegenprobe: ohne Warteschlange überholt der Stopp den Start'), raw);
  // Lesende Kommandos warten nicht auf langsame Änderungen
  const readFast = await c.ev(`(async()=>{
    const { api } = await import('/src/api.ts');
    const d0 = JSON.parse(localStorage.getItem('timelog.data'));
    window.__exec = []; window.__delay = { save_project: 500 };
    const a = api.saveProject({ ...d0.projects[0] });
    await api.dataPath();
    const first = window.__exec[0];
    await a; window.__delay = {};
    return first;
  })()`);
  ok(readFast === 'data_path', T('J7 lesende Kommandos warten nicht'), readFast);
  // Fehler hält die Schlange nicht an
  const afterErr = await c.ev(`(async()=>{
    const { api } = await import('/src/api.ts');
    window.__fail.lock_week = 'x';
    const r1 = await api.lockWeek('nope','2026-01-05').then(()=>'ok',()=>'err');
    delete window.__fail.lock_week;
    const r2 = await api.stopTimer().then(()=>'ok',()=>'err');
    return r1 + ',' + r2;
  })()`);
  ok(afterErr === 'err,ok', T('J7 nach einem Fehler laufen weitere Änderungen'), afterErr);
  await c.nav(U);

  // J8 Expertenmodus: Kürzel „s“ doppelt gedrückt → genau ein Timer, dann Stopp
  await c.ev(`localStorage.setItem('timelog.settings', JSON.stringify({...JSON.parse(localStorage.getItem('timelog.settings')), mode:'expert'})); true`);
  await c.nav(U);
  await c.ev(`window.__delay = { start_timer: 300, stop_timer: 300 }; document.activeElement && document.activeElement.blur(); true`);
  const before = (await stored()).entries.length;
  await c.key('s', 'KeyS', 83);
  await c.key('s', 'KeyS', 83);
  await c.sleep(900);
  d = await stored();
  ok(myRunning(d) === 1 && d.entries.length === before + 1, T('J8 „s“ zweimal schnell: genau ein Timer gestartet'), `${d.entries.length - before}/${myRunning(d)}`);
  await c.key('s', 'KeyS', 83);
  await c.sleep(700);
  d = await stored();
  ok(myRunning(d) === 0, T('J8 „s“ stoppt danach'));
  await c.ev(`window.__delay = {}; true`);

  // J9 Hilfe: „?“ öffnet, Kürzel ruhen, Esc schließt
  await c.key('?', 'Slash', 191);
  await c.sleep(250);
  ok(await q('.hlp-modal .hlp-body'), T('J9 „?“ öffnet das Handbuch'));
  const n9 = (await stored()).entries.length;
  await c.key('s', 'KeyS', 83);
  await c.key('3', 'Digit3', 51);
  await c.sleep(400);
  ok((await stored()).entries.length === n9 && !(await q('.exports')), T('J9 Kürzel ruhen bei offenem Handbuch'));
  await c.key('Escape', 'Escape', 27);
  await c.sleep(200);
  ok(!(await q('.hlp-modal')), T('J9 Esc schließt das Handbuch'));

  // J10 Team-Paket: Öffnen-Dialog abgebrochen, Import, zweiter Import = 0 neu
  await c.key('5', 'Digit5', 53);
  await c.sleep(300);
  await c.ev(`window.__dialog.open = null; true`);
  await clickText('.team button', l.import);
  await c.sleep(300);
  ok(!(await toast()) && (await c.ev(`[...document.querySelectorAll('.team button.primary')].some(b=>!b.disabled)`)), T('J10 Öffnen abgebrochen: keine Meldung, Knopf wieder aktiv'));
  await c.ev(`(async()=>{const w=await import('/src/webapi.ts'); const j=await w.call('export_package',{personId:null}); const p=JSON.parse(j); p.data.entries.push({...p.data.entries[0], id:'import-'+Date.now(), note:'importiert'}); window.__importJson=JSON.stringify(p); window.__dialog.open='auto'; return 1})()`);
  await clickText('.team button', l.import);
  await c.sleep(500);
  const t10a = await toast();
  await clearToast();
  await clickText('.team button', l.import);
  await c.sleep(500);
  const t10b = await toast();
  ok(t10a && !t10a.includes(l.zero) && t10b.includes(l.zero), T('J10 Import, zweiter Import meldet 0 neu'), `${t10a} | ${t10b}`);
  await clearToast();

  // J11 Wochenabschluss: sperrt „+ Eintrag“, Speichern abgelehnt, wieder öffnen
  await c.key('2', 'Digit2', 50);
  await c.sleep(300);
  await clickText('.viewbar button', l.lock);
  await c.sleep(250);
  await click('.overlay .modal button.primary');
  await c.sleep(400);
  ok(await c.ev(`document.querySelector('.viewbar button.primary').disabled`), T('J11 abgeschlossene Woche sperrt „+ Eintrag“'));
  const rej = await c.ev(`(async()=>{const { api } = await import('/src/api.ts'); const d=JSON.parse(localStorage.getItem('timelog.data')); const e=d.entries.find(x=>x.locked); return e ? api.saveEntry({...e, note:'x'}).then(()=>'saved',(m)=>String(m)) : 'none'})()`);
  ok(rej !== 'saved' && rej !== 'none', T('J11 Backend lehnt Änderung in gesperrter Woche ab'), rej);
  await clickText('.viewbar button', l.unlock);
  await c.sleep(400);
  ok(!(await c.ev(`document.querySelector('.viewbar button.primary').disabled`)), T('J11 Woche wieder geöffnet'));

  // J13 Projektfilter per Klick in der Seitenleiste (zweiter Klick hebt auf), ← → in der Woche
  await c.ev(`(async()=>{const inv=window.__TAURI_INTERNALS__.invoke;
    const d=await inv('save_project',{project:{id:'',clientId:null,name:'Zweitprojekt',color:'#34d399',budgetHours:0,budgetAmount:0,hourlyRate:0,billableDefault:false,archived:false,updatedAt:''}});
    const p=d.projects.find(x=>x.name==='Zweitprojekt'); const n=Date.now();
    await inv('save_entry',{entry:{id:'',personId:'',projectId:p.id,taskId:null,start:new Date(n-7200e3).toISOString(),end:new Date(n-3600e3).toISOString(),note:'zwei',billable:false,tags:[],locked:false,updatedAt:''}});
    return 1})()`);
  await c.nav(U);
  await c.key('1', 'Digit1', 49);
  await c.sleep(300);
  const rows0 = await c.ev(`document.querySelectorAll('.erow').length`);
  await clickText('.sidebar button, .sidebar .sb-proj, .sidebar [role=button]', 'Zweitprojekt');
  await c.sleep(300);
  const rows1 = await c.ev(`document.querySelectorAll('.erow').length`);
  await clickText('.sidebar button, .sidebar .sb-proj, .sidebar [role=button]', 'Zweitprojekt');
  await c.sleep(300);
  const rows2 = await c.ev(`document.querySelectorAll('.erow').length`);
  ok(rows1 === 1 && rows0 > 1 && rows2 === rows0, T('J13 Projektfilter: Klick filtert, zweiter Klick hebt auf'), `${rows0}/${rows1}/${rows2}`);
  await c.key('2', 'Digit2', 50);
  await c.sleep(300);
  const kw0 = await c.ev(`document.querySelector('.viewbar .sub').textContent`);
  await c.key('ArrowLeft', 'ArrowLeft', 37);
  await c.sleep(300);
  const kw1 = await c.ev(`document.querySelector('.viewbar .sub').textContent`);
  await c.key('ArrowRight', 'ArrowRight', 39);
  await c.sleep(300);
  ok(kw1 !== kw0 && (await c.ev(`document.querySelector('.viewbar .sub').textContent`)) === kw0, T('J13 ← → wechseln die Woche'), `${kw0} → ${kw1}`);

  // J12 Web-Version: Dateiauswahl abbrechen in einem Browser ohne „cancel“-Ereignis
  await fresh(lang, { tutorialSeen: true, web: true });
  ok(!(await c.ev(`'__TAURI_INTERNALS__' in window`)), T('J12 Web-Backend aktiv'));
  await c.ev(`HTMLInputElement.prototype.click = function(){ window.__pickerOpened = (window.__pickerOpened||0)+1; }; true`);
  await click('.header button.icon:last-child');
  await c.sleep(250);
  await click('.set-tabs button', 3);
  await c.sleep(200);
  const impBtn = `[...document.querySelectorAll('.modal.settings .btnrow button')].find(b=>/importieren|Import/.test(b.textContent))`;
  await c.ev(`${impBtn}.click(); true`);
  await c.sleep(200);
  ok((await c.ev('window.__pickerOpened')) === 1 && (await c.ev(`${impBtn}.disabled`)), T('J12 Import läuft (Knopf gesperrt)'));
  await c.ev(`window.dispatchEvent(new Event('focus')); true`);
  await c.sleep(2000);
  ok(!(await c.ev(`${impBtn}.disabled`)), T('J12 nach Fokus ohne Datei ist der Import-Knopf wieder frei'));
  await c.ev(`${impBtn}.click(); true`);
  await c.sleep(200);
  ok((await c.ev('window.__pickerOpened')) === 2, T('J12 Import lässt sich erneut öffnen'));
  await c.ev(`localStorage.removeItem('__webOnly'); true`);
}

ok((await c.ev('window.__confirmCalls || 0')) === 0, 'kein window.confirm/alert benutzt');
const errs = c.logs.filter((l) => /^EXC/.test(l));
ok(errs.length === 0, 'keine JS-Exceptions', errs.slice(0, 3).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
c.close();
process.exit(fail ? 1 : 0);
