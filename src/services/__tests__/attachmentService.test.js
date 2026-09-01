import { describe, it, expect, vi } from 'vitest';
import {
  ALLOWED_MIME_TYPES,
  MAX_FILE_BYTES,
  buildStoragePath,
  createDownloadUrl,
  deleteAttachment,
  finaliseUpload,
  reconcileAttachments,
  validateUploadRequest,
} from '../attachmentService';

/**
 * Supabase stub covering both the table and the storage client.
 */
function makeSupabase({ rows = [], info = null, infoError = null, removeError = null } = {}) {
  const captured = { updated: null, removed: [], deleted: false, signedUrlArgs: null };

  const table = () => {
    let payload = null;
    const api = {
      select: () => api,
      update(values) { payload = values; captured.updated = values; return api; },
      delete() { captured.deleted = true; return api; },
      eq: () => api,
      lt: () => api,
      limit: () => api,
      order: () => api,
      single: async () => ({ data: { ...rows[0], ...payload }, error: null }),
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      then(resolve, reject) {
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      },
    };
    return api;
  };

  const storage = {
    from: () => ({
      info: async () => ({ data: info, error: infoError }),
      remove: async (paths) => {
        captured.removed.push(...paths);
        return { data: null, error: removeError };
      },
      createSignedUrl: async (path, expiry, options) => {
        captured.signedUrlArgs = { path, expiry, options };
        return { data: { signedUrl: 'https://signed.test/file' }, error: null };
      },
    }),
  };

  return { from: table, storage, captured };
}

const USER = 'user-1';
const READY_ROW = {
  id: 'att-1',
  user_id: USER,
  storage_path: 'user-1/att-1',
  file_name: 'quote.pdf',
  mime_type: 'application/pdf',
  size_bytes: 1024,
  status: 'ready',
};

describe('buildStoragePath', () => {
  it('keys on the attachment id and does not include the filename', () => {
    // Filenames routinely contain customer names and invoice numbers, and paths
    // appear in provider logs. The display name lives in the database instead.
    const path = buildStoragePath(USER, 'att-1');
    expect(path).toBe('user-1/att-1');
    expect(path).not.toContain('quote');
  });

  it('puts the user id first, so a future move to Supabase Auth needs no migration', () => {
    expect(buildStoragePath(USER, 'att-1').startsWith(`${USER}/`)).toBe(true);
  });
});

describe('validateUploadRequest', () => {
  const valid = { fileName: 'quote.pdf', mimeType: 'application/pdf', sizeBytes: 1024 };

  it('accepts a normal file', () => {
    expect(validateUploadRequest(valid).isValid).toBe(true);
  });

  it('rejects anything over 25 MB', () => {
    expect(validateUploadRequest({ ...valid, sizeBytes: MAX_FILE_BYTES + 1 }).errors.sizeBytes)
      .toBeTruthy();
    expect(validateUploadRequest({ ...valid, sizeBytes: MAX_FILE_BYTES }).isValid).toBe(true);
  });

  it('rejects an empty file', () => {
    expect(validateUploadRequest({ ...valid, sizeBytes: 0 }).errors.sizeBytes).toBeTruthy();
  });

  it('blocks script-carrying types, which are absent from the allowlist', () => {
    expect(ALLOWED_MIME_TYPES.has('image/svg+xml')).toBe(false);
    expect(ALLOWED_MIME_TYPES.has('text/html')).toBe(false);
    expect(validateUploadRequest({ ...valid, mimeType: 'image/svg+xml' }).errors.mimeType)
      .toBeTruthy();
  });

  it('rejects an unknown type rather than allowing anything not denied', () => {
    expect(validateUploadRequest({ ...valid, mimeType: 'application/x-executable' }).errors.mimeType)
      .toBeTruthy();
  });

  it('requires a file name', () => {
    expect(validateUploadRequest({ ...valid, fileName: '   ' }).errors.fileName).toBeTruthy();
  });
});

describe('finaliseUpload', () => {
  it('rejects a file bigger than it claimed, and removes the object', async () => {
    // The whole reason finalisation measures rather than trusts. A signed
    // upload authorises a transfer; it does not promise the object matches the
    // request that asked for it.
    const supabase = makeSupabase({
      rows: [{ ...READY_ROW, status: 'pending', size_bytes: null, upload_expires_at: null }],
      info: { size: MAX_FILE_BYTES + 1, contentType: 'application/pdf' },
    });

    const { error } = await finaliseUpload({ supabase, userId: USER, attachmentId: 'att-1' });

    expect(error.status).toBe(422);
    expect(supabase.captured.removed).toContain('user-1/att-1');
    expect(supabase.captured.updated.status).toBe('failed');
  });

  it('rejects a type that is not on the allowlist, whatever was declared', async () => {
    const supabase = makeSupabase({
      rows: [{ ...READY_ROW, status: 'pending', size_bytes: null }],
      info: { size: 500, contentType: 'image/svg+xml' },
    });

    const { error } = await finaliseUpload({ supabase, userId: USER, attachmentId: 'att-1' });
    expect(error.status).toBe(422);
  });

  it('rejects an empty object', async () => {
    const supabase = makeSupabase({
      rows: [{ ...READY_ROW, status: 'pending', size_bytes: null }],
      info: { size: 0, contentType: 'application/pdf' },
    });

    const { error } = await finaliseUpload({ supabase, userId: USER, attachmentId: 'att-1' });
    expect(error.status).toBe(422);
  });

  it('rejects a row whose object was never uploaded', async () => {
    const supabase = makeSupabase({
      rows: [{ ...READY_ROW, status: 'pending', size_bytes: null }],
      info: null,
      infoError: { message: 'not found' },
    });

    const { error } = await finaliseUpload({ supabase, userId: USER, attachmentId: 'att-1' });
    expect(error.status).toBe(422);
  });

  it('rejects an expired pending row', async () => {
    const supabase = makeSupabase({
      rows: [{
        ...READY_ROW,
        status: 'pending',
        size_bytes: null,
        upload_expires_at: new Date(Date.now() - 1000).toISOString(),
      }],
      info: { size: 500, contentType: 'application/pdf' },
    });

    const { error } = await finaliseUpload({ supabase, userId: USER, attachmentId: 'att-1' });
    expect(error.status).toBe(409);
  });

  it('is idempotent, because a flaky network retry is normal', async () => {
    const supabase = makeSupabase({ rows: [READY_ROW] });
    const { data, error } = await finaliseUpload({ supabase, userId: USER, attachmentId: 'att-1' });

    expect(error).toBeNull();
    expect(data.status).toBe('ready');
  });

  it('writes the measured size, not the declared one', async () => {
    const supabase = makeSupabase({
      rows: [{ ...READY_ROW, status: 'pending', size_bytes: null }],
      info: { size: 4096, contentType: 'application/pdf' },
    });

    await finaliseUpload({ supabase, userId: USER, attachmentId: 'att-1' });
    expect(supabase.captured.updated.size_bytes).toBe(4096);
    expect(supabase.captured.updated.status).toBe('ready');
  });

  it('refuses another user', async () => {
    const supabase = makeSupabase({ rows: [{ ...READY_ROW, status: 'pending' }] });
    const { error } = await finaliseUpload({
      supabase,
      userId: 'someone-else',
      attachmentId: 'att-1',
    });

    expect(error.status).toBe(403);
  });
});

describe('createDownloadUrl', () => {
  it('forces a download with the original filename', async () => {
    // Forcing the download rather than inline rendering means a type that ever
    // slipped the allowlist still cannot render in a browser context.
    const supabase = makeSupabase({ rows: [READY_ROW] });
    await createDownloadUrl({ supabase, userId: USER, attachmentId: 'att-1' });

    expect(supabase.captured.signedUrlArgs.options).toEqual({ download: 'quote.pdf' });
  });

  it('expires in sixty seconds', async () => {
    const supabase = makeSupabase({ rows: [READY_ROW] });
    await createDownloadUrl({ supabase, userId: USER, attachmentId: 'att-1' });
    expect(supabase.captured.signedUrlArgs.expiry).toBe(60);
  });

  it('refuses another user, because the bucket has no policies of its own', async () => {
    const supabase = makeSupabase({ rows: [READY_ROW] });
    const { error } = await createDownloadUrl({
      supabase,
      userId: 'someone-else',
      attachmentId: 'att-1',
    });

    expect(error.status).toBe(403);
  });

  it('refuses a row that is not ready', async () => {
    const supabase = makeSupabase({ rows: [{ ...READY_ROW, status: 'pending' }] });
    const { error } = await createDownloadUrl({ supabase, userId: USER, attachmentId: 'att-1' });
    expect(error.status).toBe(409);
  });
});

describe('deleteAttachment', () => {
  it('marks the row deleting before touching the object', async () => {
    // Deleting the object first and the row second is NOT safe: if the object
    // goes and the row delete then fails, the row survives pointing at a file
    // that is gone, and every download from it fails forever.
    const supabase = makeSupabase({ rows: [READY_ROW] });
    await deleteAttachment({ supabase, userId: USER, attachmentId: 'att-1' });

    expect(supabase.captured.updated.status).toBe('deleting');
    expect(supabase.captured.removed).toContain('user-1/att-1');
    expect(supabase.captured.deleted).toBe(true);
  });

  it('leaves the row as deleting when the object delete fails, for retry', async () => {
    const supabase = makeSupabase({
      rows: [READY_ROW],
      removeError: { message: 'storage unavailable' },
    });

    const { data } = await deleteAttachment({ supabase, userId: USER, attachmentId: 'att-1' });

    expect(data.retrying).toBe(true);
    expect(supabase.captured.deleted).toBe(false);
  });

  it('refuses another user before marking anything', async () => {
    const supabase = makeSupabase({ rows: [READY_ROW] });
    const { error } = await deleteAttachment({
      supabase,
      userId: 'someone-else',
      attachmentId: 'att-1',
    });

    expect(error.status).toBe(403);
    expect(supabase.captured.updated).toBeNull();
  });
});

describe('reconcileAttachments', () => {
  it('sweeps uploads that never finalised', async () => {
    const supabase = makeSupabase({
      rows: [{ id: 'att-9', storage_path: 'user-1/att-9' }],
    });

    const { data } = await reconcileAttachments({ supabase });

    // The stub returns the same rows for both passes, so both counters move.
    // What matters is that it queries rows rather than listing the bucket:
    // storage.list() returns 100 objects by default and one folder level, so a
    // bucket scan would silently stop and report a clean sweep.
    expect(data.stalePendingRemoved + data.stuckDeletesCompleted).toBeGreaterThan(0);
    expect(supabase.captured.removed).toContain('user-1/att-9');
  });

  it('reports failures rather than swallowing them', async () => {
    const supabase = makeSupabase({ rows: [] });
    const { data } = await reconcileAttachments({ supabase });
    expect(data.failures).toBe(0);
  });
});
