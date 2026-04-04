import { describe, it, expect } from 'vitest';
import { computeSortOrder, needsReindex, reindex } from '../sortOrder';

describe('computeSortOrder', () => {
  it('inserts between two items at midpoint', () => {
    expect(computeSortOrder(1000, 3000)).toBe(2000);
  });
  it('inserts at top with -1000 offset', () => {
    expect(computeSortOrder(null, 1000)).toBe(0);
  });
  it('inserts at bottom with +1000 offset', () => {
    expect(computeSortOrder(5000, null)).toBe(6000);
  });
  it('inserts into empty list at 1000', () => {
    expect(computeSortOrder(null, null)).toBe(1000);
  });
  it('handles adjacent items', () => {
    expect(computeSortOrder(1000, 1002)).toBe(1001);
  });
});

describe('needsReindex', () => {
  it('returns true when gap is less than 1', () => {
    expect(needsReindex(1000, 1001)).toBe(true);
  });
  it('returns false when gap is sufficient', () => {
    expect(needsReindex(1000, 3000)).toBe(false);
  });
  it('returns false for null boundaries', () => {
    expect(needsReindex(null, 1000)).toBe(false);
    expect(needsReindex(1000, null)).toBe(false);
  });
});

describe('reindex', () => {
  it('redistributes items with 1000 gaps', () => {
    const items = [{id: 'a'}, {id: 'b'}, {id: 'c'}];
    const result = reindex(items);
    expect(result).toEqual([
      {id: 'a', sort_order: 1000},
      {id: 'b', sort_order: 2000},
      {id: 'c', sort_order: 3000},
    ]);
  });
  it('handles single item', () => {
    const result = reindex([{id: 'x'}]);
    expect(result).toEqual([{id: 'x', sort_order: 1000}]);
  });
  it('handles empty array', () => {
    expect(reindex([])).toEqual([]);
  });
});
