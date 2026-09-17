import { stripLineStamp } from '@/lib/noteStamps';
import { parseQuickTask } from '@/lib/quickTaskParser';
import { getLondonDateKey } from '@/lib/timezone';

/*
 * Picking tasks out of notes as they are written.
 *
 * A finished line of a note becomes a task when it reads like one. The rules
 * are deliberately plain words at the start of a line, because a task is
 * created without asking: a rule that guesses creates junk on a shared screen.
 * So "I'll send the menu" is a task and "Sam will send the menu" is not, and
 * "Called Sam" is not.
 *
 * 1. Markers:      "Todo call Sam", "To do: call Sam", "Action: send menu",
 *                  "Task: ...", "Next step: ...", "AP: ...", "[ ] book tasting"
 * 2. Commitments:  "I'll / I will / I'm going to / I need to / I have to /
 *                  I must", the same with "we", "Need to", "Must",
 *                  "Remember to", "Remind me to", "Don't forget to",
 *                  "Make sure to / I / we". The phrase is dropped:
 *                  "I'll send the menu" becomes "Send the menu".
 * 3. Follow-ups:   "Follow up with / on / about / regarding ..." kept whole.
 * 4. A tag:        "#task" or "#todo" at the end of any line.
 *
 * The rest goes through the quick-add parser, so a date at the end works the
 * same as in the task box: "I'll send the menu by Friday" is due Friday, and
 * anything without a date is due today, as quick add does.
 */

const A = "['’]"; // straight or curly apostrophe, as typed on a Mac

const BULLET = /^(?:[-*•]\s+)/;
const TAG = /\s*#(?:task|todo)\s*$/i;

const MARKERS = [
  /^\[\s?\]\s+/,
  /^todo\b\s*[:\-–]?\s*/i,
  /^to[\s-]do\s*[:\-–]\s*/i,
  /^(?:task|action(?:\s+point)?|next\s+step|ap)\s*[:\-–]\s*/i,
];

const COMMITMENT = new RegExp(
  '^(?:'
    + [
      `i${A}ll`, 'i will', `i${A}m going to`, 'i am going to', 'i need to', 'i have to', `i${A}ve got to`, 'i must',
      `we${A}ll`, 'we will', `we${A}re going to`, 'we are going to', 'we need to', 'we have to', `we${A}ve got to`, 'we must',
      'need to', 'must', 'remember to', 'remind me to', `don${A}t forget to`, 'do not forget to',
      'make sure to', 'make sure i', 'make sure we',
    ].join('|')
    + ')\\s+',
  'i'
);

const FOLLOW_UP = /^follow[\s-]?up\s+(?:with|on|about|regarding|re)\b/i;
const NEGATED = /^(?:not|never)\b/i;
const MAX_TASK_NAME_LENGTH = 255;

/** The task a line asks for, before dates are read, or null. */
export function taskTextFromNoteLine(line) {
  let text = stripLineStamp(line).trim().replace(BULLET, '').trim();
  if (!text) return null;

  let task = null;

  if (TAG.test(text)) {
    task = text.replace(TAG, '');
  } else {
    const marker = MARKERS.find((pattern) => pattern.test(text));
    if (marker) {
      task = text.replace(marker, '');
    } else if (FOLLOW_UP.test(text)) {
      task = text;
    } else if (COMMITMENT.test(text)) {
      task = text.replace(COMMITMENT, '');
    }
  }

  if (task === null) return null;

  task = task.trim().replace(/[.;,!]+$/, '').trim();
  if (NEGATED.test(task)) return null;
  if ((task.match(/\p{L}/gu) || []).length < 3) return null;
  if (task.length > MAX_TASK_NAME_LENGTH) return null;

  return task.charAt(0).toUpperCase() + task.slice(1);
}

/**
 * The task a finished note line asks for, with its due date, or null.
 * Customer tokens are refused (a project's tasks take the project's customer),
 * which the quick-add parser reports as an error, so that line is left alone.
 */
export function taskFromNoteLine(line, { baseDateKey = getLondonDateKey() } = {}) {
  const text = taskTextFromNoteLine(line);
  if (!text) return null;

  const parsed = parseQuickTask(text, { baseDateKey, customers: [], allowCreate: false });
  if (parsed.error || !parsed.name?.trim()) return null;

  const name = parsed.name.trim();
  return { name: name.charAt(0).toUpperCase() + name.slice(1), dueDate: parsed.dueDate };
}
