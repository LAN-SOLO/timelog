import { useMemo, useState } from 'react';
import { Lang, WeekStart } from '../api';
import { Dict } from '../i18n';
import { IconChevronLeft, IconChevronRight } from '../icons';
import {
  DateRange,
  addDays,
  addMonths,
  dateKey,
  fmtRange,
  isoWeek,
  parseDateKey,
  rangeDay,
  rangeMonth,
  rangeWeek,
  startOfDay,
} from '../util';

export type RangeKind = 'today' | 'week' | 'month' | 'custom';

export interface RangeState {
  kind: RangeKind;
  setKind: (k: RangeKind) => void;
  anchor: Date;
  shift: (n: number) => void;
  reset: () => void;
  customFrom: string;
  customTo: string;
  setCustomFrom: (v: string) => void;
  setCustomTo: (v: string) => void;
  range: DateRange;
  label: (lang: Lang, t: Dict) => string;
}

export function useRange(ws: WeekStart, initial: RangeKind = 'week'): RangeState {
  const [kind, setKind] = useState<RangeKind>(initial);
  const [anchor, setAnchor] = useState<Date>(() => startOfDay(new Date()));
  const [customFrom, setCustomFrom] = useState(() => dateKey(addDays(new Date(), -30)));
  const [customTo, setCustomTo] = useState(() => dateKey(new Date()));

  const range = useMemo<DateRange>(() => {
    switch (kind) {
      case 'today':
        return rangeDay(anchor);
      case 'week':
        return rangeWeek(anchor, ws);
      case 'month':
        return rangeMonth(anchor);
      default: {
        const from = parseDateKey(customFrom);
        const to = addDays(parseDateKey(customTo), 1);
        return to > from ? { from, to } : { from, to: addDays(from, 1) };
      }
    }
  }, [kind, anchor, ws, customFrom, customTo]);

  const shift = (n: number) => {
    if (kind === 'today') setAnchor((a) => addDays(a, n));
    else if (kind === 'week') setAnchor((a) => addDays(a, 7 * n));
    else if (kind === 'month') setAnchor((a) => addMonths(a, n));
  };

  const label = (lang: Lang, t: Dict) => {
    if (kind === 'week') return `${t.weekLabel(isoWeek(range.from))} · ${fmtRange(range, lang)}`;
    if (kind === 'month')
      return range.from.toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-GB', { month: 'long', year: 'numeric' });
    return fmtRange(range, lang);
  };

  return {
    kind,
    setKind,
    anchor,
    shift,
    reset: () => setAnchor(startOfDay(new Date())),
    customFrom,
    customTo,
    setCustomFrom,
    setCustomTo,
    range,
    label,
  };
}

export function RangeBar({ r, t, lang }: { r: RangeState; t: Dict; lang: Lang }) {
  const kinds: [RangeKind, string][] = [
    ['today', t.rangeToday],
    ['week', t.rangeWeek],
    ['month', t.rangeMonth],
    ['custom', t.rangeCustom],
  ];
  return (
    <>
      <span className="seg">
        {kinds.map(([k, label]) => (
          <button key={k} className={r.kind === k ? 'active' : ''} onClick={() => r.setKind(k)}>
            {label}
          </button>
        ))}
      </span>
      {r.kind !== 'custom' ? (
        <>
          <button className="icon" onClick={() => r.shift(-1)} title="←">
            <IconChevronLeft size={12} />
          </button>
          <button className="icon" onClick={() => r.shift(1)} title="→">
            <IconChevronRight size={12} />
          </button>
          <button className="ghost" onClick={r.reset}>
            {t.today}
          </button>
          <span className="sub">{r.label(lang, t)}</span>
        </>
      ) : (
        <>
          <span className="sub">{t.rangeFrom}</span>
          <input type="date" value={r.customFrom} onChange={(e) => r.setCustomFrom(e.target.value)} />
          <span className="sub">{t.rangeTo}</span>
          <input type="date" value={r.customTo} onChange={(e) => r.setCustomTo(e.target.value)} />
        </>
      )}
    </>
  );
}
