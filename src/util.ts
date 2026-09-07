// Datums- und Zeithelfer: Speicherung in UTC (RFC 3339), Anzeige lokal.
import { Entry, Lang, WeekStart } from './api';

export interface DateRange {
  from: Date;
  to: Date;
}

export const DAY = 86_400_000;

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function addMonths(d: Date, n: number): Date {
  const x = new Date(d.getFullYear(), d.getMonth() + n, 1);
  return x;
}

export function weekStartOf(d: Date, ws: WeekStart): Date {
  const day = startOfDay(d);
  const wd = day.getDay(); // 0 = Sonntag
  const offset = ws === 'sunday' ? wd : (wd + 6) % 7;
  return addDays(day, -offset);
}

export function rangeDay(d: Date): DateRange {
  const from = startOfDay(d);
  return { from, to: addDays(from, 1) };
}

export function rangeWeek(d: Date, ws: WeekStart): DateRange {
  const from = weekStartOf(d, ws);
  return { from, to: addDays(from, 7) };
}

export function rangeMonth(d: Date): DateRange {
  const from = new Date(d.getFullYear(), d.getMonth(), 1);
  return { from, to: new Date(d.getFullYear(), d.getMonth() + 1, 1) };
}

/** YYYY-MM-DD lokal. */
export function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function toIso(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function fromIso(s: string): Date {
  return new Date(s);
}

/** Lokale Uhrzeit "HH:MM" eines ISO-Zeitpunkts. */
export function fmtTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** "HH:MM" (lokal) auf einen Tag setzen → neuer Date. Ungültig → null. */
export function withTime(day: Date, hhmm: string): Date | null {
  const m = /^(\d{1,2})[:.]?(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  const x = startOfDay(day);
  x.setHours(h, min, 0, 0);
  return x;
}

export function durationSecs(e: Entry, now = new Date()): number {
  const s = new Date(e.start).getTime();
  const en = e.end ? new Date(e.end).getTime() : now.getTime();
  if (Number.isNaN(s) || Number.isNaN(en)) return 0;
  return Math.max(0, Math.floor((en - s) / 1000));
}

export function roundSecs(secs: number, roundingMin: number): number {
  if (roundingMin <= 0 || secs <= 0) return Math.max(0, secs);
  const unit = roundingMin * 60;
  const r = Math.floor((secs + unit / 2) / unit) * unit;
  return r === 0 ? unit : r;
}

/** h:mm */
export function fmtHM(secs: number): string {
  const s = Math.max(0, Math.round(secs));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}

/** h:mm:ss */
export function fmtHMS(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/** Vorzeichenbehaftet, z. B. "−2:30" / "+0:45". */
export function fmtSignedHM(secs: number): string {
  const sign = secs < 0 ? '−' : '+';
  return `${sign}${fmtHM(Math.abs(secs))}`;
}

export function fmtHours(secs: number, lang: Lang): string {
  const v = (Math.max(0, secs) / 3600).toFixed(2);
  return lang === 'de' ? v.replace('.', ',') : v;
}

export function fmtMoney(v: number, lang: Lang): string {
  return new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-GB', {
    style: 'currency',
    currency: 'EUR',
  }).format(v);
}

export function fmtDate(d: Date, lang: Lang, opts?: Intl.DateTimeFormatOptions): string {
  return d.toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-GB', opts ?? { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function fmtDayLong(d: Date, lang: Lang): string {
  return d.toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-GB', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function fmtDayShort(d: Date, lang: Lang): string {
  return d.toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
  });
}

export function fmtRange(r: DateRange, lang: Lang): string {
  const last = addDays(r.to, -1);
  if (dateKey(r.from) === dateKey(last)) return fmtDate(r.from, lang);
  return `${fmtDate(r.from, lang)} – ${fmtDate(last, lang)}`;
}

/** ISO-Kalenderwoche (Montag-basiert). */
export function isoWeek(d: Date): number {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = x.getUTCDay() || 7;
  x.setUTCDate(x.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(x.getUTCFullYear(), 0, 1));
  return Math.ceil(((x.getTime() - yearStart.getTime()) / DAY + 1) / 7);
}

export function isSameDay(a: Date, b: Date): boolean {
  return dateKey(a) === dateKey(b);
}

/** Einträge, die (auch teilweise) in den Zeitraum fallen — laufende bis jetzt. */
export function entriesInRange(entries: Entry[], r: DateRange, now = new Date()): Entry[] {
  const from = r.from.getTime();
  const to = r.to.getTime();
  return entries.filter((e) => {
    const s = new Date(e.start).getTime();
    const en = e.end ? new Date(e.end).getTime() : now.getTime();
    return en > from && s < to;
  });
}

/** Sekunden eines Eintrags innerhalb eines Zeitraums. */
export function overlapSecs(e: Entry, r: DateRange, now = new Date()): number {
  const s = Math.max(new Date(e.start).getTime(), r.from.getTime());
  const en = Math.min(e.end ? new Date(e.end).getTime() : now.getTime(), r.to.getTime());
  return Math.max(0, Math.floor((en - s) / 1000));
}

export const PALETTE = [
  '#38bdf8',
  '#34d399',
  '#a78bfa',
  '#fbbf24',
  '#f87171',
  '#fb923c',
  '#22d3ee',
  '#e879f9',
  '#84cc16',
  '#f472b6',
];

export function nextColor(used: string[]): string {
  const free = PALETTE.find((c) => !used.includes(c));
  return free ?? PALETTE[used.length % PALETTE.length];
}
