// timelog — Browser-Backend. Läuft, wenn kein Tauri vorhanden ist (Webapp im
// Browser / auf dem Telefon). Gleicher Kommando-Vertrag wie
// src-tauri/src/commands.rs; die Daten liegen im localStorage dieses Geräts.
// Die Fachlogik ist aus core/ (time, summary, csv, merge) gespiegelt — bei
// Änderungen dort bitte hier mitziehen.
import type {
  BudgetUsage,
  Client,
  Data,
  Entry,
  Filter,
  GroupBy,
  ImportResult,
  MergeReport,
  Person,
  Project,
  Settings,
  Summary,
  SummaryRow,
  Task,
  TimerStart,
  WeekLock,
  WeekStart,
  WeekTotal,
} from './api';
import { emptyData } from './api';
import { DateRange, addDays, dateKey, durationSecs, fmtTime, overlapSecs, roundSecs, startOfDay, weekStartOf } from './util';

const DATA_KEY = 'timelog.data';
const SETTINGS_KEY = 'timelog.settings';

type Args = Record<string, unknown>;

// --- Hilfen -----------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function parseIso(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function rangeFrom(from: string, to: string): DateRange {
  const f = parseIso(from);
  const t = parseIso(to);
  if (!f) throw msg('Ungültiger Zeitraum (von)', 'Invalid range (from)');
  if (!t) throw msg('Ungültiger Zeitraum (bis)', 'Invalid range (to)');
  if (t < f) throw msg('Zeitraum: „bis“ liegt vor „von“', 'Range: “to” is before “from”');
  return { from: f, to: t };
}

function deepEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEq((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

// --- Einstellungen ----------------------------------------------------------

function defaultSettings(): Settings {
  const de = (navigator.language || '').toLowerCase().startsWith('de');
  return {
    language: de ? 'de' : 'en',
    mode: 'simple',
    theme: 'dark',
    accent: 'blue',
    autoUpdate: false,
    rounding: 0,
    weekStart: 'monday',
    weeklyHours: 0,
    companyName: '',
    idleMinutes: 15,
    endOfDayHour: 0,
    confirmDelete: true,
  };
}

let settings: Settings = loadSettings();

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...defaultSettings(), ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    // defekter Eintrag → Standard
  }
  return defaultSettings();
}

function msg(de: string, en: string): string {
  return settings.language === 'de' ? de : en;
}

// --- Datenbestand -----------------------------------------------------------

let data: Data = loadData();

function loadData(): Data {
  let d: Data = { ...emptyData };
  try {
    const raw = localStorage.getItem(DATA_KEY);
    if (raw) d = { ...emptyData, ...(JSON.parse(raw) as Partial<Data>) };
  } catch {
    // defekter Eintrag → leer
  }
  ensureMe(d);
  return d;
}

/** Stellt sicher, dass es die eigene Person gibt. */
function ensureMe(d: Data) {
  if (d.mePersonId && d.persons.some((p) => p.id === d.mePersonId)) return;
  if (d.persons.length > 0) {
    d.mePersonId = d.persons[0].id;
    return;
  }
  const id = newId();
  d.persons.push({
    id,
    name: settings.language === 'de' ? 'Ich' : 'Me',
    email: '',
    weeklyHours: 0,
    hourlyRate: 0,
    color: '#38bdf8',
    archived: false,
    updatedAt: nowIso(),
  });
  d.mePersonId = id;
}

function persist() {
  try {
    localStorage.setItem(DATA_KEY, JSON.stringify(data));
  } catch (e) {
    throw msg(`Speichern fehlgeschlagen: ${e}`, `Saving failed: ${e}`);
  }
}

/** Änderung ausführen, speichern, Kopie des Bestands zurückgeben. */
function mutate(f: (d: Data) => void): Data {
  const next: Data = JSON.parse(JSON.stringify(data));
  f(next);
  data = next;
  persist();
  return JSON.parse(JSON.stringify(data));
}

const project = (d: Data, id: string) => d.projects.find((p) => p.id === id);
const person = (d: Data, id: string) => d.persons.find((p) => p.id === id);
const client = (d: Data, id: string) => d.clients.find((c) => c.id === id);
const task = (d: Data, id: string) => d.tasks.find((t) => t.id === id);
const isWeekLocked = (d: Data, personId: string, weekStart: string) =>
  d.locks.some((l) => l.personId === personId && l.weekStart === weekStart);

const ws = (): WeekStart => settings.weekStart;
const rounding = () => settings.rounding;
const simpleMode = () => settings.mode !== 'expert';

function entryWeekStart(e: Entry, w: WeekStart): string | null {
  const d = parseIso(e.start);
  return d ? dateKey(weekStartOf(d, w)) : null;
}

function entryLocked(d: Data, e: Entry, w: WeekStart): boolean {
  if (e.locked) return true;
  const k = entryWeekStart(e, w);
  return k ? isWeekLocked(d, e.personId, k) : false;
}

function upsert<T extends { id: string; updatedAt: string }>(list: T[], item: T) {
  item.updatedAt = nowIso();
  if (!item.id) {
    item.id = newId();
    list.push(item);
    return;
  }
  const i = list.findIndex((x) => x.id === item.id);
  if (i >= 0) list[i] = item;
  else list.push(item);
}

// --- Aggregation (core/summary.rs) -----------------------------------------

function filterMatches(d: Data, f: Filter, e: Entry): boolean {
  if (f.personId && e.personId !== f.personId) return false;
  if (f.projectId && e.projectId !== f.projectId) return false;
  if (f.clientId) {
    const cid = project(d, e.projectId)?.clientId ?? null;
    if (cid !== f.clientId) return false;
  }
  return true;
}

function rateFor(d: Data, e: Entry): number {
  const pr = project(d, e.projectId)?.hourlyRate ?? 0;
  if (pr > 0) return pr;
  return person(d, e.personId)?.hourlyRate ?? 0;
}

function amountFor(d: Data, e: Entry, roundedSecs: number): number {
  if (!e.billable) return 0;
  const rate = rateFor(d, e);
  if (rate <= 0) return 0;
  return Math.round((roundedSecs / 3600) * rate * 100) / 100;
}

function groupKey(d: Data, e: Entry, by: GroupBy): [string, string, string | null] {
  switch (by) {
    case 'client': {
      const cid = project(d, e.projectId)?.clientId;
      const c = cid ? client(d, cid) : undefined;
      return c ? [c.id, c.name, null] : ['', '', null];
    }
    case 'person': {
      const p = person(d, e.personId);
      return p ? [p.id, p.name, p.color] : ['', '', null];
    }
    case 'task': {
      const t = e.taskId ? task(d, e.taskId) : undefined;
      if (!t) return ['', '', null];
      const pn = project(d, t.projectId)?.name ?? '';
      return [t.id, pn ? `${pn} · ${t.name}` : t.name, null];
    }
    default: {
      const p = project(d, e.projectId);
      return p ? [p.id, p.name, p.color] : ['', '', null];
    }
  }
}

function summarize(d: Data, range: DateRange, by: GroupBy, f: Filter, roundingMin: number, now: Date): Summary {
  const groups = new Map<string, SummaryRow>();
  let total = 0;
  let totalR = 0;
  let totalB = 0;
  let totalAmount = 0;
  let count = 0;
  for (const e of d.entries) {
    if (!filterMatches(d, f, e)) continue;
    const secs = overlapSecs(e, range, now);
    if (secs <= 0) continue;
    const rounded = roundSecs(secs, roundingMin);
    const amount = amountFor(d, e, rounded);
    const [key, label, color] = groupKey(d, e, by);
    let row = groups.get(key);
    if (!row) {
      row = { key, label, color, seconds: 0, roundedSeconds: 0, billableSeconds: 0, amount: 0, entries: 0 };
      groups.set(key, row);
    }
    row.seconds += secs;
    row.roundedSeconds += rounded;
    if (e.billable) row.billableSeconds += rounded;
    row.amount += amount;
    row.entries += 1;
    total += secs;
    totalR += rounded;
    if (e.billable) totalB += rounded;
    totalAmount += amount;
    count += 1;
  }
  const rows = [...groups.values()].sort((a, b) => b.seconds - a.seconds || a.label.localeCompare(b.label));
  for (const r of rows) r.amount = Math.round(r.amount * 100) / 100;
  return {
    rows,
    totalSeconds: total,
    totalRoundedSeconds: totalR,
    totalBillableSeconds: totalB,
    totalAmount: Math.round(totalAmount * 100) / 100,
    entries: count,
  };
}

function weeklyTotals(d: Data, weeks: number, w: WeekStart, f: Filter, roundingMin: number, now: Date): WeekTotal[] {
  const current = weekStartOf(startOfDay(now), w);
  const out: WeekTotal[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = addDays(current, -7 * i);
    const s = summarize(d, { from: start, to: addDays(start, 7) }, 'project', f, roundingMin, now);
    out.push({ weekStart: dateKey(start), seconds: s.totalRoundedSeconds, billableSeconds: s.totalBillableSeconds });
  }
  return out;
}

function budgetUsage(d: Data, p: Project, roundingMin: number, now: Date): BudgetUsage {
  let secs = 0;
  let amount = 0;
  for (const e of d.entries) {
    if (e.projectId !== p.id) continue;
    const r = roundSecs(durationSecs(e, now), roundingMin);
    secs += r;
    amount += amountFor(d, e, r);
  }
  const pct = (used: number, budget: number) => (budget > 0 ? (used / budget) * 100 : null);
  return {
    projectId: p.id,
    usedSeconds: secs,
    usedAmount: Math.round(amount * 100) / 100,
    hoursPct: pct(secs / 3600, p.budgetHours),
    amountPct: pct(amount, p.budgetAmount),
  };
}

// --- CSV (core/csv.rs) ------------------------------------------------------

function csvField(s: string, delim: string): string {
  const needs =
    s.includes(delim) || s.includes('"') || s.includes('\n') || s.includes('\r') || s.startsWith(' ') || s.endsWith(' ');
  return needs ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvLine(fields: string[], delim: string): string {
  return fields.map((f) => csvField(f, delim)).join(delim) + '\r\n';
}

function labels(lang: string) {
  return lang === 'de'
    ? {
        entries: [
          'Datum', 'Start', 'Ende', 'Dauer', 'Stunden', 'Gerundet', 'Stunden gerundet', 'Person', 'Kunde',
          'Projekt', 'Tätigkeit', 'Abrechenbar', 'Satz', 'Betrag', 'Tags', 'Notiz', 'Gesperrt',
        ],
        summaryGroup: ['Projekt', 'Kunde', 'Person', 'Tätigkeit'],
        summaryCols: ['Einträge', 'Dauer', 'Stunden', 'Gerundet', 'Abrechenbar (h)', 'Betrag'],
        total: 'Summe',
        yes: 'ja',
        no: 'nein',
        unassigned: '(ohne Zuordnung)',
      }
    : {
        entries: [
          'Date', 'Start', 'End', 'Duration', 'Hours', 'Rounded', 'Hours rounded', 'Person', 'Client',
          'Project', 'Task', 'Billable', 'Rate', 'Amount', 'Tags', 'Note', 'Locked',
        ],
        summaryGroup: ['Project', 'Client', 'Person', 'Task'],
        summaryCols: ['Entries', 'Duration', 'Hours', 'Rounded', 'Billable (h)', 'Amount'],
        total: 'Total',
        yes: 'yes',
        no: 'no',
        unassigned: '(unassigned)',
      };
}

const fmtHm = (secs: number) => {
  const s = Math.max(0, secs);
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
};
const fmtHours = (secs: number) => (Math.max(0, secs) / 3600).toFixed(2);
const fmtDec = (v: string, lang: string) => (lang === 'de' ? v.replace('.', ',') : v);
const fmtMoney = (v: number, lang: string) => fmtDec(v.toFixed(2), lang);

function entriesCsv(d: Data, entries: Entry[], range: DateRange, roundingMin: number, lang: string, delim: string, simple: boolean, now: Date): string {
  const l = labels(lang);
  const keep = simple ? [0, 1, 2, 3, 4, 5, 6, 9, 14, 15] : Array.from({ length: 17 }, (_, i) => i);
  let out = csvLine(keep.map((i) => l.entries[i]), delim);
  const sorted = entries.slice().sort((a, b) => a.start.localeCompare(b.start));
  for (const e of sorted) {
    if (overlapSecs(e, range, now) <= 0) continue;
    const secs = durationSecs(e, now);
    const rounded = roundSecs(secs, roundingMin);
    const p = project(d, e.projectId);
    const c = p?.clientId ? client(d, p.clientId)?.name ?? '' : '';
    const rate = rateFor(d, e);
    const start = parseIso(e.start);
    const all = [
      start ? dateKey(start) : '',
      fmtTime(e.start),
      fmtTime(e.end),
      fmtHm(secs),
      fmtDec(fmtHours(secs), lang),
      fmtHm(rounded),
      fmtDec(fmtHours(rounded), lang),
      person(d, e.personId)?.name ?? '',
      c,
      p?.name ?? '',
      (e.taskId && task(d, e.taskId)?.name) || '',
      e.billable ? l.yes : l.no,
      rate > 0 ? fmtMoney(rate, lang) : '',
      fmtMoney(amountFor(d, e, rounded), lang),
      e.tags.join(', '),
      e.note,
      e.locked ? l.yes : l.no,
    ];
    out += csvLine(keep.map((i) => all[i]), delim);
  }
  return out;
}

function summaryCsv(s: Summary, by: GroupBy, lang: string, delim: string, simple: boolean): string {
  const l = labels(lang);
  const groupLabel = l.summaryGroup[['project', 'client', 'person', 'task'].indexOf(by)] ?? l.summaryGroup[0];
  const ncols = simple ? 4 : 6;
  let out = csvLine([groupLabel, ...l.summaryCols.slice(0, ncols)], delim);
  const row = (label: string, entries: number, secs: number, rounded: number, billable: number, amount: number) => {
    const r = [label, String(entries), fmtHm(secs), fmtDec(fmtHours(secs), lang), fmtHm(rounded)];
    if (!simple) r.push(fmtDec(fmtHours(billable), lang), fmtMoney(amount, lang));
    return r;
  };
  for (const r of s.rows) {
    out += csvLine(row(r.label || l.unassigned, r.entries, r.seconds, r.roundedSeconds, r.billableSeconds, r.amount), delim);
  }
  out += csvLine(row(l.total, s.entries, s.totalSeconds, s.totalRoundedSeconds, s.totalBillableSeconds, s.totalAmount), delim);
  return out;
}

// --- Team-Paket (core/merge.rs) --------------------------------------------

const PACKAGE_FORMAT = 'timelog-package';
const PACKAGE_VERSION = 1;

interface Package {
  format: string;
  version: number;
  exportedAt: string;
  data: Data;
}

function parsePackage(json: string): Package {
  let p: Package;
  try {
    p = JSON.parse(json) as Package;
  } catch (e) {
    throw msg(`JSON ungültig: ${e}`, `Invalid JSON: ${e}`);
  }
  if (!p || p.format !== PACKAGE_FORMAT) throw msg('Kein timelog-Paket (format)', 'Not a timelog package (format)');
  if (p.version > PACKAGE_VERSION)
    throw msg(`Paketversion ${p.version} ist neuer als diese App`, `Package version ${p.version} is newer than this app`);
  p.data = { ...emptyData, ...(p.data ?? {}) };
  return p;
}

function mergeVec<T extends { id: string; updatedAt: string }>(target: T[], incoming: T[], rep: MergeReport): number {
  let added = 0;
  for (const item of incoming) {
    if (!item.id) continue;
    const i = target.findIndex((t) => t.id === item.id);
    if (i < 0) {
      target.push(JSON.parse(JSON.stringify(item)));
      rep.added += 1;
      added += 1;
    } else if (deepEq(target[i], item)) {
      rep.unchanged += 1;
    } else if (item.updatedAt > target[i].updatedAt) {
      target[i] = JSON.parse(JSON.stringify(item));
      rep.updated += 1;
    } else {
      rep.unchanged += 1;
    }
  }
  return added;
}

function mergeInto(target: Data, incoming: Data): MergeReport {
  const rep: MergeReport = { added: 0, updated: 0, unchanged: 0, entriesAdded: 0 };
  mergeVec(target.persons, incoming.persons ?? [], rep);
  mergeVec(target.clients, incoming.clients ?? [], rep);
  mergeVec(target.projects, incoming.projects ?? [], rep);
  mergeVec(target.tasks, incoming.tasks ?? [], rep);
  rep.entriesAdded = mergeVec(target.entries, incoming.entries ?? [], rep);
  for (const l of incoming.locks ?? []) {
    if (!isWeekLocked(target, l.personId, l.weekStart)) target.locks.push({ ...l });
  }
  return rep;
}

// --- Kommandos --------------------------------------------------------------

const handlers: Record<string, (a: Args) => unknown> = {
  // settings
  get_settings: () => ({ ...settings }),
  set_settings: (a) => {
    settings = { ...defaultSettings(), ...(a.settings as Settings) };
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) {
      throw msg(`Speichern fehlgeschlagen: ${e}`, `Saving failed: ${e}`);
    }
  },

  // data
  get_data: () => JSON.parse(JSON.stringify(data)),
  save_person: (a) => {
    const p = { ...(a.person as Person) };
    if (!p.name.trim()) throw msg('Bitte einen Namen angeben.', 'Please enter a name.');
    return mutate((d) => upsert(d.persons, p));
  },
  delete_person: (a) => {
    const id = a.id as string;
    return mutate((d) => {
      if (d.mePersonId === id) throw msg('Die eigene Person kann nicht gelöscht werden.', 'You cannot delete yourself.');
      if (d.entries.some((e) => e.personId === id))
        throw msg('Diese Person hat Einträge — bitte archivieren statt löschen.', 'This person has entries — archive instead of deleting.');
      d.persons = d.persons.filter((p) => p.id !== id);
      d.locks = d.locks.filter((l) => l.personId !== id);
    });
  },
  save_client: (a) => {
    const c = { ...(a.client as Client) };
    if (!c.name.trim()) throw msg('Bitte einen Namen angeben.', 'Please enter a name.');
    return mutate((d) => upsert(d.clients, c));
  },
  delete_client: (a) => {
    const id = a.id as string;
    return mutate((d) => {
      d.clients = d.clients.filter((c) => c.id !== id);
      const now = nowIso();
      for (const p of d.projects) {
        if (p.clientId === id) {
          p.clientId = null;
          p.updatedAt = now;
        }
      }
    });
  },
  save_project: (a) => {
    const p = { ...(a.project as Project) };
    if (!p.name.trim()) throw msg('Bitte einen Projektnamen angeben.', 'Please enter a project name.');
    return mutate((d) => {
      if (p.clientId !== null && p.clientId !== undefined) {
        if (p.clientId === '') p.clientId = null;
        else if (!client(d, p.clientId)) throw msg('Kunde nicht gefunden.', 'Client not found.');
      } else p.clientId = null;
      upsert(d.projects, p);
    });
  },
  delete_project: (a) => {
    const id = a.id as string;
    return mutate((d) => {
      if (d.entries.some((e) => e.projectId === id))
        throw msg('Dieses Projekt hat Einträge — bitte archivieren statt löschen.', 'This project has entries — archive instead of deleting.');
      d.projects = d.projects.filter((p) => p.id !== id);
      d.tasks = d.tasks.filter((t) => t.projectId !== id);
    });
  },
  save_task: (a) => {
    const t = { ...(a.task as Task) };
    if (!t.name.trim()) throw msg('Bitte einen Namen angeben.', 'Please enter a name.');
    return mutate((d) => {
      if (!project(d, t.projectId)) throw msg('Projekt nicht gefunden.', 'Project not found.');
      upsert(d.tasks, t);
    });
  },
  delete_task: (a) => {
    const id = a.id as string;
    return mutate((d) => {
      d.tasks = d.tasks.filter((t) => t.id !== id);
      const now = nowIso();
      for (const e of d.entries) {
        if (e.taskId === id) {
          e.taskId = null;
          e.updatedAt = now;
        }
      }
    });
  },

  // entries
  save_entry: (a) => {
    const entry = { ...(a.entry as Entry), tags: [...((a.entry as Entry).tags ?? [])] };
    const w = ws();
    return mutate((d) => {
      if (!project(d, entry.projectId)) throw msg('Bitte ein Projekt wählen.', 'Please choose a project.');
      if (!entry.personId || !person(d, entry.personId)) entry.personId = d.mePersonId;
      if (entry.taskId !== null && entry.taskId !== undefined) {
        const t = entry.taskId ? task(d, entry.taskId) : undefined;
        if (!entry.taskId || !t || t.projectId !== entry.projectId) entry.taskId = null;
      } else entry.taskId = null;
      const start = parseIso(entry.start);
      if (!start) throw msg('Ungültige Startzeit.', 'Invalid start time.');
      if (entry.end) {
        const end = parseIso(entry.end);
        if (!end) throw msg('Ungültige Endzeit.', 'Invalid end time.');
        if (end < start) throw msg('Das Ende liegt vor dem Start.', 'End is before start.');
      } else entry.end = null;
      entry.tags = entry.tags.map((t) => t.trim()).filter(Boolean);
      const existing = d.entries.find((e) => e.id === entry.id);
      if (existing && entryLocked(d, existing, w))
        throw msg('Diese Woche ist abgeschlossen — zuerst wieder öffnen.', 'This week is closed — reopen it first.');
      entry.locked = false;
      if (entryLocked(d, entry, w))
        throw msg('Die Zielwoche ist abgeschlossen — zuerst wieder öffnen.', 'The target week is closed — reopen it first.');
      if (!entry.end) {
        const now = nowIso();
        for (const e of d.entries) {
          if (e.id !== entry.id && e.personId === entry.personId && !e.end) {
            e.end = now;
            e.updatedAt = now;
          }
        }
      }
      upsert(d.entries, entry);
    });
  },
  delete_entry: (a) => {
    const id = a.id as string;
    const w = ws();
    return mutate((d) => {
      const e = d.entries.find((x) => x.id === id);
      if (e && entryLocked(d, e, w))
        throw msg('Diese Woche ist abgeschlossen — zuerst wieder öffnen.', 'This week is closed — reopen it first.');
      d.entries = d.entries.filter((x) => x.id !== id);
    });
  },
  start_timer: (a) => {
    const input = a.input as TimerStart;
    const w = ws();
    return mutate((d) => {
      const p = project(d, input.projectId);
      if (!p) throw msg('Bitte ein Projekt wählen.', 'Please choose a project.');
      if (p.archived) throw msg('Das Projekt ist archiviert.', 'The project is archived.');
      const personId = input.personId && person(d, input.personId) ? input.personId : d.mePersonId;
      const t = input.taskId ? task(d, input.taskId) : undefined;
      const tk = t && t.projectId === p.id ? t : undefined;
      const now = nowIso();
      for (const e of d.entries) {
        if (!e.end) {
          e.end = now;
          e.updatedAt = now;
        }
      }
      const entry: Entry = {
        id: newId(),
        personId,
        projectId: p.id,
        taskId: tk?.id ?? null,
        start: now,
        end: null,
        note: (input.note ?? '').trim(),
        billable: tk ? tk.billableDefault : p.billableDefault,
        tags: [],
        locked: false,
        updatedAt: now,
      };
      if (entryLocked(d, entry, w))
        throw msg('Die aktuelle Woche ist abgeschlossen — zuerst wieder öffnen.', 'The current week is closed — reopen it first.');
      d.entries.push(entry);
    });
  },
  stop_timer: () =>
    mutate((d) => {
      const now = nowIso();
      for (const e of d.entries) {
        if (!e.end) {
          e.end = now;
          e.updatedAt = now;
        }
      }
    }),
  running: () => data.entries.find((e) => !e.end) ?? null,

  // reports
  summary: (a) => {
    const range = rangeFrom(a.from as string, a.to as string);
    return summarize(data, range, (a.groupBy as GroupBy) ?? 'project', (a.filter as Filter) ?? {}, rounding(), new Date());
  },
  weekly_totals: (a) => {
    const weeks = Math.min(52, Math.max(1, Number(a.weeks) || 8));
    return weeklyTotals(data, weeks, ws(), (a.filter as Filter) ?? {}, rounding(), new Date());
  },
  budget_usages: () => {
    const now = new Date();
    return data.projects.filter((p) => !p.archived).map((p) => budgetUsage(data, p, rounding(), now));
  },
  export_csv: (a) => {
    const range = rangeFrom(a.from as string, a.to as string);
    const lang = settings.language;
    const delim = lang === 'de' ? ';' : ',';
    const simple = simpleMode();
    const f = (a.filter as Filter) ?? {};
    const now = new Date();
    if (a.kind === 'summary') {
      const by = (a.groupBy as GroupBy) ?? 'project';
      return summaryCsv(summarize(data, range, by, f, rounding(), now), by, lang, delim, simple);
    }
    const refs = data.entries.filter((e) => filterMatches(data, f, e));
    return entriesCsv(data, refs, range, rounding(), lang, delim, simple, now);
  },

  // team package
  export_package: (a) => {
    const out: Data = JSON.parse(JSON.stringify(data));
    const pid = a.personId as string | null | undefined;
    if (pid) {
      out.entries = out.entries.filter((e) => e.personId === pid);
      out.locks = out.locks.filter((l) => l.personId === pid);
      out.persons = out.persons.filter((p) => p.id === pid);
    }
    const pkg: Package = { format: PACKAGE_FORMAT, version: PACKAGE_VERSION, exportedAt: nowIso(), data: out };
    return JSON.stringify(pkg, null, 2);
  },
  import_package: (a) => {
    const pkg = parsePackage(a.json as string);
    let report: MergeReport = { added: 0, updated: 0, unchanged: 0, entriesAdded: 0 };
    const d = mutate((x) => {
      report = mergeInto(x, pkg.data);
    });
    const res: ImportResult = { report, data: d };
    return res;
  },

  // week locks
  lock_week: (a) => {
    const personId = a.personId as string;
    const weekStart = a.weekStart as string;
    const w = ws();
    return mutate((d) => {
      if (!person(d, personId)) throw msg('Person nicht gefunden.', 'Person not found.');
      if (!isWeekLocked(d, personId, weekStart)) {
        const lock: WeekLock = { personId, weekStart };
        d.locks.push(lock);
      }
      const now = nowIso();
      for (const e of d.entries) {
        if (e.personId === personId && entryWeekStart(e, w) === weekStart) {
          if (!e.end) e.end = now;
          e.locked = true;
          e.updatedAt = now;
        }
      }
    });
  },
  unlock_week: (a) => {
    const personId = a.personId as string;
    const weekStart = a.weekStart as string;
    const w = ws();
    return mutate((d) => {
      d.locks = d.locks.filter((l) => !(l.personId === personId && l.weekStart === weekStart));
      const now = nowIso();
      for (const e of d.entries) {
        if (e.personId === personId && e.locked && entryWeekStart(e, w) === weekStart) {
          e.locked = false;
          e.updatedAt = now;
        }
      }
    });
  },

  // files — im Browser übernimmt src/files.ts (Download / Dateiauswahl)
  read_text_file: () => {
    throw msg('Im Browser nicht verfügbar.', 'Not available in the browser.');
  },
  write_text_file: () => {
    throw msg('Im Browser nicht verfügbar.', 'Not available in the browser.');
  },
  write_file: () => {
    throw msg('Im Browser nicht verfügbar.', 'Not available in the browser.');
  },

  // misc
  data_path: () => `localStorage · ${location.host || 'browser'}`,
  check_update: () => null,
  install_update: () => {
    throw msg('Im Browser nicht verfügbar.', 'Not available in the browser.');
  },
};

/** Einstiegspunkt — gleiche Signatur wie Tauris `invoke`. */
export function call(cmd: string, args: Args = {}): Promise<unknown> {
  const h = handlers[cmd];
  if (!h) return Promise.reject(`webapi: unbekanntes Kommando ${cmd}`);
  try {
    return Promise.resolve(h(args));
  } catch (e) {
    return Promise.reject(e);
  }
}
