import { useEffect, useState } from 'react';
import { Data, Filter, GroupBy, Lang, Settings, Summary, api } from '../api';
import { saveBinaryFile, saveTextFile } from '../files';
import { Dict } from '../i18n';
import { IconDownload, IconFile } from '../icons';
import { buildReportPdf } from '../pdf';
import { dateKey, durationSecs, entriesInRange, fmtDate, fmtHM, fmtHours, fmtMoney, fmtTime, roundSecs, toIso } from '../util';
import { RangeBar, useRange } from './RangeBar';

export function Reports({
  data,
  settings,
  t,
  lang,
  personFilter,
  projectFilter,
  now,
  onToast,
  onFail,
}: {
  data: Data;
  settings: Settings;
  t: Dict;
  lang: Lang;
  personFilter: string | null;
  projectFilter: string | null;
  now: Date;
  onToast: (msg: string) => void;
  onFail: (e: unknown) => void;
}) {
  const expert = settings.mode === 'expert';
  const r = useRange(settings.weekStart, 'week');
  const [groupBy, setGroupBy] = useState<GroupBy>('project');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [details, setDetails] = useState(false);
  const filter: Filter = {
    personId: expert ? personFilter : data.mePersonId,
    projectId: projectFilter,
  };
  const from = toIso(r.range.from);
  const to = toIso(r.range.to);
  const gb: GroupBy = expert ? groupBy : 'project';

  useEffect(() => {
    api
      .summary(from, to, gb, filter)
      .then(setSummary)
      .catch(onFail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, from, to, gb, filter.personId, filter.projectId, settings.rounding]);

  const groups: [GroupBy, string][] = expert
    ? [
        ['project', t.byProject],
        ['client', t.byClient],
        ['person', t.byPerson],
        ['task', t.byTask],
      ]
    : [['project', t.byProject]];

  const stamp = `${dateKey(r.range.from)}_${dateKey(new Date(r.range.to.getTime() - 1))}`;

  const exportCsv = async (kind: 'entries' | 'summary') => {
    try {
      const csv = await api.exportCsv(from, to, kind, gb, filter);
      if (await saveTextFile(`timelog_${kind}_${stamp}.csv`, csv, { name: 'CSV', extensions: ['csv'] }, 'text/csv'))
        onToast(t.csvSaved);
    } catch (e) {
      onFail(e);
    }
  };

  const detailEntries = entriesInRange(
    data.entries.filter(
      (e) => (!filter.personId || e.personId === filter.personId) && (!filter.projectId || e.projectId === filter.projectId)
    ),
    r.range,
    now
  ).sort((a, b) => a.start.localeCompare(b.start));

  const exportPdf = async () => {
    if (!summary) return;
    try {
      const { bytes, suggestedName } = buildReportPdf({
        summary,
        groupBy: gb,
        rangeLabel: r.label(lang, t),
        entries: detailEntries,
        data,
        settings,
        t,
        lang,
        now,
      });
      if (await saveBinaryFile(suggestedName, bytes, { name: 'PDF', extensions: ['pdf'] }, 'application/pdf')) onToast(t.pdfSaved);
    } catch (e) {
      onFail(e);
    }
  };

  const max = summary ? Math.max(1, ...summary.rows.map((x) => x.roundedSeconds)) : 1;
  const showAmount = expert && summary && summary.totalAmount > 0;

  return (
    <div className="view">
      <div className="viewbar">
        <h1>{t.reports}</h1>
        <RangeBar r={r} t={t} lang={lang} />
        {expert && (
          <span className="seg" style={{ marginLeft: 8 }}>
            {groups.map(([g, label]) => (
              <button key={g} className={gb === g ? 'active' : ''} onClick={() => setGroupBy(g)}>
                {label}
              </button>
            ))}
          </span>
        )}
        <span className="exports">
          <button onClick={() => exportCsv('entries')} title={t.exportCsvEntries}>
            <IconDownload size={12} /> {t.exportCsvEntries}
          </button>
          <button onClick={() => exportCsv('summary')} title={t.exportCsvSummary}>
            <IconDownload size={12} /> {t.exportCsvSummary}
          </button>
          {expert && (
            <button className="primary" onClick={exportPdf} disabled={!summary}>
              <IconFile size={12} /> {t.exportPdf}
            </button>
          )}
        </span>
      </div>
      <div className="viewbody">
        {summary && summary.rows.length === 0 && <div className="empty">{t.noData}</div>}
        {summary && summary.rows.length > 0 && (
          <div className="tablewrap">
          <table className="rtable">
            <thead>
              <tr>
                <th>{groups.find(([g]) => g === gb)?.[1]}</th>
                <th className="num">{t.colEntries}</th>
                <th className="num">{t.colDuration}</th>
                <th className="num">{t.hours}</th>
                {settings.rounding > 0 && <th className="num">{t.colRounded}</th>}
                {expert && <th className="num">{t.colBillableHours}</th>}
                {showAmount && <th className="num">{t.colAmount}</th>}
              </tr>
            </thead>
            <tbody>
              {summary.rows.map((row) => (
                <tr key={row.key || '_'}>
                  <td>
                    <div className="lbl">
                      {row.color && <span className="swatch" style={{ background: row.color }} />}
                      {row.label || t.unassigned}
                    </div>
                    <div className="bar" style={{ width: `${Math.max(2, (row.roundedSeconds / max) * 100)}%` }} />
                  </td>
                  <td className="num">{row.entries}</td>
                  <td className="num">{fmtHM(row.seconds)}</td>
                  <td className="num">{fmtHours(row.roundedSeconds, lang)}</td>
                  {settings.rounding > 0 && <td className="num">{fmtHM(row.roundedSeconds)}</td>}
                  {expert && <td className="num">{fmtHM(row.billableSeconds)}</td>}
                  {showAmount && <td className="num">{fmtMoney(row.amount, lang)}</td>}
                </tr>
              ))}
              <tr className="total">
                <td>{t.total}</td>
                <td className="num">{summary.entries}</td>
                <td className="num">{fmtHM(summary.totalSeconds)}</td>
                <td className="num">{fmtHours(summary.totalRoundedSeconds, lang)}</td>
                {settings.rounding > 0 && <td className="num">{fmtHM(summary.totalRoundedSeconds)}</td>}
                {expert && <td className="num">{fmtHM(summary.totalBillableSeconds)}</td>}
                {showAmount && <td className="num">{fmtMoney(summary.totalAmount, lang)}</td>}
              </tr>
            </tbody>
          </table>
          </div>
        )}

        {summary && summary.rows.length > 0 && (
          <div className="btnrow" style={{ justifyContent: 'flex-start' }}>
            <button className="ghost" onClick={() => setDetails(!details)}>
              {details ? t.hideDetails : t.showDetails}
            </button>
          </div>
        )}
        {details && (
          <div className="tablewrap">
          <table className="rtable detail">
            <thead>
              <tr>
                <th>{t.colDate}</th>
                <th>{t.colFrom}</th>
                <th>{t.colTo}</th>
                {expert && <th>{t.colPerson}</th>}
                <th>{t.colProject}</th>
                {expert && <th>{t.colTask}</th>}
                <th>{t.colNote}</th>
                <th className="num">{t.colDuration}</th>
              </tr>
            </thead>
            <tbody>
              {detailEntries.map((e) => (
                <tr key={e.id}>
                  <td>{fmtDate(new Date(e.start), lang)}</td>
                  <td>{fmtTime(e.start)}</td>
                  <td>{e.end ? fmtTime(e.end) : t.timerRunning}</td>
                  {expert && <td>{data.persons.find((p) => p.id === e.personId)?.name ?? ''}</td>}
                  <td>{data.projects.find((p) => p.id === e.projectId)?.name ?? ''}</td>
                  {expert && <td>{(e.taskId && data.tasks.find((x) => x.id === e.taskId)?.name) || ''}</td>}
                  <td>{e.note}</td>
                  <td className="num">{fmtHM(roundSecs(durationSecs(e, now), settings.rounding))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  );
}
