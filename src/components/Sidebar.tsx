import { Data, Project } from '../api';
import { Dict } from '../i18n';
import { IconCalendar, IconChart, IconClock, IconEdit, IconGrid, IconPlus, IconUsers } from '../icons';

export type View = 'today' | 'week' | 'reports' | 'dashboard' | 'team';

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
}) {
  const views: [View, string, JSX.Element, string][] = [
    ['today', t.viewToday, <IconClock size={13} />, '1'],
    ['week', t.viewWeek, <IconCalendar size={13} />, '2'],
    ['reports', t.viewReports, <IconChart size={13} />, '3'],
  ];
  if (expert) {
    views.push(['dashboard', t.viewDashboard, <IconGrid size={13} />, '4']);
    views.push(['team', t.viewTeam, <IconUsers size={13} />, '5']);
  }
  const projects = data.projects
    .filter((p) => showArchived || !p.archived)
    .slice()
    .sort((a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name));
  const archivedCount = data.projects.filter((p) => p.archived).length;

  return (
    <aside className="sidebar">
      {views.map(([id, label, icon, key]) => (
        <button key={id} className={`sb-item ${view === id ? 'active' : ''}`} onClick={() => onView(id)}>
          {icon}
          <span className="fname">{label}</span>
          {expert && <span className="kbd">{key}</span>}
        </button>
      ))}

      <div className="sb-title">
        <span className="grow">{t.projects}</span>
        <button className="icon" title={t.newProject} onClick={onNewProject}>
          <IconPlus size={11} />
        </button>
      </div>
      {projects.length === 0 && <div className="note" style={{ padding: '0 12px' }}>{t.noProjects}</div>}
      {projects.map((p) => {
        const client = p.clientId ? data.clients.find((c) => c.id === p.clientId) : null;
        return (
          <button
            key={p.id}
            className={`sb-item ${projectFilter === p.id ? 'active' : ''} ${p.archived ? 'archived' : ''}`}
            onClick={() => onProjectFilter(projectFilter === p.id ? null : p.id)}
            title={client ? `${client.name} · ${p.name}` : p.name}
          >
            <span className="swatch" style={{ background: p.color }} />
            <span className="fname">{p.name}</span>
            <button
              className="icon"
              title={t.edit}
              onClick={(e) => {
                e.stopPropagation();
                onEditProject(p);
              }}
            >
              <IconEdit size={11} />
            </button>
          </button>
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
  );
}
