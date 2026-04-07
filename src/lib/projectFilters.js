import { differenceInCalendarDays, parseISO } from 'date-fns';
import { getStartOfTodayLondon } from '@/lib/dateUtils';

export function isProjectOverdue(project, projectTasks = []) {
  const today = getStartOfTodayLondon();
  if (project.due_date) {
    const projectDue = parseISO(project.due_date);
    if (differenceInCalendarDays(today, projectDue) > 0) return true;
  }
  return projectTasks.some((task) => {
    if (!task.due_date) return false;
    const taskDue = parseISO(task.due_date);
    return differenceInCalendarDays(today, taskDue) > 0;
  });
}

export function isProjectStale(project) {
  if (!project.updated_at) return false;
  const today = getStartOfTodayLondon();
  const updated = parseISO(project.updated_at);
  return differenceInCalendarDays(today, updated) >= 14;
}

export function hasNoTasks(projectTasks = []) {
  return projectTasks.length === 0;
}

export function matchesFilter(project, filterName, projectTasks = []) {
  switch (filterName) {
    case 'overdue':
      return isProjectOverdue(project, projectTasks);
    case 'no_tasks':
      return hasNoTasks(projectTasks);
    case 'stale':
      return isProjectStale(project);
    case 'on_hold':
      return project.status === 'On Hold';
    case 'all':
    default:
      return true;
  }
}

export function computeAttentionCounts(projects, tasksByProject) {
  let overdue = 0;
  let noTasks = 0;
  let stale = 0;
  let onHold = 0;

  for (const project of projects) {
    if (project.status === 'Completed' || project.status === 'Cancelled') continue;
    const tasks = tasksByProject[project.id] || [];
    if (isProjectOverdue(project, tasks)) overdue++;
    if (hasNoTasks(tasks)) noTasks++;
    if (isProjectStale(project)) stale++;
    if (project.status === 'On Hold') onHold++;
  }

  return { overdue, noTasks, stale, onHold };
}

export function deriveAreas(projects) {
  const seen = new Map();
  for (const project of projects) {
    if (project.area) {
      const lower = project.area.toLowerCase().trim();
      if (!seen.has(lower)) {
        seen.set(lower, project.area.trim());
      }
    }
  }
  return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
}

export function getAttentionType(project, projectTasks = []) {
  if (isProjectOverdue(project, projectTasks)) return 'overdue';
  if (hasNoTasks(projectTasks)) return 'no_tasks';
  if (isProjectStale(project)) return 'stale';
  return null;
}

export function getVisibleProjects(projects, tasksByProject, { showCompleted, activeFilter, selectedArea }) {
  const STATUS_ORDER = ['In Progress', 'Open', 'On Hold', 'Completed', 'Cancelled'];

  return projects
    .filter((p) => {
      if (!showCompleted && (p.status === 'Completed' || p.status === 'Cancelled')) return false;
      if (selectedArea && selectedArea !== 'all') {
        if ((p.area || '').toLowerCase() !== selectedArea.toLowerCase()) return false;
      }
      if (activeFilter && activeFilter !== 'all') {
        return matchesFilter(p, activeFilter, tasksByProject[p.id] || []);
      }
      return true;
    })
    .sort((a, b) => {
      const aOrder = STATUS_ORDER.indexOf(a.status);
      const bOrder = STATUS_ORDER.indexOf(b.status);
      if (aOrder !== bOrder) return aOrder - bOrder;
      if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
      if (a.due_date) return -1;
      if (b.due_date) return 1;
      return 0;
    });
}
