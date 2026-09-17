import { getTimeZoneParts, LONDON_TIME_ZONE } from '@/lib/timezone';

/*
 * Per-line date and time stamps for the note composer.
 *
 * A long note-taking session (a call, a meeting) is one note written over an
 * hour, so the note's own date says nothing about when each point was made.
 * Every line the composer starts gets a stamp instead.
 *
 * The stamp is London time whatever the browser's zone, because that is the
 * business zone and the one the rest of the app reports in.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "[17 Sep 2026 14:32] " for the given instant, in London time. */
export function noteLineStamp(date = new Date()) {
  const { year, month, day, hour, minute } = getTimeZoneParts(date, LONDON_TIME_ZONE);
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  return `[${day} ${MONTHS[month - 1]} ${year} ${hh}:${mm}] `;
}

const STAMP_ONLY_LINE = /^\[\d{1,2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}\]\s*$/;

/**
 * The draft as it should be saved: Enter always opens a stamped line, so a
 * finished note usually ends with a stamp and nothing after it. Drop those
 * (and blank lines) from the end, so a stamp on its own never counts as a note.
 */
export function withoutTrailingEmptyStamps(value) {
  const lines = value.split('\n');
  while (lines.length > 0) {
    const last = lines[lines.length - 1];
    if (last.trim() !== '' && !STAMP_ONLY_LINE.test(last)) break;
    lines.pop();
  }
  return lines.join('\n');
}

const LONE_STAMP = /^\[\d{1,2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}\] $/;

/** True when the draft is one stamp and nothing else: a line not yet started. */
export function isLoneStamp(value) {
  return LONE_STAMP.test(value);
}

/**
 * Stamp the first line as writing starts.
 *
 * An empty draft that gains text (typed or pasted) gets the stamp in front of
 * it. The composer also puts a stamp in as soon as it is focused, so the first
 * line is visibly stamped before anything is typed; if that stamp is still on
 * its own when typing starts, it is renewed, so it records when the line was
 * written rather than when the box was clicked. Anything else passes through.
 */
export function stampFirstLine(previous, next, stamp) {
  if (next === '') return next;
  if (previous === '') return `${stamp}${next}`;
  if (isLoneStamp(previous) && next.length > previous.length && next.startsWith(previous)) {
    return `${stamp}${next.slice(previous.length)}`;
  }
  return next;
}

/**
 * Start a new stamped line at the cursor, replacing any selection.
 * Returns the new value and where the cursor belongs, or null when the result
 * would pass maxLength (the browser enforces that on typing, not on code).
 */
export function insertStampedLine(value, selectionStart, selectionEnd, stamp, maxLength = Infinity) {
  const before = value.slice(0, selectionStart);
  const after = value.slice(selectionEnd);
  // An empty box needs no line break in front of its first stamp.
  const insert = before === '' && after === '' ? stamp : `\n${stamp}`;
  const next = `${before}${insert}${after}`;
  if (next.length > maxLength) return null;
  return { value: next, caret: before.length + insert.length };
}
