import { describe, expect, it } from 'vitest';

import {
  insertStampedLine,
  noteLineStamp,
  stampFirstLine,
  withoutTrailingEmptyStamps,
} from '@/lib/noteStamps';

describe('withoutTrailingEmptyStamps', () => {
  it('drops stamp-only and blank lines from the end', () => {
    expect(
      withoutTrailingEmptyStamps('[17 Sep 2026 14:32] Called Sam\n[17 Sep 2026 14:40] \n\n[17 Sep 2026 14:41] ')
    ).toBe('[17 Sep 2026 14:32] Called Sam');
  });

  it('keeps empty stamped lines in the middle, which are spacing', () => {
    const value = '[17 Sep 2026 14:32] One\n[17 Sep 2026 14:33] \n[17 Sep 2026 14:34] Two';
    expect(withoutTrailingEmptyStamps(value)).toBe(value);
  });

  it('reduces a stamp on its own to nothing', () => {
    expect(withoutTrailingEmptyStamps('[17 Sep 2026 14:32] ')).toBe('');
  });

  it('leaves a line that only looks like it starts with a stamp', () => {
    expect(withoutTrailingEmptyStamps('[17 Sep 2026 14:32] ok')).toBe('[17 Sep 2026 14:32] ok');
  });
});

describe('noteLineStamp', () => {
  it('uses London summer time, not the runtime zone', () => {
    // 13:32 UTC is 14:32 in London during British Summer Time.
    expect(noteLineStamp(new Date('2026-09-17T13:32:00Z'))).toBe('[17 Sep 2026 14:32] ');
  });

  it('uses GMT in winter', () => {
    expect(noteLineStamp(new Date('2026-01-05T09:05:00Z'))).toBe('[5 Jan 2026 09:05] ');
  });

  it('takes the London date either side of midnight', () => {
    // 23:30 UTC on 17 September is 00:30 on the 18th in London.
    expect(noteLineStamp(new Date('2026-09-17T23:30:00Z'))).toBe('[18 Sep 2026 00:30] ');
  });
});

describe('stampFirstLine', () => {
  const stamp = '[17 Sep 2026 14:32] ';

  it('stamps the first character typed into an empty draft', () => {
    expect(stampFirstLine('', 'C', stamp)).toBe('[17 Sep 2026 14:32] C');
  });

  it('stamps a paste into an empty draft once, at the front', () => {
    expect(stampFirstLine('', 'line one\nline two', stamp)).toBe('[17 Sep 2026 14:32] line one\nline two');
  });

  it('leaves a draft that already has text alone', () => {
    expect(stampFirstLine('[17 Sep 2026 14:32] Ca', '[17 Sep 2026 14:32] Cal', stamp)).toBe(
      '[17 Sep 2026 14:32] Cal'
    );
  });

  it('does not stamp a cleared draft', () => {
    expect(stampFirstLine('abc', '', stamp)).toBe('');
  });
});

describe('insertStampedLine', () => {
  const stamp = '[17 Sep 2026 14:40] ';

  it('starts a stamped line at the end', () => {
    const value = '[17 Sep 2026 14:32] Called Sam';
    expect(insertStampedLine(value, value.length, value.length, stamp)).toEqual({
      value: '[17 Sep 2026 14:32] Called Sam\n[17 Sep 2026 14:40] ',
      caret: value.length + 1 + stamp.length,
    });
  });

  it('splits a line in the middle and puts the cursor after the new stamp', () => {
    const result = insertStampedLine('abcdef', 3, 3, stamp);
    expect(result.value).toBe('abc\n[17 Sep 2026 14:40] def');
    expect(result.caret).toBe(4 + stamp.length);
  });

  it('replaces a selection', () => {
    expect(insertStampedLine('abcdef', 1, 5, stamp).value).toBe('a\n[17 Sep 2026 14:40] f');
  });

  it('stamps an empty box without a leading line break', () => {
    expect(insertStampedLine('', 0, 0, stamp)).toEqual({ value: stamp, caret: stamp.length });
  });

  it('refuses to pass the length cap', () => {
    expect(insertStampedLine('abc', 3, 3, stamp, 10)).toBeNull();
  });
});
