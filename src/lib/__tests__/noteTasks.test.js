import { describe, expect, it } from 'vitest';

import { taskFromNoteLine, taskTextFromNoteLine } from '@/lib/noteTasks';

const STAMP = '[17 Sep 2026 14:32] ';

describe('taskTextFromNoteLine: lines that are tasks', () => {
  it.each([
    ["I'll send the menu to Sam", 'Send the menu to Sam'],
    ['I’ll send the menu to Sam', 'Send the menu to Sam'],
    ['I will book the photographer', 'Book the photographer'],
    ["I'm going to draft the contract", 'Draft the contract'],
    ['I need to check the licence', 'Check the licence'],
    ['I have to call the brewery', 'Call the brewery'],
    ["We'll share the floor plan", 'Share the floor plan'],
    ['We need to confirm numbers', 'Confirm numbers'],
    ['Need to book photographer.', 'Book photographer'],
    ['Must order glasses', 'Order glasses'],
    ['Remember to invoice them', 'Invoice them'],
    ['Remind me to chase the deposit', 'Chase the deposit'],
    ["Don't forget to update the website", 'Update the website'],
    ['Make sure I send the rota', 'Send the rota'],
    ['TODO call Sam', 'Call Sam'],
    ['Todo: call Sam', 'Call Sam'],
    ['To do: price the wine list', 'Price the wine list'],
    ['Action: send menu', 'Send menu'],
    ['Action point - agree budget', 'Agree budget'],
    ['Next step: site visit', 'Site visit'],
    ['AP: send minutes', 'Send minutes'],
    ['[ ] book tasting', 'Book tasting'],
    ['- [ ] book tasting', 'Book tasting'],
    ['Follow up with Sam about prices', 'Follow up with Sam about prices'],
    ['follow-up on the quote', 'Follow-up on the quote'],
    ['Sam wants new prices #task', 'Sam wants new prices'],
    ['- I will send the menu', 'Send the menu'],
  ])('%s', (line, expected) => {
    expect(taskTextFromNoteLine(`${STAMP}${line}`)).toBe(expected);
  });
});

describe('taskTextFromNoteLine: lines that are not tasks', () => {
  it.each([
    'Called Sam about the menu',
    'Sam will send the menu',
    'They need to decide by Friday',
    'Task went well',
    'Action was agreed',
    'Today we covered pricing',
    'To do list reviewed',
    'Follow-up meeting booked for Tuesday',
    'I will not be at the tasting',
    "I'll",
    'Need to ?',
    'Email from Sam about prices',
    '',
  ])('%s', (line) => {
    expect(taskTextFromNoteLine(`${STAMP}${line}`)).toBeNull();
  });

  it('works on a line without a stamp', () => {
    expect(taskTextFromNoteLine("I'll send the menu")).toBe('Send the menu');
  });

  it('ignores a line too long to be a task name', () => {
    expect(taskTextFromNoteLine(`I'll ${'a'.repeat(300)}`)).toBeNull();
  });
});

describe('taskFromNoteLine', () => {
  // Thursday 17 September 2026.
  const baseDateKey = '2026-09-17';

  it('reads a date at the end the same way as quick add', () => {
    expect(taskFromNoteLine(`${STAMP}I'll send the menu by Friday`, { baseDateKey })).toEqual({
      name: 'Send the menu',
      dueDate: '2026-09-18',
    });
  });

  it('is due today with no date, as quick add is', () => {
    expect(taskFromNoteLine(`${STAMP}Need to book photographer`, { baseDateKey })).toEqual({
      name: 'Book photographer',
      dueDate: '2026-09-17',
    });
  });

  it('leaves a line naming a customer alone, since project tasks take the project customer', () => {
    expect(taskFromNoteLine(`${STAMP}I'll email @Acme`, { baseDateKey })).toBeNull();
  });

  it('returns null for a line that is not a task', () => {
    expect(taskFromNoteLine(`${STAMP}Called Sam`, { baseDateKey })).toBeNull();
  });
});
