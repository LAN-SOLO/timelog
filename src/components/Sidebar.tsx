import { Data, Project } from '../api';
import { Dict } from '../i18n';
import { IconCalendar, IconChart, IconClock, IconEdit, IconGrid, IconPlus, IconUsers, IconX } from '../icons';

export type View = 'today' | 'week' | 'reports' | 'dashboard' | 'team';

function viewItems(t: Dict, expert: boolean, size: number): [View, string, JSX.Element, string][] {
  const views: [View, string, JSX.Element, string][] = [
    ['today', t.viewToday, <IconClock size={size} />, '1'],
    ['week', t.viewWeek, <IconCalendar size={size} />, '2'],
    ['reports', t.viewReports, <IconChart size={size} />, '3'],
  ];
  if (expert) {
    views.push(['dashboard', t.viewDashboard, <IconGrid size={size} />, '4']);
    views.push(['team', t.viewTeam, <IconUsers size={size} />, '5']);
  }
  return views;
}

export function Sidebar({
  data,
  t,
  expert,
  view,
  onView,
  projectFilter,
  onProjectFilter,
  onNewProject,
  onEditProject,
  showArchived,
  onToggleArchived,
  open,
  onClose,
}: {
  data: Data;
  t: Dict;
  expert: boolean;
  view: View;
  onView: (v: View) => void;
  projectFilter: string | null;
  onProjectFilter: (id: string | null) => void;
  onNewProject: () => void;
  onEditProject: (p: Project) => void;
  showArchived: boolean;
  onToggleArchived: () => void;
  /** Mobil: Seitenleiste als Schublade geöffnet. */
  open: boolean;
  onClose: () => void;
}) {
  const views = viewItems(t, expert, 13);
  const projects = data.projects
    .filter((p) => showArchived || !p.archived)
    .slice()
    .sort((a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name));
  const archivedCount = data.projects.filter((p) => p.archived).length;

  return (
    <>
      {open && <div className="sb-backdrop" onClick={onClose} />}
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="sb-drawerhead">
          <span className="grow">{t.projects}</span>
          <button
            className="ghost icon"
            title={t.newProject}
            onClick={() => {
              onClose();
              onNewProject();
            }}
          >
            <IconPlus size={14} />
          </button>
          <button className="ghost icon" title={t.close} onClick={onClose}>
            <IconX size={14} />
          </button>
        </div>

        <div className="sb-views">
          {views.map(([id, label, icon, key]) => (
            <button key={id} className={`sb-item ${view === id ? 'active' : ''}`} onClick={() => onView(id)}>
              {icon}
              <span className="fname">{label}</span>
              {expert && <span className="kbd">{key}</span>}
            </button>
          ))}
        </div>

        <div className="sb-title">
          <span className="grow">{t.projects}</span>
          <button
            className="icon"
            title={t.newProject}
            onClick={() => {
              onClose();
              onNewProject();
            }}
          >
            <IconPlus size={11} />
          </button>
        </div>
        {projects.length === 0 && <div className="note" style={{ padding: '0 12px' }}>{t.noProjects}</div>}
        {projects.map((p) => {
          const client = p.clientId ? data.clients.find((c) => c.id === p.clientId) : null;
          return (
            <div
              key={p.id}
              role="button"
              tabIndex={0}
              className={`sb-item ${projectFilter === p.id ? 'active' : ''} ${p.archived ? 'archived' : ''}`}
              onClick={() => {
                onProjectFilter(projectFilter === p.id ? null : p.id);
                onClose();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onProjectFilter(projectFilter === p.id ? null : p.id);
                  onClose();
                }
              }}
              title={client ? `${client.name} · ${p.name}` : p.name}
            >
              <span className="swatch" style={{ background: p.color }} />
              <span className="fname">{p.name}</span>
              <button
                className="icon"
                title={t.edit}
                onClick={(e) => {
                  e.stopPropagation();
                  onClose();
                  onEditProject(p);
                }}
              >
                <IconEdit size={11} />
              </button>
            </div>
          );
        })}
        {archivedCount > 0 && (
          <div className="sb-foot" style={{ marginTop: 4 }}>
            <button className="ghost" onClick={onToggleArchived}>
              {showArchived ? t.hideArchived : `${t.showArchived} (${archivedCount})`}
            </button>
          </div>
        )}
      </aside>
    </>
  );
}

/** Mobil: Tab-Leiste am unteren Rand — Ansichten plus Projekte-Schublade. */
export function TabBar({
  t,
  expert,
  view,
  onView,
  projectFilter,
  projectColor,
  onProjects,
  drawerOpen,
}: {
  t: Dict;
  expert: boolean;
  view: View;
  onView: (v: View) => void;
  projectFilter: string | null;
  projectColor: string | null;
  onProjects: () => void;
  drawerOpen: boolean;
}) {
  const views = viewItems(t, expert, 18);
  return (
    <nav className="tabbar">
      {views.map(([id, label, icon]) => (
        <button key={id} className={`tab ${view === id && !drawerOpen ? 'active' : ''}`} onClick={() => onView(id)}>
          {icon}
          <span>{label}</span>
        </button>
      ))}
      <button className={`tab ${drawerOpen ? 'active' : ''}`} onClick={onProjects}>
        <span className="tab-swatch" style={{ background: projectFilter ? projectColor ?? 'var(--blue)' : 'transparent' }} />
        <span>{t.projects}</span>
      </button>
    </nav>
  );
}
