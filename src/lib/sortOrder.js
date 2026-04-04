const GAP = 1000;

/**
 * Compute sort_order for inserting between two items.
 * @param {number|null} above - sort_order of the item above (null = inserting at top)
 * @param {number|null} below - sort_order of the item below (null = inserting at bottom)
 * @returns {number} The computed sort_order value
 */
export function computeSortOrder(above, below) {
  if (above == null && below == null) return GAP;
  if (above == null) return below - GAP;
  if (below == null) return above + GAP;
  return Math.floor((above + below) / 2);
}

/**
 * Check if a reindex is needed (gap between items is too small).
 * @param {number|null} above - sort_order of item above
 * @param {number|null} below - sort_order of item below
 * @returns {boolean} True if gap < 2 (midpoint would equal one of the boundaries)
 */
export function needsReindex(above, below) {
  if (above == null || below == null) return false;
  return (below - above) < 2;
}

/**
 * Redistribute sort_order values with standard gaps.
 * @param {Array<{id: string}>} items - Items in their current display order
 * @returns {Array<{id: string, sort_order: number}>} Items with new sort_order values
 */
export function reindex(items) {
  return items.map((item, index) => ({
    ...item,
    sort_order: (index + 1) * GAP,
  }));
}
