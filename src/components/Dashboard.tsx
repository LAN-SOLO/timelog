import { useEffect, useState } from 'react';
import { BudgetUsage, Data, Filter, Lang, Settings, Summary, WeekTotal, api } from '../api';
import { Dict } from '../i18n';
import { DAY, fmtHM, fmtHours, fmtMoney, isoWeek, parseDateKey, toIso } from '../util';
import { RangeBar, useRange } from './RangeBar';

export function Dashboard({
  data,
  settings,
  t,
  lang,
  personFilter,
  onFail,
}: {
  data: Data;
  settings: Settings;
  t: Dict;
  lang: Lang;
  personFilter: string | null;
  onFail: (e: unknown) => void;
}) {
  const r = useRange(settings.weekStart, 'month');
  const [byProject, setByProject] = useState<Summary | null>(null);
  const [byPerson, setByPerson] = useState<Summary | null>(null);
  const [budgets, setBudgets] = useState<BudgetUsage[]>([]);
  const [trend, setTrend] = useState<WeekTotal[]>([]);
  const filter: Filter = { personId: personFilter };
  const from = toIso(r.range.from);
  const to = toIso(r.range.to);

  useEffect(() => {
    Promise.all([
      api.summary(from, to, 'project', filter),
      api.summary(from, to, 'person', filter),
      api.budgetUsages(),
      api.weeklyTotals(8, filter),
    ])
      .then(([p, pe, b, tr]) => {
        setByProject(p);
        setByPerson(pe);
        setBudgets(b);
        setTrend(tr);
      })
      .catch(onFail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, from, to, personFilter, settings.rounding]);

  const total = byProject?.totalRoundedSeconds ?? 0;
  const billable = byProject?.totalBillableSeconds ?? 0;
  const pct = total > 0 ? Math.round((billable / total) * 100) : 0;
  const activeProjects = byProject?.rows.filter((x) => x.seconds > 0).length ?? 0;
  const persons = byPerson?.rows.filter((x) => x.seconds > 0).length ?? 0;
  const maxProject = Math.max(1, ...(byProject?.rows.map((x) => x.roundedSeconds) ?? [1]));
  const rangeWeeks = (r.range.to.getTime() - r.range.from.getTime()) / DAY / 7;
  const maxTrend = Math.max(1, ...trend.map((w) => w.seconds));
  const withBudget = budgets
    .map((b) => ({ b, p: data.projects.find((x) => x.id === b.projectId)! }))
    .filter(({ b, p }) => p && (b.hoursPct !== null || b.amountPct !== null))
    .sort((a, b) => Math.max(a.b.hoursPct ?? 0, a.b.amountPct ?? 0) < Math.max(b.b.hoursPct ?? 0, b.b.amountPct ?? 0) ? 1 : -1);

  const cls = (p: number) => (p >= 100 ? 'bad' : p >= 80 ? 'warn' : 'ok');

  return (
    <div className="view">
      <div className="viewbar">
        <h1>{t.dashboard}</h1>
        <RangeBar r={r} t={t} lang={lang} />
      </div>
      <div className="viewbody">
        <div className="kpis">
          <div className="kpi">
            <div className="k">{t.kpiHours}</div>
            <div className="v">{fmtHM(total)}</div>
            <div className="s">{fmtHours(total, lang)} h</div>
          </div>
          <div className="kpi">
            <div className="k">{t.kpiBillable}</div>
            <div className="v">{pct} %</div>
            <div className="s">{fmtHM(billable)}</div>
          </div>
          <div className="kpi">
            <div className="k">{t.kpiProjects}</div>
            <div className="v">{activeProjects}</div>
            <div className="s">{data.projects.filter((p) => !p.archived).length} {t.projects.toLowerCase()}</div>
          </div>
          <div className="kpi">
            <div className="k">{t.kpiPersons}</div>
            <div className="v">{persons}</div>
            <div className="s">{data.persons.filter((p) => !p.archived).length} {t.persons.toLowerCase()}</div>
          </div>
        </div>

        <div className="panels">
          <div className="panel">
            <h3>{t.hoursPerProject}</h3>
            {byProject && byProject.rows.length === 0 && <div className="note">{t.noData}</div>}
            {byProject?.rows.map((row) => (
              <div key={row.key || '_'} className="hbar">
                <span className="n">
                  <span className="swatch" style={{ background: row.color ?? 'var(--border)' }} />
                  {row.label || t.unassigned}
                </span>
                <span className="track">
                  <span className="fill" style={{ width: `${(row.roundedSeconds / maxProject) * 100}%`, background: row.color ?? undefined }} />
                </span>
                <span className="val">{fmtHM(row.roundedSeconds)}</span>
              </div>
            ))}
          </div>

          <div className="panel">
            <h3>{t.hoursPerPerson}</h3>
            {byPerson && byPerson.rows.length === 0 && <div className="note">{t.noData}</div>}
            {byPerson?.rows.map((row) => {
              const person = data.persons.find((p) => p.id === row.key);
              const targetSecs = person && person.weeklyHours > 0 ? person.weeklyHours * 3600 * rangeWeeks : 0;
              const ratio = targetSecs > 0 ? row.roundedSeconds / targetSecs : 0;
              return (
                <div key={row.key || '_'} className="hbar">
                  <span className="n">
                    <span className="swatch" style={{ background: row.color ?? 'var(--border)' }} />
                    {row.label || t.unassigned}
                  </span>
                  <span className="track">
                    {targetSecs > 0 ? (
                      <>
                        <span className={`fill ${ratio >= 1 ? 'ok' : ratio >= 0.8 ? 'warn' : 'bad'}`} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
                      </>
                    ) : (
                      <span className="fill" style={{ width: `${(row.roundedSeconds / Math.max(1, byPerson!.totalRoundedSeconds)) * 100}%` }} />
                    )}
                  </span>
                  <span className="val">
                    {fmtHM(row.roundedSeconds)}
                    {targetSecs > 0 && <small> / {fmtHM(targetSecs)}</small>}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="panel">
            <h3>{t.budgets}</h3>
            {withBudget.length === 0 && <div className="note">{t.noBudgets}</div>}
            {withBudget.map(({ b, p }) => {
              const usePct = b.hoursPct ?? b.amountPct ?? 0;
              const isHours = b.hoursPct !== null;
              return (
                <div key={p.id} className="hbar">
                  <span className="n">
                    <span className="swatch" style={{ background: p.color }} />
                    {p.name}
                  </span>
                  <span className="track">
                    <span className={`fill ${cls(usePct)}`} style={{ width: `${Math.min(100, usePct)}%` }} />
                  </span>
                  <span className="val" title={isHours ? t.ofHours(String(p.budgetHours)) : t.ofAmount(fmtMoney(p.budgetAmount, lang))}>
                    {t.budgetUsed(usePct)}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="panel">
            <h3>{t.trend8}</h3>
            <div className="cols">
              {trend.map((w) => {
                const nb = w.seconds - w.billableSeconds;
                return (
                  <div key={w.weekStart} className="col">
                    <span className="v">{w.seconds > 0 ? fmtHM(w.seconds) : ''}</span>
                    <div className="stack">
                      <div className="b nb first" style={{ height: `${(nb / maxTrend) * 100}%` }} />
                      <div className="b" style={{ height: `${(w.billableSeconds / maxTrend) * 100}%`, borderRadius: nb > 0 ? 0 : undefined }} />
                    </div>
                    <span className="lab">{t.weekLabel(isoWeek(parseDateKey(w.weekStart)))}</span>
                  </div>
                );
              })}
            </div>
            <div className="legend">
              <span>
                <i /> {t.kpiBillable}
              </span>
              <span>
                <i className="nb" /> {t.billableVsNot.split(' / ')[1]}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
