import { useState } from 'react';
import { Client, Data, Lang, Person, Settings, Task, api } from '../api';
import { openTextFile, saveTextFile } from '../files';
import { Dict } from '../i18n';
import { IconArchive, IconChevronLeft, IconChevronRight, IconDownload, IconEdit, IconLock, IconPlus, IconTrash, IconUnlock, IconUpload } from '../icons';
import { PALETTE, addDays, dateKey, fmtDate, fmtRange, isoWeek, nextColor, parseDateKey, startOfDay, weekStartOf } from '../util';

export function Team({
  data,
  settings,
  t,
  lang,
  onData,
  onToast,
  onFail,
  onConfirm,
}: {
  data: Data;
  settings: Settings;
  t: Dict;
  lang: Lang;
  onData: (d: Data) => void;
  onToast: (msg: string) => void;
  onFail: (e: unknown) => void;
  onConfirm: (msg: string) => Promise<boolean>;
}) {
  const [personEdit, setPersonEdit] = useState<Person | null>(null);
  const [clientEdit, setClientEdit] = useState<Client | null>(null);
  const [taskEdit, setTaskEdit] = useState<Task | null>(null);
  const [lockPerson, setLockPerson] = useState(data.mePersonId);
  const [lockAnchor, setLockAnchor] = useState(() => startOfDay(new Date()));

  const num = (v: string) => Math.max(0, Number(v.replace(',', '.')) || 0);
  const run = (p: Promise<Data>) => p.then(onData).catch(onFail);

  // --- persons ---
  const newPerson = (): Person => ({
    id: '',
    name: '',
    email: '',
    weeklyHours: 0,
    hourlyRate: 0,
    color: nextColor(data.persons.map((p) => p.color)),
    archived: false,
    updatedAt: '',
  });
  const savePerson = () => {
    if (!personEdit) return;
    run(api.savePerson(personEdit)).then(() => setPersonEdit(null));
  };
  const deletePerson = async (p: Person) => {
    if (!(await onConfirm(t.confirmDeleteGeneric(p.name)))) return;
    run(api.deletePerson(p.id));
  };

  // --- clients ---
  const saveClient = () => {
    if (!clientEdit) return;
    run(api.saveClient(clientEdit)).then(() => setClientEdit(null));
  };
  const deleteClient = async (c: Client) => {
    if (!(await onConfirm(t.confirmDeleteGeneric(c.name)))) return;
    run(api.deleteClient(c.id));
  };

  // --- tasks ---
  const activeProjects = data.projects.filter((p) => !p.archived);
  const newTask = (): Task => ({
    id: '',
    projectId: activeProjects[0]?.id ?? '',
    name: '',
    billableDefault: true,
    archived: false,
    updatedAt: '',
  });
  const saveTask = () => {
    if (!taskEdit) return;
    run(api.saveTask(taskEdit)).then(() => setTaskEdit(null));
  };
  const deleteTask = async (x: Task) => {
    if (!(await onConfirm(t.confirmDeleteGeneric(x.name)))) return;
    run(api.deleteTask(x.id));
  };

  // --- week close ---
  const weekStart = weekStartOf(lockAnchor, settings.weekStart);
  const weekKey = dateKey(weekStart);
  const locked = data.locks.some((l) => l.personId === lockPerson && l.weekStart === weekKey);
  const toggleLock = async () => {
    const who = data.persons.find((p) => p.id === lockPerson)?.name ?? '';
    if (locked) run(api.unlockWeek(lockPerson, weekKey));
    else {
      if (!(await onConfirm(t.confirmLockWeek(who, fmtDate(weekStart, lang))))) return;
      run(api.lockWeek(lockPerson, weekKey));
    }
  };
  const locks = data.locks
    .slice()
    .sort((a, b) => b.weekStart.localeCompare(a.weekStart) || a.personId.localeCompare(b.personId));

  // --- package ---
  const exportPackage = async (mine: boolean) => {
    try {
      const json = await api.exportPackage(mine ? data.mePersonId : null);
      const me = data.persons.find((p) => p.id === data.mePersonId)?.name.replace(/[^\w-]+/g, '_') ?? 'me';
      const name = `timelog_${mine ? me : 'all'}_${dateKey(new Date())}.json`;
      if (await saveTextFile(name, json, { name: 'JSON', extensions: ['json'] }, 'application/json')) onToast(t.packageSaved);
    } catch (e) {
      onFail(e);
    }
  };
  const importPackage = async () => {
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

  const colorPick = (value: string, onPick: (c: string) => void) => (
    <div className="colorpick">
      {PALETTE.map((c) => (
        <button key={c} type="button" className={value === c ? 'on' : ''} style={{ background: c }} onClick={() => onPick(c)} />
      ))}
    </div>
  );

  return (
    <div className="view">
      <div className="viewbar">
        <h1>{t.team}</h1>
      </div>
      <div className="viewbody">
        <div className="team">
          {/* Personen */}
          <div className="panel">
            <h3>{t.persons}</h3>
            {data.persons
              .slice()
              .sort((a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name))
              .map((p) => (
                <div key={p.id} className={`trow ${p.archived ? 'archived' : ''}`}>
                  <span className="swatch" style={{ background: p.color }} />
                  <span className="grow1">
                    {p.name}
                    {p.id === data.mePersonId && <span className="badge">{t.me}</span>}
                    <div className="dim">
                      {p.weeklyHours > 0 ? `${p.weeklyHours} h/W` : ''}
                      {p.hourlyRate > 0 ? ` · ${p.hourlyRate} €/h` : ''}
                      {p.email ? ` · ${p.email}` : ''}
                    </div>
                  </span>
                  <button className="icon" title={t.edit} onClick={() => setPersonEdit({ ...p })}>
                    <IconEdit size={12} />
                  </button>
                  <button className="icon" title={p.archived ? t.unarchive : t.archive} onClick={() => run(api.savePerson({ ...p, archived: !p.archived }))}>
                    <IconArchive size={12} />
                  </button>
                  {p.id !== data.mePersonId && (
                    <button className="icon danger" title={t.delete} onClick={() => deletePerson(p)}>
                      <IconTrash size={12} />
                    </button>
                  )}
                </div>
              ))}
            {personEdit ? (
              <div className="tform">
                <label className="field">
                  <span>{t.name}</span>
                  <input type="text" autoFocus value={personEdit.name} onChange={(e) => setPersonEdit({ ...personEdit, name: e.target.value })} />
                </label>
                <label className="field">
                  <span>{t.email}</span>
                  <input type="text" value={personEdit.email} onChange={(e) => setPersonEdit({ ...personEdit, email: e.target.value })} />
                </label>
                <label className="field">
                  <span>{t.weeklyHours}</span>
                  <input type="text" value={personEdit.weeklyHours || ''} onChange={(e) => setPersonEdit({ ...personEdit, weeklyHours: num(e.target.value) })} />
                </label>
                <label className="field">
                  <span>{t.hourlyRate}</span>
                  <input type="text" value={personEdit.hourlyRate || ''} onChange={(e) => setPersonEdit({ ...personEdit, hourlyRate: num(e.target.value) })} />
                </label>
                <label className="field full">
                  <span>{t.color}</span>
                  {colorPick(personEdit.color, (c) => setPersonEdit({ ...personEdit, color: c }))}
                </label>
                <div className="btnrow">
                  <button className="ghost" onClick={() => setPersonEdit(null)}>
                    {t.cancel}
                  </button>
                  <button className="primary" disabled={!personEdit.name.trim()} onClick={savePerson}>
                    {t.save}
                  </button>
                </div>
              </div>
            ) : (
              <div className="btnrow" style={{ justifyContent: 'flex-start' }}>
                <button onClick={() => setPersonEdit(newPerson())}>
                  <IconPlus size={12} /> {t.addPerson}
                </button>
              </div>
            )}
          </div>

          {/* Kunden */}
          <div className="panel">
            <h3>{t.clients}</h3>
            {data.clients
              .slice()
              .sort((a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name))
              .map((c) => (
                <div key={c.id} className={`trow ${c.archived ? 'archived' : ''}`}>
                  <span className="grow1">
                    {c.name}
                    <div className="dim">
                      {data.projects.filter((p) => p.clientId === c.id).length} {t.projects.toLowerCase()}
                    </div>
                  </span>
                  <button className="icon" title={t.edit} onClick={() => setClientEdit({ ...c })}>
                    <IconEdit size={12} />
                  </button>
                  <button className="icon" title={c.archived ? t.unarchive : t.archive} onClick={() => run(api.saveClient({ ...c, archived: !c.archived }))}>
                    <IconArchive size={12} />
                  </button>
                  <button className="icon danger" title={t.delete} onClick={() => deleteClient(c)}>
                    <IconTrash size={12} />
                  </button>
                </div>
              ))}
            {clientEdit ? (
              <div className="tform">
                <label className="field full">
                  <span>{t.name}</span>
                  <input
                    type="text"
                    autoFocus
                    value={clientEdit.name}
                    onChange={(e) => setClientEdit({ ...clientEdit, name: e.target.value })}
                    onKeyDown={(e) => e.key === 'Enter' && clientEdit.name.trim() && saveClient()}
                  />
                </label>
                <div className="btnrow">
                  <button className="ghost" onClick={() => setClientEdit(null)}>
                    {t.cancel}
                  </button>
                  <button className="primary" disabled={!clientEdit.name.trim()} onClick={saveClient}>
                    {t.save}
                  </button>
                </div>
              </div>
            ) : (
              <div className="btnrow" style={{ justifyContent: 'flex-start' }}>
                <button onClick={() => setClientEdit({ id: '', name: '', archived: false, updatedAt: '' })}>
                  <IconPlus size={12} /> {t.addClient}
                </button>
              </div>
            )}
          </div>

          {/* Tätigkeiten */}
          <div className="panel">
            <h3>{t.tasks}</h3>
            {data.tasks
              .slice()
              .sort((a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name))
              .map((x) => {
                const p = data.projects.find((pr) => pr.id === x.projectId);
                return (
                  <div key={x.id} className={`trow ${x.archived ? 'archived' : ''}`}>
                    <span className="swatch" style={{ background: p?.color ?? 'var(--border)' }} />
                    <span className="grow1">
                      {x.name}
                      <div className="dim">
                        {p?.name ?? ''}
                        {x.billableDefault ? ` · ${t.colBillableHours.toLowerCase()}` : ''}
                      </div>
                    </span>
                    <button className="icon" title={t.edit} onClick={() => setTaskEdit({ ...x })}>
                      <IconEdit size={12} />
                    </button>
                    <button className="icon" title={x.archived ? t.unarchive : t.archive} onClick={() => run(api.saveTask({ ...x, archived: !x.archived }))}>
                      <IconArchive size={12} />
                    </button>
                    <button className="icon danger" title={t.delete} onClick={() => deleteTask(x)}>
                      <IconTrash size={12} />
                    </button>
                  </div>
                );
              })}
            {taskEdit ? (
              <div className="tform">
                <label className="field">
                  <span>{t.forProject}</span>
                  <select value={taskEdit.projectId} onChange={(e) => setTaskEdit({ ...taskEdit, projectId: e.target.value })}>
                    {activeProjects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>{t.name}</span>
                  <input type="text" autoFocus value={taskEdit.name} onChange={(e) => setTaskEdit({ ...taskEdit, name: e.target.value })} />
                </label>
                <label className="check full">
                  <input type="checkbox" checked={taskEdit.billableDefault} onChange={(e) => setTaskEdit({ ...taskEdit, billableDefault: e.target.checked })} />
                  {t.billableDefault}
                </label>
                <div className="btnrow">
                  <button className="ghost" onClick={() => setTaskEdit(null)}>
                    {t.cancel}
                  </button>
                  <button className="primary" disabled={!taskEdit.name.trim() || !taskEdit.projectId} onClick={saveTask}>
                    {t.save}
                  </button>
                </div>
              </div>
            ) : (
              <div className="btnrow" style={{ justifyContent: 'flex-start' }}>
                <button disabled={activeProjects.length === 0} onClick={() => setTaskEdit(newTask())}>
                  <IconPlus size={12} /> {t.addTask}
                </button>
              </div>
            )}
          </div>

          {/* Wochenabschluss */}
          <div className="panel">
            <h3>{t.weekClose}</h3>
            <div className="note" style={{ marginTop: 0 }}>
              {t.weekCloseHint}
            </div>
            <div className="row2" style={{ alignItems: 'center', marginBottom: 10 }}>
              <select value={lockPerson} onChange={(e) => setLockPerson(e.target.value)} style={{ width: 'auto' }}>
                {data.persons
                  .filter((p) => !p.archived)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
              <button className="icon" onClick={() => setLockAnchor(addDays(lockAnchor, -7))}>
                <IconChevronLeft size={12} />
              </button>
              <button className="icon" onClick={() => setLockAnchor(addDays(lockAnchor, 7))}>
                <IconChevronRight size={12} />
              </button>
              <span className="dim" style={{ fontSize: 12 }}>
                {t.weekLabel(isoWeek(weekStart))} · {fmtRange({ from: weekStart, to: addDays(weekStart, 7) }, lang)}
              </span>
              <button className={locked ? 'active' : 'primary'} onClick={toggleLock} style={{ marginLeft: 'auto' }}>
                {locked ? <IconUnlock size={12} /> : <IconLock size={12} />}
                {locked ? t.unlockWeek : t.lockWeek}
              </button>
            </div>
            <div className="fieldlabel">{t.lockedWeeks}</div>
            {locks.length === 0 && <div className="note">{t.noLockedWeeks}</div>}
            <div className="locklist">
              {locks.map((l) => (
                <div key={`${l.personId}:${l.weekStart}`} className="lk">
                  <IconLock size={11} />
                  <span>{data.persons.find((p) => p.id === l.personId)?.name ?? '?'}</span>
                  <span>
                    {t.weekOf(fmtDate(parseDateKey(l.weekStart), lang))} · {t.weekLabel(isoWeek(parseDateKey(l.weekStart)))}
                  </span>
                  <button className="icon ghost" title={t.unlockWeek} onClick={() => run(api.unlockWeek(l.personId, l.weekStart))}>
                    <IconUnlock size={11} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Paket */}
          <div className="panel wide">
            <h3>{t.packageTitle}</h3>
            <div className="note" style={{ marginTop: 0 }}>
              {t.packageHint}
            </div>
            <div className="btnrow" style={{ justifyContent: 'flex-start' }}>
              <button onClick={() => exportPackage(true)}>
                <IconDownload size={12} /> {t.exportMine}
              </button>
              <button onClick={() => exportPackage(false)}>
                <IconDownload size={12} /> {t.exportAll}
              </button>
              <button className="primary" onClick={importPackage}>
                <IconUpload size={12} /> {t.importPackage}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
