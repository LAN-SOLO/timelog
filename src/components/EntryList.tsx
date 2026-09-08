import { useMemo, useState } from 'react';
import { Data, Entry, Lang, Settings, api } from '../api';
import { Dict } from '../i18n';
import {
  IconChevronLeft,
  IconChevronRight,
  IconCopy,
  IconLock,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconUnlock,
} from '../icons';
import {
  addDays,
  dateKey,
  durationSecs,
  fmtDate,
  fmtDayLong,
  fmtHM,
  fmtRange,
  fmtSignedHM,
  fmtTime,
  isoWeek,
  overlapSecs,
  rangeDay,
  rangeWeek,
  roundSecs,
  startOfDay,
  toIso,
  weekStartOf,
  withTime,
} from '../util';

export function EntryList({
  mode,
  data,
  settings,
  t,
  lang,
  anchor,
  onAnchor,
  personFilter,
  projectFilter,
  now,
  onData,
  onFail,
  onConfirm,
}: {
  mode: 'today' | 'week';
  data: Data;
  settings: Settings;
  t: Dict;
  lang: Lang;
  anchor: Date;
  onAnchor: (d: Date) => void;
  personFilter: string | null;
  projectFilter: string | null;
  now: Date;
  onData: (d: Data) => void;
  onFail: (e: unknown) => void;
  onConfirm: (msg: string) => Promise<boolean>;
}) {
  const expert = settings.mode === 'expert';
  const ws = settings.weekStart;
  const range = mode === 'today' ? rangeDay(anchor) : rangeWeek(anchor, ws);
  const personId = personFilter ?? data.mePersonId;
  const weekKey = dateKey(weekStartOf(anchor, ws));
  const weekLocked = data.locks.some((l) => l.personId === personId && l.weekStart === weekKey);

  const entries = useMemo(() => {
    const from = range.from.getTime();
    const to = range.to.getTime();
    return data.entries
      .filter((e) => {
        if (expert ? personFilter && e.personId !== personFilter : e.personId !== data.mePersonId) return false;
        if (projectFilter && e.projectId !== projectFilter) return false;
        const s = new Date(e.start).getTime();
        return s >= from && s < to;
      })
      .sort((a, b) => a.start.localeCompare(b.start));
  }, [data, range.from, range.to, personFilter, projectFilter, expert]);

  const days: Date[] = [];
  if (mode === 'today') days.push(startOfDay(anchor));
  else for (let i = 0; i < 7; i++) days.push(addDays(range.from, i));

  const byDay = new Map<string, Entry[]>();
  for (const e of entries) {
    const k = dateKey(new Date(e.start));
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k)!.push(e);
  }

  const daySecs = (list: Entry[]) => list.reduce((a, e) => a + roundSecs(durationSecs(e, now), settings.rounding), 0);
  const weekEntries = mode === 'week' ? entries : [];
  const weekTotal = weekEntries.reduce((a, e) => a + roundSecs(overlapSecs(e, range, now), settings.rounding), 0);
  const person = data.persons.find((p) => p.id === personId);
  const target = expert && person && person.weeklyHours > 0 ? person.weeklyHours : settings.weeklyHours;

  const save = (e: Entry) => api.saveEntry(e).then(onData).catch(onFail);

  const addEntry = (day: Date) => {
    const proj =
      (projectFilter && data.projects.find((p) => p.id === projectFilter && !p.archived)) ||
      lastProject(data, personId) ||
      data.projects.find((p) => !p.archived);
    if (!proj) {
      onFail(t.noProjects);
      return;
    }
    const list = byDay.get(dateKey(day)) ?? [];
    const lastEnd = list.filter((e) => e.end).map((e) => new Date(e.end!)).sort((a, b) => b.getTime() - a.getTime())[0];
    let start = lastEnd ?? withTime(day, '09:00')!;
    if (dateKey(start) !== dateKey(day)) start = withTime(day, '09:00')!;
    const end = new Date(start.getTime() + 3600_000);
    save({
      id: '',
      personId,
      projectId: proj.id,
      taskId: null,
      start: toIso(start),
      end: toIso(end),
      note: '',
      billable: proj.billableDefault,
      tags: [],
      locked: false,
      updatedAt: '',
    });
  };

  const duplicate = (e: Entry) => {
    const end = e.end ?? toIso(now);
    save({ ...e, id: '', end, locked: false });
  };

  const restart = (e: Entry) =>
    api
      .startTimer({ projectId: e.projectId, taskId: e.taskId, note: e.note, personId: e.personId })
      .then(onData)
      .catch(onFail);

  const remove = async (e: Entry) => {
    if (settings.confirmDelete && !(await onConfirm(t.confirmDeleteEntry))) return;
    api.deleteEntry(e.id).then(onData).catch(onFail);
  };

  const toggleLock = async () => {
    if (weekLocked) {
      api.unlockWeek(personId, weekKey).then(onData).catch(onFail);
    } else {
      if (!(await onConfirm(t.confirmLockWeek(person?.name ?? '', fmtDate(range.from, lang))))) return;
      api.lockWeek(personId, weekKey).then(onData).catch(onFail);
    }
  };

  const shift = (n: number) => onAnchor(addDays(anchor, mode === 'today' ? n : 7 * n));
  const todayKey = dateKey(now);

  return (
    <div className="view">
      <div className="viewbar">
        <h1>{mode === 'today' ? t.viewToday : t.viewWeek}</h1>
        <button className="icon" onClick={() => shift(-1)} title={mode === 'today' ? t.prevDay : t.prevWeek}>
          <IconChevronLeft size={12} />
        </button>
        <button className="icon" onClick={() => shift(1)} title={mode === 'today' ? t.nextDay : t.nextWeek}>
          <IconChevronRight size={12} />
        </button>
        <button className="ghost" onClick={() => onAnchor(startOfDay(now))}>
          {mode === 'today' ? t.today : t.thisWeek}
        </button>
        <span className="sub">
          {mode === 'today' ? fmtDayLong(anchor, lang) : `${t.weekLabel(isoWeek(range.from))} · ${fmtRange(range, lang)}`}
        </span>
        <span className="spacer" />
        {expert && mode === 'week' && (
          <button className={weekLocked ? 'active' : ''} onClick={toggleLock}>
            {weekLocked ? <IconUnlock size={12} /> : <IconLock size={12} />}
            {weekLocked ? t.unlockWeek : t.lockWeek}
          </button>
        )}
        <button className="primary" disabled={weekLocked} onClick={() => addEntry(mode === 'today' ? anchor : now >= range.from && now < range.to ? startOfDay(now) : range.from)}>
          <IconPlus size={12} /> {t.addEntry.replace('+ ', '')}
        </button>
      </div>
      <div className="viewbody">
        {weekLocked && <div className="note">{t.weekLockedHint}</div>}
        {days.map((day) => {
          const k = dateKey(day);
          const list = byDay.get(k) ?? [];
          if (mode === 'week' && list.length === 0 && day > now) return null;
          return (
            <div key={k}>
              <div className={`dayhead ${k === todayKey ? 'today' : ''}`}>
                <span>{fmtDayLong(day, lang)}</span>
                {!weekLocked && (
                  <button className="ghost" onClick={() => addEntry(day)} title={t.addEntry}>
                    <IconPlus size={10} />
                  </button>
                )}
                <span className="sum">
                  {t.dayTotal} {fmtHM(daySecs(list))}
                </span>
              </div>
              {list.length === 0 && mode === 'today' && <div className="empty">{t.noEntries}</div>}
              {list.map((e) => (
                <EntryRow
                  key={e.id}
                  e={e}
                  data={data}
                  t={t}
                  expert={expert}
                  now={now}
                  rounding={settings.rounding}
                  locked={e.locked || weekLocked}
                  showPerson={expert && !personFilter}
                  onSave={save}
                  onDuplicate={() => duplicate(e)}
                  onRestart={() => restart(e)}
                  onDelete={() => remove(e)}
                  onFail={onFail}
                />
              ))}
            </div>
          );
        })}
        {mode === 'week' && (
          <div className="weekfoot">
            <span>
              {t.weekTotal} <strong>{fmtHM(weekTotal)}</strong>
            </span>
            {target > 0 && (
              <>
                <span>
                  {t.target} <strong>{fmtHM(target * 3600)}</strong>
                </span>
                <span>
                  {t.balance}{' '}
                  <strong className={weekTotal - target * 3600 >= 0 ? 'pos' : 'neg'}>
                    {fmtSignedHM(weekTotal - target * 3600)}
                  </strong>
                </span>
              </>
            )}
            <span className="dim">
              {entries.length} {t.entries}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function lastProject(data: Data, personId: string) {
  const last = data.entries
    .filter((e) => e.personId === personId)
    .sort((a, b) => b.start.localeCompare(a.start))[0];
  const p = last && data.projects.find((x) => x.id === last.projectId);
  return p && !p.archived ? p : null;
}

function EntryRow({
  e,
  data,
  t,
  expert,
  now,
  rounding,
  locked,
  showPerson,
  onSave,
  onDuplicate,
  onRestart,
  onDelete,
  onFail,
}: {
  e: Entry;
  data: Data;
  t: Dict;
  expert: boolean;
  now: Date;
  rounding: number;
  locked: boolean;
  showPerson: boolean;
  onSave: (e: Entry) => void;
  onDuplicate: () => void;
  onRestart: () => void;
  onDelete: () => void;
  onFail: (e: unknown) => void;
}) {
  const [from, setFrom] = useState(fmtTime(e.start));
  const [to, setTo] = useState(fmtTime(e.end));
  const [note, setNote] = useState(e.note);
  const [prevKey, setPrevKey] = useState(e.updatedAt);
  if (e.updatedAt !== prevKey) {
    setPrevKey(e.updatedAt);
    setFrom(fmtTime(e.start));
    setTo(fmtTime(e.end));
    setNote(e.note);
  }

  const project = data.projects.find((p) => p.id === e.projectId);
  const tasks = data.tasks.filter((x) => x.projectId === e.projectId && (!x.archived || x.id === e.taskId));
  const running = !e.end;
  const secs = durationSecs(e, now);
  const day = new Date(e.start);

  const commitFrom = () => {
    if (from === fmtTime(e.start)) return;
    const d = withTime(day, from);
    if (!d) {
      setFrom(fmtTime(e.start));
      onFail(t.entryInvalidTime);
      return;
    }
    onSave({ ...e, start: toIso(d) });
  };
  const commitTo = () => {
    if (to === fmtTime(e.end)) return;
    if (!to.trim()) {
      setTo(fmtTime(e.end));
      return;
    }
    let d = withTime(day, to);
    if (!d) {
      setTo(fmtTime(e.end));
      onFail(t.entryInvalidTime);
      return;
    }
    // Ende vor Start → Eintrag geht über Mitternacht
    if (d < new Date(e.start)) d = addDays(d, 1);
    onSave({ ...e, end: toIso(d) });
  };
  const commitNote = () => {
    if (note !== e.note) onSave({ ...e, note });
  };
  const onKey = (commit: () => void) => (ev: React.KeyboardEvent<HTMLInputElement>) => {
    if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur();
    if (ev.key === 'Escape') {
      setFrom(fmtTime(e.start));
      setTo(fmtTime(e.end));
      setNote(e.note);
      (ev.target as HTMLInputElement).blur();
    }
    void commit;
  };

  const projectOptions = data.projects.filter((p) => !p.archived || p.id === e.projectId);
  const personName = showPerson ? data.persons.find((p) => p.id === e.personId)?.name : null;

  return (
    <div className={`erow ${expert ? 'expert' : ''} ${locked ? 'locked' : ''} ${running ? 'running' : ''}`}>
      <span className="swatch" style={{ background: project?.color ?? 'var(--border)' }} />
      <select
        className="c-proj"
        value={e.projectId}
        disabled={locked}
        title={personName ? `${personName}` : undefined}
        onChange={(ev) => {
          const p = data.projects.find((x) => x.id === ev.target.value);
          onSave({ ...e, projectId: ev.target.value, taskId: null, billable: p ? p.billableDefault : e.billable });
        }}
      >
        {projectOptions.map((p) => (
          <option key={p.id} value={p.id}>
            {personName ? `${p.name} · ${personName}` : p.name}
          </option>
        ))}
      </select>
      {expert && (
        <select
          className="c-task"
          value={e.taskId ?? ''}
          disabled={locked || tasks.length === 0}
          onChange={(ev) => {
            const task = data.tasks.find((x) => x.id === ev.target.value);
            onSave({ ...e, taskId: ev.target.value || null, billable: task ? task.billableDefault : e.billable });
          }}
        >
          <option value="">{t.noTask}</option>
          {tasks.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      )}
      <input
        type="text"
        className="time c-from"
        value={from}
        disabled={locked}
        onChange={(ev) => setFrom(ev.target.value)}
        onBlur={commitFrom}
        onKeyDown={onKey(commitFrom)}
      />
      <input
        type="text"
        className="time c-to"
        value={to}
        placeholder={running ? t.timerRunning : ''}
        disabled={locked}
        onChange={(ev) => setTo(ev.target.value)}
        onBlur={commitTo}
        onKeyDown={onKey(commitTo)}
      />
      <span className={`dur ${running ? 'live' : ''}`} title={fmtHM(secs)}>
        {fmtHM(roundSecs(secs, rounding))}
      </span>
      <input
        type="text"
        className="c-note"
        value={note}
        placeholder={t.colNote}
        disabled={locked}
        onChange={(ev) => setNote(ev.target.value)}
        onBlur={commitNote}
        onKeyDown={onKey(commitNote)}
      />
      {expert && (
        <input
          type="checkbox"
          className="c-bill"
          title={t.colBillableHours}
          checked={e.billable}
          disabled={locked}
          onChange={(ev) => onSave({ ...e, billable: ev.target.checked })}
        />
      )}
      <span className="acts">
        {locked ? (
          <span className="lockmark" title={t.locked}>
            <IconLock size={12} />
          </span>
        ) : (
          <>
            <button title={t.duplicate} onClick={onDuplicate}>
              <IconCopy size={12} />
            </button>
            {!running && (
              <button title={t.restart} onClick={onRestart}>
                <IconRefresh size={12} />
              </button>
            )}
            <button className="danger" title={t.delete} onClick={onDelete}>
              <IconTrash size={12} />
            </button>
          </>
        )}
      </span>
    </div>
  );
}
