import { differenceInCalendarDays, parseISO } from 'date-fns';

export const DEFAULT_TASK_SCORING = {
  importanceWeight: 0.6,
  dueWeight: 0.6,
  horizonDays: 14,
};

export function seedImportanceFromPriority(priority) {
  switch (priority) {
    case 'High': return 80;
    case 'Medium': return 50;
    case 'Low': return 20;
    default: return 50;
  }
}

export function clampScore(value) {
  if (!Number.isFinite(value)) return 50;
  return Math.min(100, Math.max(0, Math.round(value)));
}

export function getPriorityLabel(priorityScore) {
  const normalizedScore = clampScore(priorityScore);
  if (normalizedScore >= 67) return 'High';
  if (normalizedScore >= 34) return 'Medium';
  return 'Low';
}

export function getTaskScoreInputs(task) {
  const hasManualScores = typeof task?.importance_score === 'number' && typeof task?.urgency_score === 'number';
  const importance = clampScore(
    typeof task?.importance_score === 'number' ? task.importance_score : seedImportanceFromPriority(task?.priority)
  );
  const urgency = clampScore(typeof task?.urgency_score === 'number' ? task.urgency_score : 50);
  return { hasManualScores, importance, urgency };
}

export function getDueMeta(dueDate, { horizonDays } = DEFAULT_TASK_SCORING) {
  if (!dueDate) {
    return {
      daysToDue: Number.POSITIVE_INFINITY,
      bucket: 0, // not due soon
      duePressure: 0,
    };
  }

  let parsed;
  try {
    parsed = parseISO(dueDate);
  } catch {
    return {
      daysToDue: Number.POSITIVE_INFINITY,
      bucket: 0,
      duePressure: 0,
    };
  }

  if (!(parsed instanceof Date) || Number.isNaN(parsed.getTime())) {
    return {
      daysToDue: Number.POSITIVE_INFINITY,
      bucket: 0,
      duePressure: 0,
    };
  }

  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const daysToDue = differenceInCalendarDays(parsed, now);

  if (daysToDue <= 0) {
    return {
      daysToDue,
      bucket: 2, // overdue or today
      duePressure: 100,
    };
  }

  if (daysToDue <= horizonDays) {
    const duePressure = Math.round(100 * (1 - daysToDue / horizonDays));
    return {
      daysToDue,
      bucket: 1, // due soon
      duePressure,
    };
  }

  return {
    daysToDue,
    bucket: 0,
    duePressure: 0,
  };
}

export function getTaskScores(task, config = DEFAULT_TASK_SCORING) {
  const { importanceWeight, dueWeight } = config;
  const inputs = getTaskScoreInputs(task);
  const due = getDueMeta(task?.due_date, config);

  const effectiveUrgency = due.bucket === 2
    ? 100
    : ((1 - dueWeight) * inputs.urgency + dueWeight * due.duePressure);

  const priorityScore = importanceWeight * inputs.importance + (1 - importanceWeight) * effectiveUrgency;

  return {
    hasManualScores: inputs.hasManualScores,
    importance: inputs.importance,
    urgency: inputs.urgency,
    duePressure: due.duePressure,
    effectiveUrgency,
    priorityScore,
    dueMeta: due,
  };
}

export function compareTasksByWorkPriority(a, b, config = DEFAULT_TASK_SCORING) {
  const aScores = getTaskScores(a, config);
  const bScores = getTaskScores(b, config);

  const scoreDiff = bScores.priorityScore - aScores.priorityScore;
  if (scoreDiff !== 0) return scoreDiff;

  if (aScores.dueMeta.bucket !== bScores.dueMeta.bucket) {
    return bScores.dueMeta.bucket - aScores.dueMeta.bucket;
  }

  if (aScores.dueMeta.bucket > 0 && aScores.dueMeta.daysToDue !== bScores.dueMeta.daysToDue) {
    return aScores.dueMeta.daysToDue - bScores.dueMeta.daysToDue;
  }

  return (a?.name || '').localeCompare(b?.name || '');
}
