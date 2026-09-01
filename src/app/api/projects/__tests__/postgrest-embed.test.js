import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Guard against a specific, verified PostgREST behaviour.
 *
 * projects.customer_id and tasks.customer_id are each half of a COMPOSITE
 * foreign key, (customer_id, user_id) -> customers(id, user_id). That is what
 * stops the database linking a customer to another user's row.
 *
 * PostgREST resolves an embed against a composite key by TABLE NAME
 * (`customers(id, name)`) but NOT by column hint (`customer:customer_id(name)`).
 * The column-hinted form returns 400 PGRST200 and fails the whole request, so
 * the page shows "Failed to load data" rather than merely missing a field.
 *
 * Verified against the live API on 2026-09-01:
 *   projects?select=id,customer:customer_id(name)  -> 400 PGRST200
 *   tasks?select=id,customers(id,name)             -> 200
 *
 * This bit once. It should not bite twice.
 */
/**
 * Source with comments stripped.
 *
 * The files deliberately explain this trap in prose, and a naive scan would
 * match the explanation and fail on a correct file. The guard has to look at
 * code only.
 */
function routeSource(path) {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const ROUTES = [
  'src/app/api/projects/route.js',
  'src/app/api/projects/[id]/route.js',
  'src/app/api/tasks/route.js',
  'src/services/customerService.js',
];

describe('PostgREST embeds against the composite customer key', () => {
  ROUTES.forEach((path) => {
    it(`${path} does not hint a customer embed on the column`, () => {
      const source = routeSource(path);
      // e.g. customer:customer_id(name) — resolves for a simple FK, 400s here.
      expect(source).not.toMatch(/:\s*customer_id\s*\(/);
    });
  });

  it('the projects list still exposes customer_name for the sidebar filter', () => {
    // Removing the embed must not quietly drop the field the filter reads.
    expect(routeSource('src/app/api/projects/route.js')).toMatch(/customer_name/);
  });

  it('the projects list resolves that name without an embed', () => {
    const source = routeSource('src/app/api/projects/route.js');
    expect(source).toMatch(/from\('customers'\)/);
  });
});
