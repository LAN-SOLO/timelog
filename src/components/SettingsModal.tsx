import { useEffect, useState } from 'react';
import { Data, Settings, UpdateInfo, api, isTauri } from '../api';
import { openTextFile, saveTextFile } from '../files';
import { Dict } from '../i18n';
import { dateKey } from '../util';

export const APP_VERSION = '0.2.0';

type SetTab = 'general' | 'tracking' | 'reports' | 'app';

export function SettingsModal({
  settings,
  t,
  onClose,
  onSave,
  onLive,
  onData,
  onToast,
  onFail,
}: {
  settings: Settings;
  t: Dict;
  onClose: () => void;
  onSave: (s: Settings) => void;
  onLive: (s: Settings) => void;
  onData: (d: Data) => void;
  onToast: (msg: string) => void;
  onFail: (e: unknown) => void;
}) {
  const [tab, setTab] = useState<SetTab>('general');
  const [s, setS] = useState<Settings>({ ...settings });
  const [updState, setUpdState] = useState<'idle' | 'checking' | 'none' | 'error'>('idle');
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [installing, setInstalling] = useState(false);
  const [dataPath, setDataPath] = useState('');

  useEffect(() => {
    api.dataPath().then(setDataPath).catch(() => {});
  }, []);

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setS((prev) => {
      const next = { ...prev, [key]: value };
      onLive(next);
      return next;
    });

  const checkUpdates = () => {
    setUpdState('checking');
    setUpdate(null);
    api
      .checkUpdate()
      .then((u) => {
        if (u) {
          setUpdate(u);
          setUpdState('idle');
        } else setUpdState('none');
      })
      .catch(() => setUpdState('error'));
  };

  // Web-Version: Sicherung der Browser-Daten als Paket (gleiches Format wie „Team“).
  const exportData = async () => {
    try {
      const json = await api.exportPackage(null);
      if (await saveTextFile(`timelog_all_${dateKey(new Date())}.json`, json, { name: 'JSON', extensions: ['json'] }, 'application/json'))
        onToast(t.packageSaved);
    } catch (e) {
      onFail(e);
    }
  };
  const importData = async () => {
    try {
      const json = await openTextFile({ name: 'JSON', extensions: ['json'] });
      if (json === null) return;
      const res = await api.importPackage(json);
      onData(res.data);
      onToast(t.importResult(res.report));
    } catch (e) {
      onFail(e);
    }
  };

  const expert = s.mode === 'expert';
  const tabs: [SetTab, string][] = [
    ['general', t.setGeneral],
    ['tracking', t.setTracking],
    ['reports', t.setReports],
    ['app', t.setApp],
  ];
  const num = (v: string, max: number) => Math.max(0, Math.min(max, Number(v.replace(',', '.')) || 0));

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal settings" onClick={(e) => e.stopPropagation()}>
        <h2>{t.settings}</h2>
        <div className="set-tabs">
          {tabs.map(([id, label]) => (
            <button key={id} className={`chip ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>

        {tab === 'general' && (
          <>
            <div className="row2">
              <label className="field grow1">
                <span>{t.language}</span>
                <select value={s.language} onChange={(e) => set('language', e.target.value as Settings['language'])}>
                  <option value="de">Deutsch</option>
                  <option value="en">English</option>
                </select>
              </label>
              <label className="field grow1">
                <span>
                  {t.mode}
                  {expert && <span className="badge">{t.trackedBadge}</span>}
                </span>
                <select value={s.mode} onChange={(e) => set('mode', e.target.value as Settings['mode'])}>
                  <option value="simple">{t.modeSimple}</option>
                  <option value="expert">{`${t.modeExpert} · ${t.trackedBadge}`}</option>
                </select>
              </label>
            </div>
            <div className="note">{t.modeHint}</div>
            <div className="note">{t.trackedHint}</div>
            <div className="row2">
              <label className="field grow1">
                <span>{t.theme}</span>
                <select value={s.theme} onChange={(e) => set('theme', e.target.value)}>
                  <option value="dark">{t.themeDark}</option>
                  <option value="light">{t.themeLight}</option>
                </select>
              </label>
              <label className="field grow1">
                <span>{t.accent}</span>
                <select value={s.accent} onChange={(e) => set('accent', e.target.value)}>
                  <option value="blue">{t.accentBlue}</option>
                  <option value="emerald">{t.accentEmerald}</option>
                  <option value="violet">{t.accentViolet}</option>
                  <option value="amber">{t.accentAmber}</option>
                </select>
              </label>
            </div>
          </>
        )}

        {tab === 'tracking' && (
          <>
            <div className="row2">
              <label className="field grow1">
                <span>{t.rounding}</span>
                <select value={s.rounding} onChange={(e) => set('rounding', Number(e.target.value))}>
                  <option value={0}>{t.roundingNone}</option>
                  <option value={5}>{t.roundingMin(5)}</option>
                  <option value={15}>{t.roundingMin(15)}</option>
                </select>
              </label>
              <label className="field grow1">
                <span>{t.weekStart}</span>
                <select value={s.weekStart} onChange={(e) => set('weekStart', e.target.value as Settings['weekStart'])}>
                  <option value="monday">{t.monday}</option>
                  <option value="sunday">{t.sunday}</option>
                </select>
              </label>
            </div>
            <div className="note">{t.roundingHint}</div>
            <div className="row2">
              <label className="field grow1">
                <span>{t.weeklyHoursSetting}</span>
                <input
                  type="text"
                  value={s.weeklyHours || ''}
                  onChange={(e) => set('weeklyHours', num(e.target.value, 168))}
                />
              </label>
              <label className="field grow1">
                <span>{t.idleMinutes}</span>
                <input
                  type="number"
                  min={0}
                  max={240}
                  value={s.idleMinutes}
                  onChange={(e) => set('idleMinutes', num(e.target.value, 240))}
                />
              </label>
            </div>
            <div className="note">{t.idleHint}</div>
            {expert && (
              <label className="field">
                <span>{t.endOfDayHour}</span>
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={s.endOfDayHour}
                  onChange={(e) => set('endOfDayHour', num(e.target.value, 23))}
                />
              </label>
            )}
            <label className="check">
              <input type="checkbox" checked={s.confirmDelete} onChange={(e) => set('confirmDelete', e.target.checked)} />
              {t.confirmDeleteSetting}
            </label>
          </>
        )}

        {tab === 'reports' && (
          <label className="field">
            <span>{t.companyName}</span>
            <input type="text" value={s.companyName} onChange={(e) => set('companyName', e.target.value)} />
          </label>
        )}

        {tab === 'app' && (
          <>
            <div className="fieldlabel">{t.updates}</div>
            {isTauri && (
              <label className="check">
                <input type="checkbox" checked={s.autoUpdate} onChange={(e) => set('autoUpdate', e.target.checked)} />
                {t.autoUpdate}
              </label>
            )}
            <div className="updatebox">
              <span>
                {t.version} {APP_VERSION}
              </span>
              {!isTauri && <span className="dim">{t.webUpdatesNote}</span>}
              {isTauri && (
                <>
                  <button onClick={checkUpdates} disabled={updState === 'checking'}>
                    {updState === 'checking' ? t.checking : t.checkUpdates}
                  </button>
                  {updState === 'none' && <span>{t.upToDate}</span>}
                  {updState === 'error' && <span style={{ color: 'var(--red)' }}>{t.updateError}</span>}
                  {update && (
                    <>
                      <span>
                        {t.updateAvailable} <strong>{update.version}</strong>
                      </span>
                      <button
                        className="primary"
                        disabled={installing}
                        onClick={() => {
                          setInstalling(true);
                          api.installUpdate().catch(() => setInstalling(false));
                        }}
                      >
                        {installing ? t.updateInstalling : t.installUpdate}
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
            <div className="sep" />
            <div className="fieldlabel">{isTauri ? t.dataPath : t.dataStorage}</div>
            <div className="note" style={{ userSelect: 'text', WebkitUserSelect: 'text' }}>
              {dataPath}
            </div>
            <div className="note">{isTauri ? t.privacyNote : t.webStorageNote}</div>
            {!isTauri && (
              <div className="btnrow" style={{ justifyContent: 'flex-start', marginTop: 8 }}>
                <button onClick={exportData}>{t.exportData}</button>
                <button onClick={importData}>{t.importData}</button>
              </div>
            )}
            {expert && (
              <>
                <div className="fieldlabel">{t.shortcuts}</div>
                <div className="note">{t.shortcutHint}</div>
              </>
            )}
          </>
        )}

        <div className="btnrow">
          <button className="ghost" onClick={onClose}>
            {t.cancel}
          </button>
          <button className="primary" onClick={() => onSave(s)}>
            {t.saveSettings}
          </button>
        </div>
      </div>
    </div>
  );
}
