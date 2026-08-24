import { GB as chronoGB } from 'chrono-node/en';

import { getLondonDateKey } from './timezone';

const LONDON_TIME_ZONE = 'Europe/London';
const WEEKDAYS = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};
const WEEKDAY_PATTERN = Object.keys(WEEKDAYS).join('|');
const NUMBER_WORDS = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};
const NUMBER_PATTERN = `${Object.keys(NUMBER_WORDS).join('|')}|\\d+`;

function parseDateKey(dateKey) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey));
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month, day, 12));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}

function toDateKey(date) {
  return date.toISOString().slice(0, 10);
}

function addDaysToDateKey(dateKey, days) {
  const date = parseDateKey(dateKey);
  if (!date || !Number.isSafeInteger(days)) return dateKey;
  date.setUTCDate(date.getUTCDate() + days);
  return toDateKey(date);
}

function nextWeekdayDateKey(dateKey, weekday, extraWeeks = 0) {
  const date = parseDateKey(dateKey);
  if (!date) return null;

  const daysAhead = (WEEKDAYS[weekday] - date.getUTCDay() + 7) % 7;
  return addDaysToDateKey(dateKey, daysAhead + (extraWeeks * 7));
}

function endOfWeekDateKey(dateKey, extraWeeks = 0) {
  const date = parseDateKey(dateKey);
  if (!date) return null;

  // A working week ends on Friday. If today is the weekend, "this week"
  // means the next Friday rather than silently creating an overdue task.
  const isoWeekday = date.getUTCDay() || 7;
  const daysToFriday = isoWeekday <= 5 ? 5 - isoWeekday : 12 - isoWeekday;
  return addDaysToDateKey(dateKey, daysToFriday + (extraWeeks * 7));
}

function endOfMonthDateKey(dateKey, extraMonths = 0) {
  const date = parseDateKey(dateKey);
  if (!date) return null;

  return toDateKey(new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth() + extraMonths + 1,
    0,
    12
  )));
}

function normaliseAmount(value) {
  const normalised = String(value).toLowerCase();
  const amount = NUMBER_WORDS[normalised] ?? Number(normalised);
  return Number.isSafeInteger(amount) && amount >= 0 && amount <= 10000 ? amount : null;
}

// Words that qualify a date rather than introduce it. They sit immediately
// before the token chrono matches, so they have to come off the task name too.
const DATE_QUALIFIER_TAIL =
  /\s+(?:first\s+thing|last\s+thing|end\s+of\s+play|close\s+of\s+business|cob|eop|no\s+later\s+than|not\s+later\s+than|some\s?time|starting|around|about|roughly|approximately|hopefully|maybe|perhaps|possibly|ideally|later|earlier|early|late|mid|over(?:\s+the)?)\s*$/i;

// A recurrence, which this parser deliberately does not set. Taking the date
// would silently drop the repeat, so the line is left untouched instead.
const RECURRENCE_TAIL = /(?:^|\s)(?:every|each)(?:\s+other)?\s*$/i;

function buildResult(text, startIndex, dueDate, suffix = '') {
  if (!dueDate) return null;

  let name = text.slice(0, startIndex).trimEnd();
  name = name
    .replace(
      /\s+(?:(?:due\s+)?on(?:\s+the)?|(?:due\s+)?(?:by|for|before|after|until)|from|due|this\s+coming|coming)\s*$/i,
      ''
    )
    // chrono usually matches only the trailing token of a longer time phrase,
    // so whatever qualified it stays glued to the name: "Send the deck first
    // thing Monday" saved a task called "Send the deck first thing". Strip the
    // qualifier too, after the prepositions above, so "first thing on Monday"
    // reduces cleanly.
    .replace(DATE_QUALIFIER_TAIL, '')
    .replace(/[\s,;:\-–—]+$/, '');

  if (/^[\s]*[)\]}]/.test(suffix)) {
    name = name.replace(/[\s([{]+$/, '');
  }

  name = name.trim();
  return name ? { name, dueDate } : null;
}

function parseSupportedSpecialCase(text, baseDateKey) {
  let match = /\s+(?:on\s+|by\s+)?the\s+day\s+after\s+tomorrow(?<suffix>[.!?)\]}]*)$/i.exec(text);
  if (match) {
    return buildResult(text, match.index, addDaysToDateKey(baseDateKey, 2), match.groups.suffix);
  }

  match = new RegExp(
    `\\s+in\\s+(${NUMBER_PATTERN})\\s+fortnights?(?<suffix>[.!?)\\]}]*)$`,
    'i'
  ).exec(text);
  if (match) {
    const amount = normaliseAmount(match[1]);
    if (amount !== null) {
      return buildResult(text, match.index, addDaysToDateKey(baseDateKey, amount * 14), match.groups.suffix);
    }
  }

  // "a week today" / "a fortnight tomorrow" style. Without this these fell
  // through to chrono, which matched only the trailing "today"/"tomorrow" and
  // saved the task as "Send the pack a week", due today.
  match = new RegExp(
    `\\s+(${NUMBER_PATTERN})\\s+weeks?\\s+(today|tomorrow)(?<suffix>[.!?)\\]}]*)$`,
    'i'
  ).exec(text);
  if (match) {
    const amount = normaliseAmount(match[1]);
    if (amount !== null) {
      const dayOffset = match[2].toLowerCase() === 'tomorrow' ? 1 : 0;
      return buildResult(
        text,
        match.index,
        addDaysToDateKey(baseDateKey, amount * 7 + dayOffset),
        match.groups.suffix
      );
    }
  }

  match = new RegExp(
    `\\s+(?:a|one)\\s+week\\s+on\\s+(${WEEKDAY_PATTERN})(?<suffix>[.!?)\\]}]*)$`,
    'i'
  ).exec(text);
  if (match) {
    const dueDate = nextWeekdayDateKey(baseDateKey, match[1].toLowerCase(), 1);
    return buildResult(text, match.index, dueDate, match.groups.suffix);
  }

  match = new RegExp(
    `\\s+(?:on\\s+)?(${WEEKDAY_PATTERN})\\s+week(?<suffix>[.!?)\\]}]*)$`,
    'i'
  ).exec(text);
  if (match) {
    const dueDate = nextWeekdayDateKey(baseDateKey, match[1].toLowerCase(), 1);
    return buildResult(text, match.index, dueDate, match.groups.suffix);
  }

  match = /\s+(?:at\s+|by\s+|on\s+)?(?:the\s+)?end\s+of\s+(?:(this|next|the)\s+)?(week|month)(?<suffix>[.!?)\]}]*)$/i.exec(text);
  if (match) {
    const offset = match[1]?.toLowerCase() === 'next' ? 1 : 0;
    const dueDate = match[2].toLowerCase() === 'week'
      ? endOfWeekDateKey(baseDateKey, offset)
      : endOfMonthDateKey(baseDateKey, offset);
    return buildResult(text, match.index, dueDate, match.groups.suffix);
  }

  return null;
}

function isCalendarDate(result) {
  return result.start.isCertain('day') || result.start.isCertain('weekday');
}

function resultDateKey(result) {
  const components = result.end || result.start;
  const year = components.get('year');
  const month = components.get('month');
  const day = components.get('day');
  if (!year || !month || !day) return null;

  const dateKey = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return parseDateKey(dateKey) ? dateKey : null;
}

/**
 * Parse a natural-language date at the end of a quick-task line.
 * Unrecognised, ambiguous or invalid phrases leave the task unchanged and due today.
 */
export function parseQuickTaskDate(input, baseDateKey = getLondonDateKey()) {
  const text = String(input || '').trim();
  const fallback = { name: text, dueDate: baseDateKey };
  if (!text || !parseDateKey(baseDateKey)) return fallback;

  const specialCase = parseSupportedSpecialCase(text, baseDateKey);
  if (specialCase) return specialCase;

  const reference = {
    instant: new Date(`${baseDateKey}T12:00:00Z`),
    timezone: LONDON_TIME_ZONE,
  };
  const results = chronoGB.parse(text, reference, { forwardDate: true });

  for (let index = results.length - 1; index >= 0; index -= 1) {
    const result = results[index];
    const suffix = text.slice(result.index + result.text.length);

    // Dates are commands only at the end of a line. This prevents titles such
    // as "Discuss Friday trading" from losing ordinary words.
    if (!/^[\s,.;:!?)\]}]*$/.test(suffix) || !isCalendarDate(result)) continue;

    // "Water the plants every Monday" is a repeat, not a due date.
    if (RECURRENCE_TAIL.test(text.slice(0, result.index))) continue;

    const parsed = buildResult(text, result.index, resultDateKey(result), suffix);
    if (parsed) return parsed;
  }

  return fallback;
}
