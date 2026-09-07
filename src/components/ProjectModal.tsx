import { useState } from 'react';
import { Data, Project } from '../api';
import { Dict } from '../i18n';
import { PALETTE, nextColor } from '../util';

export function ProjectModal({
  project,
  data,
  t,
  expert,
  onSave,
  onDelete,
  onClose,
}: {
  project: Project | null;
  data: Data;
  t: Dict;
  expert: boolean;
  /** `clientName` leer = kein Kunde; unbekannter Name wird neu angelegt. */
  onSave: (p: Project, clientName: string) => void;
  onDelete: (p: Project) => void;
  onClose: () => void;
}) {
  const [p, setP] = useState<Project>(
    () =>
      project ?? {
        id: '',
        clientId: null,
        name: '',
        color: nextColor(data.projects.map((x) => x.color)),
        budgetHours: 0,
        budgetAmount: 0,
        hourlyRate: 0,
        billableDefault: true,
        archived: false,
        updatedAt: '',
      }
  );
  const [clientName, setClientName] = useState(
    () => (project?.clientId ? data.clients.find((c) => c.id === project.clientId)?.name : '') ?? ''
  );
  const set = <K extends keyof Project>(k: K, v: Project[K]) => setP((x) => ({ ...x, [k]: v }));
  const num = (v: string) => Math.max(0, Number(v.replace(',', '.')) || 0);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal project" onClick={(e) => e.stopPropagation()}>
        <h2>{t.projectTitle}</h2>
        <label className="field">
          <span>{t.projectName}</span>
          <input
            type="text"
            value={p.name}
            autoFocus
            onChange={(e) => set('name', e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && p.name.trim()) onSave(p, clientName.trim());
            }}
          />
        </label>
        <label className="field">
          <span>{t.color}</span>
          <div className="colorpick">
            {PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                className={p.color === c ? 'on' : ''}
                style={{ background: c }}
                onClick={() => set('color', c)}
              />
            ))}
          </div>
        </label>
        <label className="field">
          <span>{t.client}</span>
          <input
            type="text"
            list="tl-clients"
            value={clientName}
            placeholder={t.noClient}
            onChange={(e) => setClientName(e.target.value)}
          />
          <datalist id="tl-clients">
            {data.clients
              .filter((c) => !c.archived)
              .map((c) => (
                <option key={c.id} value={c.name} />
              ))}
          </datalist>
        </label>
        <div className="note" style={{ marginTop: -6 }}>
          {t.newClientHint}
        </div>
        {expert && (
          <>
            <div className="row3">
              <label className="field">
                <span>{t.budgetHours}</span>
                <input
                  type="text"
                  value={p.budgetHours || ''}
                  onChange={(e) => set('budgetHours', num(e.target.value))}
                />
              </label>
              <label className="field">
                <span>{t.budgetAmount}</span>
                <input
                  type="text"
                  value={p.budgetAmount || ''}
                  onChange={(e) => set('budgetAmount', num(e.target.value))}
                />
              </label>
              <label className="field">
                <span>{t.projectRate}</span>
                <input
                  type="text"
                  value={p.hourlyRate || ''}
                  onChange={(e) => set('hourlyRate', num(e.target.value))}
                />
              </label>
            </div>
            <div className="note" style={{ marginTop: -6 }}>
              {t.rateHint}
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={p.billableDefault}
                onChange={(e) => set('billableDefault', e.target.checked)}
              />
              {t.billableDefault}
            </label>
          </>
        )}
        {project && (
          <label className="check">
            <input type="checkbox" checked={p.archived} onChange={(e) => set('archived', e.target.checked)} />
            {t.archiveProject}
          </label>
        )}
        <div className="btnrow">
          {project && (
            <button className="danger" style={{ marginRight: 'auto' }} onClick={() => onDelete(project)}>
              {t.deleteProject}
            </button>
          )}
          <button className="ghost" onClick={onClose}>
            {t.cancel}
          </button>
          <button className="primary" disabled={!p.name.trim()} onClick={() => onSave(p, clientName.trim())}>
            {t.save}
          </button>
        </div>
      </div>
    </div>
  );
}
