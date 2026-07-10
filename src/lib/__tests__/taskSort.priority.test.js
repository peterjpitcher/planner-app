import { describe, it, expect } from 'vitest';
import { compareTasksByPriority, chipRank, sortTasksByPriority } from '../taskSort';
import { CHIP_VALUES } from '../constants';

// Fixed reference day for deterministic assertions.
const TODAY = '2026-07-10';
const TOMORROW = '2026-07-11';
const opts = { todayKey: TODAY };

describe('chipRank', () => {
  it('should rank chips in the documented hierarchy', () => {
    expect(chipRank([CHIP_VALUES.BLOCKS_OTHERS])).toBe(0);
    expect(chipRank([CHIP_VALUES.URGENT])).toBe(1);
    expect(chipRank([CHIP_VALUES.HIGH_IMPACT])).toBe(2);
    expect(chipRank([CHIP_VALUES.ONLY_I_CAN])).toBe(3);
    expect(chipRank([CHIP_VALUES.STRESS_RELIEF])).toBe(4);
  });

  it('should rank a task with no chips last', () => {
    expect(chipRank([])).toBe(5);
    expect(chipRank(null)).toBe(5);
    expect(chipRank(undefined)).toBe(5);
  });

  it('should use the highest-ranked chip when several are present', () => {
    expect(chipRank([CHIP_VALUES.STRESS_RELIEF, CHIP_VALUES.BLOCKS_OTHERS])).toBe(0);
    expect(chipRank([CHIP_VALUES.ONLY_I_CAN, CHIP_VALUES.URGENT])).toBe(1);
  });

  it('should ignore unrecognised chip strings', () => {
    expect(chipRank(['not_a_real_chip'])).toBe(5);
    expect(chipRank(['not_a_real_chip', CHIP_VALUES.HIGH_IMPACT])).toBe(2);
  });
});

describe('compareTasksByPriority — date bands (tiers a & b)', () => {
  it('should rank overdue tasks above tasks due today', () => {
    const overdue = { due_date: '2026-07-05' };
    const dueToday = { due_date: TODAY };
    expect(compareTasksByPriority(overdue, dueToday, opts)).toBeLessThan(0);
  });

  it('should order overdue tasks by earlier due_date first', () => {
    const older = { due_date: '2026-07-01' };
    const newer = { due_date: '2026-07-05' };
    expect(compareTasksByPriority(older, newer, opts)).toBeLessThan(0);
  });

  it('should rank due today/tomorrow above later-dated tasks', () => {
    const tomorrow = { due_date: TOMORROW };
    const later = { due_date: '2026-07-20' };
    expect(compareTasksByPriority(tomorrow, later, opts)).toBeLessThan(0);
  });

  it('should rank due today/tomorrow above undated tasks', () => {
    const today = { due_date: TODAY };
    const undated = { due_date: null };
    expect(compareTasksByPriority(today, undated, opts)).toBeLessThan(0);
  });

  it('should rank an overdue task above an undated task carrying a top chip', () => {
    const overdue = { due_date: '2026-07-05', chips: [] };
    const undatedTopChip = { due_date: null, chips: [CHIP_VALUES.BLOCKS_OTHERS] };
    expect(compareTasksByPriority(overdue, undatedTopChip, opts)).toBeLessThan(0);
  });
});

describe('compareTasksByPriority — chip tier (tier c)', () => {
  // Both undated so the date band is equal and chip tier decides.
  it('should order blocks_others above urgent', () => {
    const a = { due_date: null, chips: [CHIP_VALUES.BLOCKS_OTHERS] };
    const b = { due_date: null, chips: [CHIP_VALUES.URGENT] };
    expect(compareTasksByPriority(a, b, opts)).toBeLessThan(0);
  });

  it('should order urgent above high_impact', () => {
    const a = { due_date: null, chips: [CHIP_VALUES.URGENT] };
    const b = { due_date: null, chips: [CHIP_VALUES.HIGH_IMPACT] };
    expect(compareTasksByPriority(a, b, opts)).toBeLessThan(0);
  });

  it('should order only_i_can above stress_relief', () => {
    const a = { due_date: null, chips: [CHIP_VALUES.ONLY_I_CAN] };
    const b = { due_date: null, chips: [CHIP_VALUES.STRESS_RELIEF] };
    expect(compareTasksByPriority(a, b, opts)).toBeLessThan(0);
  });

  it('should order a chipped task above one with no chip', () => {
    const a = { due_date: null, chips: [CHIP_VALUES.STRESS_RELIEF] };
    const b = { due_date: null, chips: [] };
    expect(compareTasksByPriority(a, b, opts)).toBeLessThan(0);
  });

  it('should let chip tier decide within the today/tomorrow band (not today-vs-tomorrow)', () => {
    const tomorrowTopChip = { due_date: TOMORROW, chips: [CHIP_VALUES.BLOCKS_OTHERS] };
    const todayNoChip = { due_date: TODAY, chips: [] };
    // Same band → the higher chip (tomorrow, blocks_others) wins.
    expect(compareTasksByPriority(tomorrowTopChip, todayNoChip, opts)).toBeLessThan(0);
  });
});

describe('compareTasksByPriority — age in state (tier d)', () => {
  it('should surface the longer-waiting task (older entered_state_at) first', () => {
    const older = { due_date: null, chips: [], entered_state_at: '2026-06-01T10:00:00Z' };
    const newer = { due_date: null, chips: [], entered_state_at: '2026-07-01T10:00:00Z' };
    expect(compareTasksByPriority(older, newer, opts)).toBeLessThan(0);
  });

  it('should rank a task with a known entered_state_at above one with none', () => {
    const known = { due_date: null, chips: [], entered_state_at: '2026-06-01T10:00:00Z' };
    const unknown = { due_date: null, chips: [], entered_state_at: null };
    expect(compareTasksByPriority(known, unknown, opts)).toBeLessThan(0);
  });
});

describe('compareTasksByPriority — tiebreakers (tier e)', () => {
  it('should fall back to sort_order ascending', () => {
    const base = { due_date: null, chips: [], entered_state_at: '2026-06-01T10:00:00Z' };
    const a = { ...base, sort_order: 100 };
    const b = { ...base, sort_order: 200 };
    expect(compareTasksByPriority(a, b, opts)).toBeLessThan(0);
  });

  it('should treat null sort_order as last', () => {
    const base = { due_date: null, chips: [], entered_state_at: '2026-06-01T10:00:00Z' };
    const a = { ...base, sort_order: null };
    const b = { ...base, sort_order: 100 };
    expect(compareTasksByPriority(a, b, opts)).toBeGreaterThan(0);
  });

  it('should fall back to created_at ascending as the final tiebreaker', () => {
    const base = { due_date: null, chips: [], entered_state_at: '2026-06-01T10:00:00Z', sort_order: 100 };
    const a = { ...base, created_at: '2026-01-01T00:00:00Z' };
    const b = { ...base, created_at: '2026-02-01T00:00:00Z' };
    expect(compareTasksByPriority(a, b, opts)).toBeLessThan(0);
  });
});

describe('compareTasksByPriority — properties', () => {
  it('should be antisymmetric for a representative pair', () => {
    const a = { due_date: '2026-07-05', chips: [CHIP_VALUES.URGENT] };
    const b = { due_date: TODAY, chips: [CHIP_VALUES.BLOCKS_OTHERS] };
    expect(Math.sign(compareTasksByPriority(a, b, opts))).toBe(-Math.sign(compareTasksByPriority(b, a, opts)));
  });

  it('should not throw when todayKey is omitted (defaults to London today)', () => {
    const a = { due_date: null, chips: [] };
    const b = { due_date: null, chips: [] };
    expect(typeof compareTasksByPriority(a, b)).toBe('number');
  });

  it('should produce the full ranking through sortTasksByPriority', () => {
    const overdue = { id: 'overdue', due_date: '2026-07-01', chips: [] };
    const dueTodayTopChip = { id: 'today', due_date: TODAY, chips: [CHIP_VALUES.BLOCKS_OTHERS] };
    const undatedChipped = { id: 'undated-chip', due_date: null, chips: [CHIP_VALUES.HIGH_IMPACT] };
    const undatedPlain = { id: 'undated-plain', due_date: null, chips: [] };

    const ordered = sortTasksByPriority(
      [undatedPlain, undatedChipped, dueTodayTopChip, overdue],
      opts,
    ).map((t) => t.id);

    expect(ordered).toEqual(['overdue', 'today', 'undated-chip', 'undated-plain']);
  });
});
