import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Contract test for the Phase 0 route consolidation.
 *
 * /api/projects used to export a collection-level PATCH and DELETE that wrote
 * straight to the projects table and never called projectLifecycleService. They
 * therefore skipped the task cascade, and would have skipped close-out capture,
 * note movement and the delete safeguards that come with customers. Two URLs for
 * one operation meant the resulting data depended on which one the caller used.
 *
 * apiClient always used /api/projects/[id] for both, so nothing in the app called
 * them. This test exists so they cannot quietly come back: a mutation handler
 * reintroduced on the collection route would bypass every safeguard silently, and
 * that is exactly the kind of regression a reviewer would not spot.
 */

function readRoute(relativePath) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

describe('/api/projects route surface', () => {
  const collectionRoute = readRoute('src/app/api/projects/route.js');
  const itemRoute = readRoute('src/app/api/projects/[id]/route.js');

  it('exports only GET and POST on the collection', () => {
    const exported = [...collectionRoute.matchAll(/export async function (\w+)\(/g)].map(
      (match) => match[1]
    );

    expect(exported.sort()).toEqual(['GET', 'POST']);
  });

  it('has no collection-level PATCH', () => {
    expect(collectionRoute).not.toMatch(/export async function PATCH\(/);
  });

  it('has no collection-level DELETE', () => {
    expect(collectionRoute).not.toMatch(/export async function DELETE\(/);
  });

  it('keeps PATCH and DELETE on the item route, which is the canonical path', () => {
    expect(itemRoute).toMatch(/export async function PATCH\(/);
    expect(itemRoute).toMatch(/export async function DELETE\(/);
  });

  it('routes the status cascade through projectLifecycleService, not inline writes', () => {
    // The cascade is the reason the item route is canonical. If this import
    // disappears, closing a project stops moving its tasks.
    expect(itemRoute).toMatch(/projectLifecycleService/);
  });

  it('records why the handlers were removed, so the next person does not re-add them', () => {
    expect(collectionRoute).toMatch(/projectLifecycleService/);
    expect(collectionRoute).toMatch(/\[id\]/);
  });
});
