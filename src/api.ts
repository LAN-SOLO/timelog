// timelog — Vertrag zwischen Frontend und Tauri-Backend.
// Jede `invoke`-Signatur hier ist verbindlich: das Rust-Backend implementiert
// exakt diese Kommando-Namen und (camelCase-)Argumente, die DTOs werden mit
// `#[serde(rename_all = "camelCase")]` serialisiert.
import { invoke } from '@tauri-apps/api/core';

/** Läuft die Oberfläche in der Tauri-App? Sonst: Webapp im Browser (src/webapi.ts). */
export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

type WebCall = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
let webCall: WebCall | null = null;

/** Kommando ausführen — in der App über Tauri, im Browser über das lokale Web-Backend. */
async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauri) return invoke<T>(cmd, args);
  if (!webCall) webCall = (await import('./webapi')).call;
  return webCall(cmd, args) as Promise<T>;
}

export type Mode = 'simple' | 'expert';
export type Lang = 'de' | 'en';
export type GroupBy = 'project' | 'client' | 'person' | 'task';
export type WeekStart = 'monday' | 'sunday';

export interface Person {
  id: string;
  name: string;
  email: string;
  /** Soll-Stunden pro Woche (0 = kein Soll). */
  weeklyHours: number;
  /** Stundensatz in Euro (0 = keiner). */
  hourlyRate: number;
  color: string;
  archived: boolean;
  updatedAt: string;
}

export interface Client {
  id: string;
  name: string;
  archived: boolean;
  updatedAt: string;
}

export interface Project {
  id: string;
  clientId: string | null;
  name: string;
  color: string;
  budgetHours: number;
  budgetAmount: number;
  hourlyRate: number;
  billableDefault: boolean;
  archived: boolean;
  updatedAt: string;
}

export interface Task {
  id: string;
  projectId: string;
  name: string;
  billableDefault: boolean;
  archived: boolean;
  updatedAt: string;
}

export interface Entry {
  id: string;
  personId: string;
  projectId: string;
  taskId: string | null;
  /** RFC 3339 (UTC). */
  start: string;
  /** RFC 3339 (UTC); null = Timer läuft. */
  end: string | null;
  note: string;
  billable: boolean;
  tags: string[];
  locked: boolean;
  updatedAt: string;
}

export interface WeekLock {
  personId: string;
  /** YYYY-MM-DD des ersten Wochentags (lokal). */
  weekStart: string;
}

export interface Data {
  mePersonId: string;
  persons: Person[];
  clients: Client[];
  projects: Project[];
  tasks: Task[];
  entries: Entry[];
  locks: WeekLock[];
}

export interface Settings {
  language: Lang;
  mode: Mode;
  theme: string;
  accent: string;
  autoUpdate: boolean;
  /** 0 | 5 | 15 Minuten — nur Anzeige/Export. */
  rounding: number;
  weekStart: WeekStart;
  weeklyHours: number;
  companyName: string;
  idleMinutes: number;
  endOfDayHour: number;
  confirmDelete: boolean;
}

export interface Filter {
  personId?: string | null;
  projectId?: string | null;
  clientId?: string | null;
}

export interface SummaryRow {
  key: string;
  label: string;
  color: string | null;
  seconds: number;
  roundedSeconds: number;
  billableSeconds: number;
  amount: number;
  entries: number;
}

export interface Summary {
  rows: SummaryRow[];
  totalSeconds: number;
  totalRoundedSeconds: number;
  totalBillableSeconds: number;
  totalAmount: number;
  entries: number;
}

export interface WeekTotal {
  weekStart: string;
  seconds: number;
  billableSeconds: number;
}

export interface BudgetUsage {
  projectId: string;
  usedSeconds: number;
  usedAmount: number;
  hoursPct: number | null;
  amountPct: number | null;
}

export interface MergeReport {
  added: number;
  updated: number;
  unchanged: number;
  entriesAdded: number;
}

export interface ImportResult {
  report: MergeReport;
  data: Data;
}

export interface TimerStart {
  projectId: string;
  taskId: string | null;
  note: string;
  personId: string | null;
}

export interface UpdateInfo {
  version: string;
  notes: string | null;
  date: string | null;
}

export const api = {
  // --- settings ---
  getSettings: () => call<Settings>('get_settings'),
  setSettings: (settings: Settings) => call<void>('set_settings', { settings }),

  // --- data ---
  getData: () => call<Data>('get_data'),
  savePerson: (person: Person) => call<Data>('save_person', { person }),
  deletePerson: (id: string) => call<Data>('delete_person', { id }),
  saveClient: (client: Client) => call<Data>('save_client', { client }),
  deleteClient: (id: string) => call<Data>('delete_client', { id }),
  saveProject: (project: Project) => call<Data>('save_project', { project }),
  deleteProject: (id: string) => call<Data>('delete_project', { id }),
  saveTask: (task: Task) => call<Data>('save_task', { task }),
  deleteTask: (id: string) => call<Data>('delete_task', { id }),
  /** Upsert: leere `id` = neuer Eintrag. Prüft Sperren und Zeiten. */
  saveEntry: (entry: Entry) => call<Data>('save_entry', { entry }),
  deleteEntry: (id: string) => call<Data>('delete_entry', { id }),

  // --- timer ---
  startTimer: (input: TimerStart) => call<Data>('start_timer', { input }),
  stopTimer: () => call<Data>('stop_timer'),
  running: () => call<Entry | null>('running'),

  // --- reports ---
  summary: (from: string, to: string, groupBy: GroupBy, filter: Filter) =>
    call<Summary>('summary', { from, to, groupBy, filter }),
  weeklyTotals: (weeks: number, filter: Filter) => call<WeekTotal[]>('weekly_totals', { weeks, filter }),
  budgetUsages: () => call<BudgetUsage[]>('budget_usages'),
  /** CSV-Text; `kind` = "entries" | "summary". */
  exportCsv: (from: string, to: string, kind: 'entries' | 'summary', groupBy: GroupBy, filter: Filter) =>
    call<string>('export_csv', { from, to, kind, groupBy, filter }),

  // --- team package ---
  exportPackage: (personId: string | null) => call<string>('export_package', { personId }),
  importPackage: (json: string) => call<ImportResult>('import_package', { json }),
  lockWeek: (personId: string, weekStart: string) => call<Data>('lock_week', { personId, weekStart }),
  unlockWeek: (personId: string, weekStart: string) => call<Data>('unlock_week', { personId, weekStart }),

  // --- files ---
  readTextFile: (path: string) => call<string>('read_text_file', { path }),
  writeTextFile: (path: string, content: string) => call<void>('write_text_file', { path, content }),
  writeFile: (path: string, dataBase64: string) => call<void>('write_file', { path, dataBase64 }),

  // --- misc ---
  dataPath: () => call<string>('data_path'),
  checkUpdate: () => call<UpdateInfo | null>('check_update'),
  installUpdate: () => call<void>('install_update'),
};

export const emptyData: Data = {
  mePersonId: '',
  persons: [],
  clients: [],
  projects: [],
  tasks: [],
  entries: [],
  locks: [],
};

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}
