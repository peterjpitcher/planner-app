import { describe, expect, it } from 'vitest';

import { parseQuickTaskDate } from '../quickTaskDateParser';

const BASE_DATE = '2026-08-18'; // Tuesday

describe('parseQuickTaskDate', () => {
  it.each([
    [
      'Rennovate the recipes for Kim/MJ and send them the results on Monday',
      'Rennovate the recipes for Kim/MJ and send them the results',
      '2026-08-24',
    ],
    ['Chase Billy for x this Friday', 'Chase Billy for x', '2026-08-21'],
    ['Chase Billy for x next Friday', 'Chase Billy for x', '2026-08-28'],
    ['Chase Billy for y in a week', 'Chase Billy for y', '2026-08-25'],
    ['Chase Billy for z on September 1', 'Chase Billy for z', '2026-09-01'],
    ['Send the pack tomorrow', 'Send the pack', '2026-08-19'],
    ['Send the pack the day after tomorrow', 'Send the pack', '2026-08-20'],
    ['Review it in three days', 'Review it', '2026-08-21'],
    ['Book it in 2 weeks', 'Book it', '2026-09-01'],
    ['Book it in a fortnight', 'Book it', '2026-09-01'],
    ['Call them on 1st September', 'Call them', '2026-09-01'],
    ['Call them on the 1st of September', 'Call them', '2026-09-01'],
    ['Call them on 1/9', 'Call them', '2026-09-01'],
    ['Call them on 01/09/2027', 'Call them', '2027-09-01'],
    ['Call them at the end of this week', 'Call them', '2026-08-21'],
    ['Call them by the end of next week', 'Call them', '2026-08-28'],
    ['Finish it by the end of the month', 'Finish it', '2026-08-31'],
    ['Finish it at the end of next month', 'Finish it', '2026-09-30'],
    ['Call them a week on Monday', 'Call them', '2026-08-31'],
    ['Call them Monday week', 'Call them', '2026-08-31'],
    ['Call them on Monday.', 'Call them', '2026-08-24'],
    ['Call them (on Monday)', 'Call them', '2026-08-24'],
  ])('parses "%s"', (input, name, dueDate) => {
    expect(parseQuickTaskDate(input, BASE_DATE)).toEqual({ name, dueDate });
  });

  it('uses the end of a date range as the due date', () => {
    expect(parseQuickTaskDate('Run the campaign from 1 to 5 September', BASE_DATE)).toEqual({
      name: 'Run the campaign',
      dueDate: '2026-09-05',
    });
  });

  it('uses next year when an unqualified month and day have passed', () => {
    expect(parseQuickTaskDate('Renew it on January 5', BASE_DATE)).toEqual({
      name: 'Renew it',
      dueDate: '2027-01-05',
    });
  });

  it('honours an explicit year', () => {
    expect(parseQuickTaskDate('Renew it on January 5, 2028', BASE_DATE)).toEqual({
      name: 'Renew it',
      dueDate: '2028-01-05',
    });
  });

  it.each([
    'Discuss next steps with Friday team',
    'Write the Monday report',
    'Call Billy at 3pm',
    'Email May',
    'Do something on February 30',
  ])('leaves "%s" unchanged when it has no safe trailing date', (input) => {
    expect(parseQuickTaskDate(input, BASE_DATE)).toEqual({
      name: input,
      dueDate: BASE_DATE,
    });
  });
});

describe('parseQuickTaskDate: qualified dates', () => {
  it.each([
    ['Send the pack a week today', 'Send the pack', '2026-08-25'],
    ['Send the pack a week tomorrow', 'Send the pack', '2026-08-26'],
    ['Send the pack two weeks today', 'Send the pack', '2026-09-01'],
  ])('reads "%s" as a whole phrase', (input, name, dueDate) => {
    // These used to fall through to chrono, which matched only the trailing
    // "today"/"tomorrow" and saved a task called "Send the pack a week" due today.
    expect(parseQuickTaskDate(input, BASE_DATE)).toEqual({ name, dueDate });
  });

  it.each([
    ['Reply later today', 'Reply', '2026-08-18'],
    ['Send it end of play Friday', 'Send it', '2026-08-21'],
    ['Send the deck first thing Monday', 'Send the deck', '2026-08-24'],
    ['Ship it no later than Friday', 'Ship it', '2026-08-21'],
    ['Sort the invoices sometime next week', 'Sort the invoices', '2026-08-25'],
    ['Tidy the shed over the weekend', 'Tidy the shed', '2026-08-22'],
  ])('strips the qualifier in "%s" instead of gluing it to the name', (input, name, dueDate) => {
    expect(parseQuickTaskDate(input, BASE_DATE)).toEqual({ name, dueDate });
  });

  it.each([
    'Water the plants every Monday',
    'Check the logs each Friday',
    'Run the report every other Tuesday',
  ])('leaves "%s" alone rather than silently dropping the repeat', (input) => {
    // The parser does not set recurrence, so taking the date would lose it.
    expect(parseQuickTaskDate(input, BASE_DATE)).toEqual({ name: input, dueDate: BASE_DATE });
  });
});
