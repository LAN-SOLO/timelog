// timelog UI-Durchlauf mit gemocktem Tauri-IPC (isTauri-Pfade: Dialog-Plugin, Datei-Kommandos).
// DE/EN × dunkel/hell bei 900×600 (Mindestfenster) + Telefon 390 px.
//   pnpm dev; Chrome headless mit --remote-debugging-port=9222 (siehe web-e2e.mjs)
//   [WIDTH=900] node scripts/e2e/ui-mock-ipc.mjs /tmp   # Screenshots landen in /tmp
import { connect } from './cdp.mjs';
const c = await connect();
const U = 'http://localhost:1434/';
const OUT = process.argv[2] || '.';
let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
};
const q = (sel) => c.ev(`!!document.querySelector(${JSON.stringify(sel)})`);
const clickText = (sel, text) =>
  c.ev(`(()=>{const el=[...document.querySelectorAll(${JSON.stringify(sel)})].find(b=>b.textContent.trim().includes(${JSON.stringify(text)})); if(!el) return false; el.click(); return true})()`);
const click = (sel, i = 0) => c.ev(`(()=>{const el=document.querySelectorAll(${JSON.stringify(sel)})[${i}]; if(!el) return false; el.click(); return true})()`);

// Mock: __TAURI_INTERNALS__ → webapi; Dialog-Plugin liefert Pfade mit Umlaut/Leerzeichen;
// window.confirm/alert wie tauri-plugin-dialog 2.7 (async Stub, Promise ist truthy) — Aufrufe werden gezählt.
const MOCK = `
window.__calls = []; window.__written = {}; window.__confirmCalls = 0;
window.confirm = () => { window.__confirmCalls++; return Promise.resolve(false); };
window.alert = () => { window.__confirmCalls++; return Promise.resolve(); };
window.__TAURI_INTERNALS__ = {
  metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
  transformCallback: (cb) => { const id = Math.random(); window['_' + id] = cb; return id; },
  convertFileSrc: (p) => p,
  invoke: async (cmd, args = {}) => {
    window.__calls.push(cmd);
    if (cmd === 'plugin:dialog|save') return 'C:\\\\Users\\\\Jörg Müller\\\\OneDrive\\\\' + (args.options?.defaultPath || 'x');
    if (cmd === 'plugin:dialog|open') return 'C:\\\\Users\\\\Jörg Müller\\\\paket.json';
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

const GERMAN = /\b(Speichern|Abbrechen|Löschen|Eintrag|Einträge|Woche|Projekte?|Bericht|Einstellungen|Heute|Stunden|Kunde|Tätigkeit|Person(en)?\s+anlegen|abgeschlossen|Zusammenfassung|Hilfe)\b/;
const ENGLISH = /\b(Save|Cancel|Delete|Entry|Entries|Week|Report|Settings|Today|Hours|Client|Activity|Summary|Help|Projects)\b/;

async function seed(lang, theme) {
  await c.nav(U);
  // Der erste Seitenaufruf nach dem Start von Vite kann länger dauern
  for (let i = 0; i < 20 && (await c.ev('location.origin')) !== new URL(U).origin; i++) await c.sleep(500);
  await c.ev(`localStorage.clear(); localStorage.setItem('timelog.tutorialSeen','1');
    localStorage.setItem('timelog.settings', JSON.stringify({language:'${lang}', theme:'${theme}', mode:'expert', weekStart:'sunday', companyName:'ACME'})); true`);
  await c.nav(U);
  // Daten über das (gemockte) IPC anlegen
  await c.ev(`(async()=>{const inv=window.__TAURI_INTERNALS__.invoke;
    let d=await inv('save_client',{client:{id:'',name:'Northwind Traders International',archived:false,updatedAt:''}});
    d=await inv('save_project',{project:{id:'',clientId:d.clients[0].id,name:'Website relaunch with a very long project name',color:'#38bdf8',budgetHours:12.5,budgetAmount:0,hourlyRate:85.5,billableDefault:true,archived:false,updatedAt:''}});
    d=await inv('save_project',{project:{id:'',clientId:null,name:'Support',color:'#34d399',budgetHours:0,budgetAmount:0,hourlyRate:0,billableDefault:false,archived:false,updatedAt:''}});
    d=await inv('save_person',{person:{id:'',name:'Alexandra Example-Longname',email:'',weeklyHours:37.5,hourlyRate:70,color:'#a78bfa',archived:false,updatedAt:''}});
    d=await inv('save_task',{task:{id:'',projectId:d.projects[0].id,name:'Design',billableDefault:true,archived:false,updatedAt:''}});
    const n=Date.now();
    for (let i=0;i<6;i++) await inv('save_entry',{entry:{id:'',personId:'',projectId:d.projects[i%2].id,taskId:null,start:new Date(n-(i+2)*3600e3).toISOString(),end:new Date(n-(i+1)*3600e3-60e3).toISOString(),note:'note '+i+' with some longer descriptive text',billable:true,tags:[],locked:false,updatedAt:''}});
    await inv('start_timer',{input:{projectId:d.projects[0].id,taskId:null,note:'running note',personId:null}});
    return true})()`);
  await c.nav(U);
}

async function layoutCheck(tag) {
  const r = await c.ev(`(()=>{
    const W=innerWidth; const bad=[];
    if (document.documentElement.scrollWidth > W + 1) bad.push('page-hscroll '+document.documentElement.scrollWidth);
    for (const el of document.querySelectorAll('button, .chip, .badge, h1, h2, label > span, .seg button')) {
      const r=el.getBoundingClientRect(); if (!r.width) continue;
      if (getComputedStyle(el).overflow==='hidden' && el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).textOverflow!=='ellipsis') bad.push('clip:'+el.textContent.trim().slice(0,30));
      if (r.right > W + 1) bad.push('offscreen:'+el.textContent.trim().slice(0,30)+'@'+Math.round(r.right));
    }
    // Bedienelemente der Kopfzeile dürfen sich nicht überlappen
    const ctl=[...document.querySelectorAll('.header button, .header select, .header input')].filter(e=>e.getBoundingClientRect().width>0 && !e.closest('.overlay'));
    for (let i=0;i<ctl.length;i++) for (let j=i+1;j<ctl.length;j++) {
      const a=ctl[i].getBoundingClientRect(), b=ctl[j].getBoundingClientRect();
      if (a.left < b.right-1 && b.left < a.right-1 && a.top < b.bottom-1 && b.top < a.bottom-1 && !ctl[i].contains(ctl[j]) && !ctl[j].contains(ctl[i])) bad.push('overlap:'+(ctl[i].textContent||ctl[i].tagName).trim().slice(0,15)+'/'+(ctl[j].textContent||ctl[j].tagName).trim().slice(0,15));
    }
    return bad.slice(0,6);
  })()`);
  ok(r.length === 0, `${tag}: kein Überlauf`, r.join(' | '));
}

async function textCheck(tag, lang) {
  const txt = await c.ev(`(()=>{const clone=document.body.cloneNode(true);
    clone.querySelectorAll('input,select,textarea,.c-note,.tnote,.ename,.tname').forEach(x=>x.remove());
    return clone.innerText + ' ' + [...document.querySelectorAll('[title],[placeholder]')].map(e=>(e.title||'')+' '+(e.placeholder||'')).join(' ')})()`);
  const m = (lang === 'en' ? GERMAN : ENGLISH).exec(txt);
  ok(!m, `${tag}: keine Texte der anderen Sprache`, m ? JSON.stringify(txt.slice(Math.max(0, m.index - 40), m.index + 40)) : '');
}

for (const lang of ['de', 'en']) {
  for (const theme of ['dark', 'light']) {
    const tag = `${lang}/${theme}`;
    await c.setWidth(Number(process.env.WIDTH || 900), 600);
    await seed(lang, theme);
    ok((await c.ev(`document.documentElement.getAttribute('data-theme')`)) === theme, `${tag}: Thema aktiv`);
    ok(await q('.timer .clock'), `${tag}: laufender Timer in der Kopfzeile`);
    for (const [i, view] of ['today', 'week', 'reports', 'dashboard', 'team'].entries()) {
      await c.ev(`(()=>{const it=document.querySelectorAll('.sb-item'); return true})()`);
      await c.key(String(i + 1), `Digit${i + 1}`, 49 + i);
      await c.sleep(350);
      await layoutCheck(`${tag} ${view}`);
      await textCheck(`${tag} ${view}`, lang);
      await c.shot(`${OUT}/${lang}-${theme}-${view}.png`);
    }
    // Woche mit Sonntag-Beginn: KW-Label passt zum Montag
    await c.key('2', 'Digit2', 50);
    await c.sleep(200);
    const kw = await c.ev(`(async()=>{const u=await import('/src/util.ts'); const ws=u.weekStartOf(new Date(),'sunday'); return {label:document.querySelector('.viewbar .sub').textContent, want:u.isoWeek(u.addDays(ws,1))}})()`);
    ok(kw.label.includes(String(kw.want)), `${tag}: KW-Label bei Wochenbeginn Sonntag`, JSON.stringify(kw));

    // Berichte: CSV + PDF über das Dialog-Plugin
    await c.key('3', 'Digit3', 51);
    await c.sleep(300);
    await c.ev(`(()=>{const b=[...document.querySelectorAll('.exports button')]; b.forEach(x=>x.click()); return b.length})()`);
    await c.sleep(1500);
    const written = await c.ev(`Object.entries(window.__written).map(([k,v])=>[k, v.slice(0,12)])`);
    const csv = written.filter(([k]) => k.endsWith('.csv'));
    const pdf = written.filter(([k]) => k.endsWith('.pdf'));
    ok(csv.length >= 1 && csv.every(([, v]) => v.charCodeAt(0) === 0xfeff), `${tag}: CSV über Speichern-Dialog mit BOM geschrieben`, JSON.stringify(written.map((w) => w[0].split('\\').pop())));
    ok(pdf.length === 1 && pdf[0][1].startsWith('%PDF-'), `${tag}: PDF über Speichern-Dialog geschrieben`);
    ok(csv.every(([k]) => k.includes('Jörg Müller\\OneDrive')), `${tag}: Pfad mit Umlaut/Leerzeichen unverändert übergeben`);

    // Team: Paket mit BOM über Öffnen-Dialog importieren
    await c.key('5', 'Digit5', 53);
    await c.sleep(300);
    await c.ev(`(async()=>{const w=await import('/src/webapi.ts'); const j=await w.call('export_package',{personId:null}); window.__importJson='\\uFEFF'+j; return 1})()`);
    await clickText('.team button', lang === 'de' ? 'importieren' : 'Import');
    await c.sleep(600);
    const toast = await c.ev(`document.querySelector('.toast')?.textContent || ''`);
    ok(toast.length > 0 && !/ungültig|invalid/i.test(toast), `${tag}: Paket mit BOM importiert`, toast);
    await textCheck(`${tag} import-toast`, lang);

    // Löschen mit Bestätigung: Abbrechen lässt den Eintrag stehen, OK löscht
    await c.key('1', 'Digit1', 49);
    await c.sleep(300);
    const n0 = await c.ev(`document.querySelectorAll('.erow').length`);
    await c.ev(`(()=>{const b=document.querySelector('.erow button[title*="${lang === 'de' ? 'Löschen' : 'Delete'}"]') || [...document.querySelectorAll('.erow button')].pop(); b.click(); return true})()`);
    await c.sleep(250);
    ok(await q('.overlay .modal'), `${tag}: Lösch-Nachfrage erscheint`);
    await layoutCheck(`${tag} confirm`);
    await textCheck(`${tag} confirm`, lang);
    await click('.overlay .modal button.ghost');
    await c.sleep(250);
    ok((await c.ev(`document.querySelectorAll('.erow').length`)) === n0, `${tag}: Abbrechen löscht nicht`);
    await c.ev(`(()=>{const b=document.querySelector('.erow button[title*="${lang === 'de' ? 'Löschen' : 'Delete'}"]') || [...document.querySelectorAll('.erow button')].pop(); b.click(); return true})()`);
    await c.sleep(250);
    await click('.overlay .modal button.primary');
    await c.sleep(300);
    ok((await c.ev(`document.querySelectorAll('.erow').length`)) === n0 - 1, `${tag}: OK löscht`);

    // Kopfzeile mit gestopptem Timer (Projektwahl + Notiz + Start)
    await c.ev(`window.__TAURI_INTERNALS__.invoke('stop_timer').then(()=>1)`);
    await c.nav(U);
    ok(!(await q('.timer .clock')), `${tag}: Timer gestoppt`);
    await layoutCheck(`${tag} header stopped`);
    await c.shot(`${OUT}/${lang}-${theme}-header-stopped.png`);
    // Einstellungen: alle Reiter
    await click('.header button.icon:last-child');
    await c.sleep(250);
    for (let i = 0; i < 4; i++) {
      await click('.set-tabs button', i);
      await c.sleep(150);
      await layoutCheck(`${tag} settings#${i}`);
      await textCheck(`${tag} settings#${i}`, lang);
      await c.shot(`${OUT}/${lang}-${theme}-settings${i}.png`);
    }
    await c.key('Escape', 'Escape', 27);
    await c.sleep(150);
    // Projekt-Dialog
    await c.ev(`(()=>{const b=document.querySelector('.sb-new, .sidebar button.ghost'); if(b) b.click(); return !!b})()`);
    await c.sleep(250);
    if (await q('.modal.project')) {
      await layoutCheck(`${tag} project-modal`);
      await textCheck(`${tag} project-modal`, lang);
      await c.key('Escape', 'Escape', 27);
    }
    // Hilfe
    await c.ev(`(()=>{const f=document.querySelector(".hlp-fab"); if(!f) return document.body.innerText.slice(0,300); f.click(); return true})()`).then((r)=>r!==true&&console.log("NOFAB",r));
    await c.sleep(250);
    await layoutCheck(`${tag} help`);
    await c.shot(`${OUT}/${lang}-${theme}-help.png`);
    await c.key('Escape', 'Escape', 27);
    await c.ev(`(()=>{const b=document.querySelector('.hlp-modal .hlp-close, .hlp-modal button[title]'); b&&b.click(); return true})()`);

    // Telefon
    await c.setWidth(390, 780);
    await c.sleep(400);
    for (const v of ['today', 'reports']) {
      await layoutCheck(`${tag} phone ${v}`);
      await c.shot(`${OUT}/${lang}-${theme}-phone-${v}.png`);
      await c.ev(`(()=>{const b=document.querySelectorAll('.tabbar button')[2]; b&&b.click(); return true})()`);
      await c.sleep(300);
    }
    ok((await c.ev('window.__confirmCalls')) === 0, `${tag}: kein window.confirm/alert benutzt (L1)`);
  }
}
const errs = c.logs.filter((l) => /^EXC|^error/i.test(l));
ok(errs.length === 0, 'keine JS-Exceptions/Konsolenfehler', errs.slice(0, 3).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
c.close();
process.exit(fail ? 1 : 0);
