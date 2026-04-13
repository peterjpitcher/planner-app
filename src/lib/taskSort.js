function toTimestamp(value) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function compareTasksByDueDateAsc(a, b) {
  const dueA = toTimestamp(a?.due_date);
  const dueB = toTimestamp(b?.due_date);

  if (dueA === null && dueB !== null) return 1;
  if (dueA !== null && dueB === null) return -1;
  if (dueA !== null && dueB !== null && dueA !== dueB) {
    return dueA - dueB;
  }

  const createdA = toTimestamp(a?.created_at);
  const createdB = toTimestamp(b?.created_at);

  if (createdA === null && createdB !== null) return 1;
  if (createdA !== null && createdB === null) return -1;
  if (createdA !== null && createdB !== null && createdA !== createdB) {
    return createdA - createdB;
  }

  const nameDiff = (a?.name || '').localeCompare(b?.name || '');
  if (nameDiff !== 0) return nameDiff;

  return String(a?.id || '').localeCompare(String(b?.id || ''));
}

export function compareTasksBySortOrderAsc(a, b) {
  // Primary sort: sort_order ascending
  const sortA = a?.sort_order ?? Infinity;
  const sortB = b?.sort_order ?? Infinity;

  if (sortA !== sortB) {
    return sortA - sortB;
  }

  // Tiebreaker: created_at ascending
  const createdA = toTimestamp(a?.created_at);
  const createdB = toTimestamp(b?.created_at);

  if (createdA === null && createdB !== null) return 1;
  if (createdA !== null && createdB === null) return -1;
  if (createdA !== null && createdB !== null && createdA !== createdB) {
    return createdA - createdB;
  }

  const nameDiff = (a?.name || '').localeCompare(b?.name || '');
  if (nameDiff !== 0) return nameDiff;

  return String(a?.id || '').localeCompare(String(b?.id || ''));
}

export function sortTasksByDueDateAsc(tasks = []) {
  return [...tasks].sort(compareTasksByDueDateAsc);
}

export function sortTasksBySortOrderAsc(tasks = []) {
  return [...tasks].sort(compareTasksBySortOrderAsc);
}

export function compareBacklogTasks(a, b) {
  // Tier 1: due date ascending (dated before undated)
  const dueA = toTimestamp(a?.due_date);
  const dueB = toTimestamp(b?.due_date);

  if (dueA === null && dueB !== null) return 1;
  if (dueA !== null && dueB === null) return -1;
  if (dueA !== null && dueB !== null && dueA !== dueB) {
    return dueA - dueB;
  }

  // Tier 2: sort_order ascending
  const sortA = a?.sort_order ?? Infinity;
  const sortB = b?.sort_order ?? Infinity;
  if (sortA !== sortB) return sortA - sortB;

  // Tiebreaker: created_at ascending
  const createdA = toTimestamp(a?.created_at);
  const createdB = toTimestamp(b?.created_at);

  if (createdA === null && createdB !== null) return 1;
  if (createdA !== null && createdB === null) return -1;
  if (createdA !== null && createdB !== null && createdA !== createdB) {
    return createdA - createdB;
  }

  const nameDiff = (a?.name || '').localeCompare(b?.name || '');
  if (nameDiff !== 0) return nameDiff;

  return String(a?.id || '').localeCompare(String(b?.id || ''));
}
