import { describe, it, expect } from 'vitest';
import { compareBacklogTasks } from '../taskSort';

describe('compareBacklogTasks', () => {
  it('should sort tasks with due dates before tasks without', () => {
    const a = { due_date: '2026-04-15', sort_order: 100 };
    const b = { due_date: null, sort_order: 50 };
    expect(compareBacklogTasks(a, b)).toBeLessThan(0);
  });

  it('should sort earlier due dates first', () => {
    const a = { due_date: '2026-04-15', sort_order: 100 };
    const b = { due_date: '2026-04-20', sort_order: 50 };
    expect(compareBacklogTasks(a, b)).toBeLessThan(0);
  });

  it('should use sort_order as tiebreaker for same due date', () => {
    const a = { due_date: '2026-04-15', sort_order: 200 };
    const b = { due_date: '2026-04-15', sort_order: 100 };
    expect(compareBacklogTasks(a, b)).toBeGreaterThan(0);
  });

  it('should use sort_order for two undated tasks', () => {
    const a = { due_date: null, sort_order: 50 };
    const b = { due_date: null, sort_order: 100 };
    expect(compareBacklogTasks(a, b)).toBeLessThan(0);
  });

  it('should use created_at as final tiebreaker', () => {
    const a = { due_date: null, sort_order: 100, created_at: '2026-04-10T10:00:00Z' };
    const b = { due_date: null, sort_order: 100, created_at: '2026-04-12T10:00:00Z' };
    expect(compareBacklogTasks(a, b)).toBeLessThan(0);
  });

  it('should handle null sort_order as Infinity', () => {
    const a = { due_date: '2026-04-15', sort_order: null };
    const b = { due_date: '2026-04-15', sort_order: 100 };
    expect(compareBacklogTasks(a, b)).toBeGreaterThan(0);
  });
});
