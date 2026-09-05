import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '../route';
import { POST as batchNotes } from '../../notes/batch/route';
import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';

vi.mock('@/lib/authServer', () => ({ getAuthContext: vi.fn(async () => ({ session: { user: { id: 'u1' } } })) }));
vi.mock('@/lib/supabaseServiceRole', () => ({ getSupabaseServiceRole: vi.fn() }));
vi.mock('@/lib/rateLimiter', () => ({ getClientIdentifier: () => 'u1', checkRateLimit: () => ({ allowed: true }) }));

function database(notes, error = null) {
  const tables = { tasks: [], projects: [{ id: 'p1', user_id: 'u1', status: 'Completed' }], notes };
  return { from(table) {
    let data = tables[table];
    const chain = {
      select: () => chain, order: () => chain, gte: () => chain, lte: () => chain,
      eq(key, value) { data = data.filter(row => row[key] === value); return chain; },
      in(key, values) { data = data.filter(row => values.includes(row[key])); return chain; },
      or(expression) {
        const clauses = [...expression.matchAll(/(\w+)\.in\.\(([^)]+)\)/g)];
        data = data.filter(row => clauses.some(([, key, values]) => values.split(',').includes(row[key])));
        return chain;
      },
      then(resolve) { return Promise.resolve({ data, error: table === 'notes' ? error : null }).then(resolve); },
    };
    return chain;
  } };
}

const movedNote = { id: 'n1', user_id: 'u1', project_id: null, origin_project_id: 'p1', customer_id: 'c1', content: 'Moved note' };
beforeEach(() => vi.clearAllMocks());

describe('completed project notes', () => {
  it('includes moved notes in the report and allNotes exactly once', async () => {
    getSupabaseServiceRole.mockReturnValue(database([
      movedNote,
      { ...movedNote, id: 'n2', project_id: 'p1' },
      { ...movedNote, id: 'foreign', user_id: 'u2' },
    ]));
    const response = await GET(new Request('http://localhost/api/completed-items?startDate=2030-01-01&endDate=2030-12-31'));
    const result = await response.json();
    expect(response.status).toBe(200);
    expect(result.projects[0].notes.map(note => note.id)).toEqual(['n1', 'n2']);
    expect(result.allNotes.map(note => note.id)).toEqual(['n1', 'n2']);
  });

  it('includes origin notes in project batch results without duplicating matching parents', async () => {
    getSupabaseServiceRole.mockReturnValue(database([movedNote, { ...movedNote, id: 'n2', project_id: 'p1' }]));
    const response = await batchNotes(new Request('http://localhost/api/notes/batch', {
      method: 'POST', body: JSON.stringify({ projectIds: ['p1'] }),
    }));
    expect((await response.json()).p1.map(note => note.id)).toEqual(['n1', 'n2']);
  });

  it('fails visibly when notes cannot be loaded', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    getSupabaseServiceRole.mockReturnValue(database([], { message: 'Unavailable' }));
    const response = await GET(new Request('http://localhost/api/completed-items?startDate=2030-01-01&endDate=2030-12-31'));
    expect(response.status).toBe(500);
    expect((await response.json()).error).toBe('Failed to load project notes');
    log.mockRestore();
  });
});
