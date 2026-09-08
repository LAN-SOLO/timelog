import { useCallback, useEffect, useRef, useState } from 'react';
import { Data, Entry, Project, Settings, UpdateInfo, api, emptyData } from './api';
import { dicts, Lang } from './i18n';
import { Dashboard } from './components/Dashboard';
import { EntryList } from './components/EntryList';
import { Help } from './components/Help';
import { ProjectModal } from './components/ProjectModal';
import { Reports } from './components/Reports';
import { SettingsModal } from './components/SettingsModal';
import { Sidebar, TabBar, View } from './components/Sidebar';
import { Team } from './components/Team';
import { IconGear, IconPlay, IconStop } from './icons';
import { addDays, durationSecs, fmtHM, fmtHMS, fmtTime, startOfDay, toIso } from './util';

type ProjectEdit = { kind: 'new' } | { kind: 'edit'; project: Project };

/** Bestätigungsdialog (window.confirm ist im WebView nicht verlässlich). */
function ConfirmModal({
  text,
  okLabel,
  cancelLabel,
  onOk,
  onClose,
}: {
  text: string;
  okLabel: string;
  cancelLabel: string;
  onOk: () => void;
  onClose: () => void;
}) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="note" style={{ marginTop: 0, fontSize: 12.5, color: 'var(--text)' }}>
          {text}
        </div>
        <div className="btnrow">
          <button className="ghost" onClick={onClose} autoFocus>
            {cancelLabel}
          </button>
          <button className="primary" onClick={onOk}>
            {okLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [settingsBackup, setSettingsBackup] = useState<Settings | null>(null);
  const [data, setData] = useState<Data>(emptyData);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState<View>('today');
  const [anchor, setAnchor] = useState<Date>(() => startOfDay(new Date()));
  const [personFilter, setPersonFilter] = useState<string | null>(null);
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [projectEdit, setProjectEdit] = useState<ProjectEdit | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [confirm, setConfirm] = useState<{ text: string } | null>(null);
  const [helpSignal, setHelpSignal] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [updateAvail, setUpdateAvail] = useState<UpdateInfo | null>(null);
  const [installing, setInstalling] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [timerProject, setTimerProject] = useState('');
  const [timerNote, setTimerNote] = useState('');
  const [idlePrompt, setIdlePrompt] = useState<{ since: Date; lastActivity: Date } | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const lastActivity = useRef<number>(Date.now());
  const remindedDay = useRef<string>('');

  const lang: Lang = settings?.language ?? 'de';
  const t = dicts[lang];
  const expert = settings?.mode === 'expert';
  const running: Entry | undefined = data.entries.find((e) => !e.end);

  const showToast = useCallback((msg: string, isError = false) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), isError ? 6000 : 2200);
  }, []);
  const fail = useCallback((e: unknown) => showToast(String(e), true), [showToast]);

  // Bestätigung als Promise — window.confirm ist im WebView nicht verlässlich.
  const confirmResolve = useRef<((ok: boolean) => void) | null>(null);
  const onConfirm = useCallback(
    (text: string) =>
      new Promise<boolean>((resolve) => {
        confirmResolve.current = resolve;
        setConfirm({ text });
      }),
    []
  );
  const settleConfirm = (ok: boolean) => {
    setConfirm(null);
    confirmResolve.current?.(ok);
    confirmResolve.current = null;
  };

  // --- Laden -------------------------------------------------------------
  useEffect(() => {
    api.getSettings().then((s) => {
      setSettings(s);
      api
        .checkUpdate()
        .then((u) => {
          if (!u) return;
          setUpdateAvail(u);
          if (s.autoUpdate) {
            setInstalling(true);
            api.installUpdate().catch(() => setInstalling(false));
          }
        })
        .catch(() => {});
    });
    api
      .getData()
      .then((d) => {
        setData(d);
        setLoaded(true);
      })
      .catch(fail);
  }, [fail]);

  // Darstellung aus den Einstellungen auf <html> spiegeln
  useEffect(() => {
    if (!settings) return;
    document.documentElement.setAttribute('data-theme', settings.theme);
    document.documentElement.setAttribute('data-accent', settings.accent);
  }, [settings?.theme, settings?.accent, settings]);

  // Uhr: jede Sekunde bei laufendem Timer, sonst jede Minute
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), running ? 1000 : 60_000);
    return () => window.clearInterval(id);
  }, [running]);

  // Aktivität für Leerlauf-Erkennung
  useEffect(() => {
    const mark = () => {
      lastActivity.current = Date.now();
    };
    window.addEventListener('mousemove', mark);
    window.addEventListener('keydown', mark);
    window.addEventListener('mousedown', mark);
    window.addEventListener('touchstart', mark, { passive: true });
    window.addEventListener('scroll', mark, { passive: true, capture: true });
    return () => {
      window.removeEventListener('mousemove', mark);
      window.removeEventListener('keydown', mark);
      window.removeEventListener('mousedown', mark);
      window.removeEventListener('touchstart', mark);
      window.removeEventListener('scroll', mark, { capture: true });
    };
  }, []);

  // Leerlauf & Feierabend prüfen
  useEffect(() => {
    if (!settings || !running || idlePrompt) return;
    const idleMs = settings.idleMinutes * 60_000;
    if (idleMs > 0 && Date.now() - lastActivity.current > idleMs) {
      setIdlePrompt({ since: new Date(running.start), lastActivity: new Date(lastActivity.current) });
      return;
    }
    if (expert && settings.endOfDayHour > 0) {
      const key = now.toDateString();
      if (now.getHours() >= settings.endOfDayHour && remindedDay.current !== key) {
        remindedDay.current = key;
        showToast(t.endOfDayReminder(fmtHM(durationSecs(running, now))), true);
      }
    }
  }, [now, settings, running, idlePrompt, expert, showToast, t]);

  // Projekt-Vorauswahl für den Timer
  useEffect(() => {
    if (timerProject && data.projects.some((p) => p.id === timerProject && !p.archived)) return;
    const last = data.entries
      .filter((e) => e.personId === data.mePersonId)
      .sort((a, b) => b.start.localeCompare(a.start))[0];
    const cand =
      (last && data.projects.find((p) => p.id === last.projectId && !p.archived)) ||
      data.projects.find((p) => !p.archived);
    setTimerProject(cand?.id ?? '');
  }, [data, timerProject]);

  // Ansicht zurücksetzen, wenn Expertenansichten im einfachen Modus wegfallen
  useEffect(() => {
    if (!expert && (view === 'dashboard' || view === 'team')) setView('today');
    if (!expert) setPersonFilter(null);
  }, [expert, view]);

  // --- Aktionen ------------------------------------------------------------
  const startTimer = useCallback(
    (projectId?: string) => {
      const pid = projectId || timerProject;
      if (!pid) {
        fail(t.noProjects);
        return;
      }
      api
        .startTimer({ projectId: pid, taskId: null, note: timerNote.trim(), personId: null })
        .then((d) => {
          setData(d);
          setTimerNote('');
        })
        .catch(fail);
    },
    [timerProject, timerNote, fail, t]
  );
  const stopTimer = useCallback(() => api.stopTimer().then(setData).catch(fail), [fail]);

  const saveSettings = (s: Settings) => {
    api
      .setSettings(s)
      .then(() => {
        setSettings(s);
        setSettingsBackup(null);
        setShowSettings(false);
      })
      .catch(fail);
  };

  const setMode = (mode: Settings['mode']) => {
    if (!settings) return;
    saveSettings({ ...settings, mode });
  };

  const saveProject = async (p: Project, clientName: string) => {
    try {
      let d = data;
      let clientId: string | null = null;
      if (clientName) {
        const existing = d.clients.find((c) => c.name.toLowerCase() === clientName.toLowerCase());
        if (existing) clientId = existing.id;
        else {
          d = await api.saveClient({ id: '', name: clientName, archived: false, updatedAt: '' });
          clientId = d.clients.find((c) => c.name === clientName)?.id ?? null;
        }
      }
      d = await api.saveProject({ ...p, clientId });
      setData(d);
      setProjectEdit(null);
    } catch (e) {
      fail(e);
    }
  };

  const deleteProject = async (p: Project) => {
    if (!(await onConfirm(t.confirmDeleteProject(p.name)))) return;
    api
      .deleteProject(p.id)
      .then((d) => {
        setData(d);
        setProjectEdit(null);
        if (projectFilter === p.id) setProjectFilter(null);
      })
      .catch(fail);
  };

  // --- Tastaturkürzel (Experte) ------------------------------------------
  useEffect(() => {
    if (!expert) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (showSettings || projectEdit || confirm || idlePrompt) {
        if (e.key === 'Escape') {
          setShowSettings(false);
          setProjectEdit(null);
          if (confirm) settleConfirm(false);
        }
        return;
      }
      if (e.key === 'Escape' && drawerOpen) {
        setDrawerOpen(false);
        return;
      }
      switch (e.key) {
        case 's':
          running ? stopTimer() : startTimer();
          break;
        case 'n':
          if (view === 'today' || view === 'week') {
            const btn = document.querySelector<HTMLButtonElement>('.viewbar button.primary');
            btn?.click();
          }
          break;
        case 'ArrowLeft':
          if (view === 'today') setAnchor((a) => addDays(a, -1));
          else if (view === 'week') setAnchor((a) => addDays(a, -7));
          else document.querySelector<HTMLButtonElement>('.viewbar button[title="←"]')?.click();
          break;
        case 'ArrowRight':
          if (view === 'today') setAnchor((a) => addDays(a, 1));
          else if (view === 'week') setAnchor((a) => addDays(a, 7));
          else document.querySelector<HTMLButtonElement>('.viewbar button[title="→"]')?.click();
          break;
        case '1':
          setView('today');
          break;
        case '2':
          setView('week');
          break;
        case '3':
          setView('reports');
          break;
        case '4':
          setView('dashboard');
          break;
        case '5':
          setView('team');
          break;
        case '?':
          setHelpSignal((n) => n + 1);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expert, view, running, startTimer, stopTimer, showSettings, projectEdit, confirm, idlePrompt, drawerOpen]);

  if (!settings) return null;

  const runningProject = running ? data.projects.find((p) => p.id === running.projectId) : null;
  const activeProjects = data.projects.filter((p) => !p.archived);
  const activePersons = data.persons.filter((p) => !p.archived);

  return (
    <div className="app">
      <header className="header">
        <span className="brand">
          <span className="name">timelog</span>
          <span className="dot">.</span>
        </span>
        <span className="tagline">{t.tagline}</span>

        <div className="timer">
          {running ? (
            <>
              <span className="clock">{fmtHMS(durationSecs(running, now))}</span>
              <span className="tproj">
                <span className="swatch" style={{ background: runningProject?.color ?? 'var(--border)' }} />
                <span className="tname">{runningProject?.name ?? '—'}</span>
              </span>
              {running.note && <span className="tnote">// {running.note}</span>}
              <span className="dim" style={{ fontSize: 11 }}>
                {fmtTime(running.start)}
              </span>
              <button className="primary" onClick={stopTimer}>
                <IconStop size={12} /> {t.timerStop}
              </button>
            </>
          ) : (
            <>
              <select value={timerProject} onChange={(e) => setTimerProject(e.target.value)} disabled={activeProjects.length === 0}>
                {activeProjects.length === 0 && <option value="">{t.timerNoProject}</option>}
                {activeProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={timerNote}
                placeholder={t.timerNotePlaceholder}
                onChange={(e) => setTimerNote(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && startTimer()}
              />
              <button className="primary" onClick={() => startTimer()} disabled={!timerProject}>
                <IconPlay size={12} /> {t.timerStart}
              </button>
            </>
          )}
        </div>

        {expert && activePersons.length > 1 && (
          <select
            value={personFilter ?? ''}
            onChange={(e) => setPersonFilter(e.target.value || null)}
            className="personfilter"
          >
            <option value="">{t.personFilterAll}</option>
            {activePersons.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}

        <span className="seg" title={t.mode}>
          <button className={!expert ? 'active' : ''} onClick={() => setMode('simple')}>
            {t.modeSimple}
          </button>
          <button className={expert ? 'active' : ''} onClick={() => setMode('expert')}>
            {t.modeExpert}
          </button>
        </span>
        {expert && <span className="badge">{t.trackedBadge}</span>}
        <button className="ghost icon hdr-help" title={t.help} onClick={() => setHelpSignal((n) => n + 1)}>
          ?
        </button>
        <button
          className="ghost icon"
          title={t.settings}
          onClick={() => {
            setSettingsBackup(settings);
            setShowSettings(true);
          }}
        >
          <IconGear size={14} />
        </button>
      </header>

      <div className="main">
        <Sidebar
          data={data}
          t={t}
          expert={expert}
          view={view}
          onView={setView}
          projectFilter={projectFilter}
          onProjectFilter={setProjectFilter}
          onNewProject={() => setProjectEdit({ kind: 'new' })}
          onEditProject={(p) => setProjectEdit({ kind: 'edit', project: p })}
          showArchived={showArchived}
          onToggleArchived={() => setShowArchived(!showArchived)}
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
        />

        {loaded && data.projects.length === 0 && (view === 'today' || view === 'week') ? (
          <div className="view">
            <div className="onboard">
              <h2>{t.onboardTitle}</h2>
              <p>{t.onboardText}</p>
              <button className="primary" onClick={() => setProjectEdit({ kind: 'new' })}>
                {t.newProject}
              </button>
            </div>
          </div>
        ) : (
          <>
            {(view === 'today' || view === 'week') && (
              <EntryList
                mode={view}
                data={data}
                settings={settings}
                t={t}
                lang={lang}
                anchor={anchor}
                onAnchor={setAnchor}
                personFilter={personFilter}
                projectFilter={projectFilter}
                now={now}
                onData={setData}
                onFail={fail}
                onConfirm={onConfirm}
              />
            )}
            {view === 'reports' && (
              <Reports
                data={data}
                settings={settings}
                t={t}
                lang={lang}
                personFilter={personFilter}
                projectFilter={projectFilter}
                now={now}
                onToast={showToast}
                onFail={fail}
              />
            )}
            {view === 'dashboard' && expert && (
              <Dashboard data={data} settings={settings} t={t} lang={lang} personFilter={personFilter} onFail={fail} />
            )}
            {view === 'team' && expert && (
              <Team
                data={data}
                settings={settings}
                t={t}
                lang={lang}
                onData={setData}
                onToast={showToast}
                onFail={fail}
                onConfirm={onConfirm}
              />
            )}
          </>
        )}
      </div>

      <TabBar
        t={t}
        expert={expert}
        view={view}
        onView={(v) => {
          setView(v);
          setDrawerOpen(false);
        }}
        projectFilter={projectFilter}
        projectColor={data.projects.find((p) => p.id === projectFilter)?.color ?? null}
        onProjects={() => setDrawerOpen((o) => !o)}
        drawerOpen={drawerOpen}
      />

      {projectEdit && (
        <ProjectModal
          project={projectEdit.kind === 'edit' ? projectEdit.project : null}
          data={data}
          t={t}
          expert={expert}
          onSave={saveProject}
          onDelete={deleteProject}
          onClose={() => setProjectEdit(null)}
        />
      )}

      {showSettings && (
        <SettingsModal
          settings={settings}
          t={t}
          onClose={() => {
            if (settingsBackup) setSettings(settingsBackup);
            setSettingsBackup(null);
            setShowSettings(false);
          }}
          onSave={saveSettings}
          onLive={(s) => setSettings(s)}
          onData={setData}
          onToast={showToast}
          onFail={fail}
        />
      )}

      {confirm && (
        <ConfirmModal
          text={confirm.text}
          okLabel={t.ok}
          cancelLabel={t.cancel}
          onOk={() => settleConfirm(true)}
          onClose={() => settleConfirm(false)}
        />
      )}

      {idlePrompt && running && (
        <div className="overlay">
          <div className="modal idle">
            <h2>{t.idleTitle}</h2>
            <div className="note" style={{ color: 'var(--text)', fontSize: 12.5 }}>
              {t.idleText(Math.round((Date.now() - idlePrompt.lastActivity.getTime()) / 60_000), fmtTime(idlePrompt.since.toISOString()))}
            </div>
            <div className="btnrow">
              <button
                className="primary"
                onClick={() => {
                  lastActivity.current = Date.now();
                  setIdlePrompt(null);
                }}
              >
                {t.idleKeep}
              </button>
              <button
                onClick={() => {
                  setIdlePrompt(null);
                  stopTimer();
                }}
              >
                {t.idleStopNow}
              </button>
              <button
                onClick={() => {
                  const end = idlePrompt.lastActivity > idlePrompt.since ? idlePrompt.lastActivity : new Date();
                  setIdlePrompt(null);
                  api.saveEntry({ ...running, end: toIso(end) }).then(setData).catch(fail);
                }}
              >
                {t.idleStopAtLast}
              </button>
            </div>
          </div>
        </div>
      )}

      {updateAvail && (
        <div className="upd-banner">
          <span>
            {t.updateBanner} <strong>{updateAvail.version}</strong>
          </span>
          <button
            className="primary"
            disabled={installing}
            onClick={() => {
              setInstalling(true);
              api.installUpdate().catch(() => setInstalling(false));
            }}
          >
            {installing ? t.updateInstalling : t.updateInstall}
          </button>
          <button className="ghost" onClick={() => setUpdateAvail(null)}>
            {t.updateLater}
          </button>
        </div>
      )}

      <Help lang={lang} openSignal={helpSignal} />
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
