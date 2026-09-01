// src/services/attachmentService.js
//
// File attachments.
//
// Two constraints shape all of this and neither is negotiable.
//
// 1. Auth is NextAuth, not Supabase Auth, so there is no Supabase JWT for the
//    logged-in user and auth.uid() is NULL inside a storage policy. Every
//    documented Supabase storage pattern assumes otherwise. The bucket is
//    private with no policies at all, and security rests on the NextAuth
//    session check plus an explicit user_id check, exactly as it does for
//    every table here.
//
// 2. Vercel functions cap request and response bodies at 4.5 MB and return 413
//    above it. It is an infrastructure limit that vercel.json cannot raise, so
//    the file cannot travel through a route at all. The browser uploads
//    straight to Supabase Storage with a signed URL the server mints.

export const ATTACHMENT_BUCKET = 'attachments';

/** 25 MB. Above a slide deck, below where signed uploads need TUS. */
export const MAX_FILE_BYTES = 26214400;

/** Per user, checked when the upload URL is issued. */
export const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;

export const MAX_PER_PARENT = 50;

/**
 * Positive allowlist, not a denylist.
 *
 * text/html and image/svg+xml are absent deliberately: both can carry script.
 * They would run on the Supabase origin rather than the app's, so they cannot
 * reach app cookies, but there is no reason to host them.
 */
export const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/heic',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/csv',
  'text/plain',
  'application/zip',
  'application/x-zip-compressed',
  'message/rfc822',
  'application/vnd.ms-outlook',
]);

const PARENT_TABLES = {
  customer: ['customers', 'customer_id'],
  project: ['projects', 'project_id'],
  task: ['tasks', 'task_id'],
  note: ['notes', 'note_id'],
};

const ATTACHMENT_COLUMNS =
  'id, user_id, customer_id, project_id, task_id, note_id, origin_project_id, ' +
  'storage_path, file_name, mime_type, size_bytes, status, upload_expires_at, ' +
  'ready_at, context_label, created_at';

/**
 * The storage key for an attachment.
 *
 * Two deliberate choices. The user_id prefix is forward compatibility: if this
 * app ever moves to Supabase Auth, the standard folder policy can be added with
 * no data migration. And the original filename is NOT in the path, because
 * filenames routinely contain customer names and invoice numbers, and paths
 * appear in provider logs. The display name lives in file_name and is applied
 * at download time.
 *
 * @param {string} userId
 * @param {string} attachmentId
 * @returns {string}
 */
export function buildStoragePath(userId, attachmentId) {
  return `${userId}/${attachmentId}`;
}

/**
 * Check a declared upload before issuing a URL.
 *
 * @returns {{isValid: boolean, errors: Object}}
 */
export function validateUploadRequest({ fileName, mimeType, sizeBytes }) {
  const errors = {};

  if (!fileName || String(fileName).trim().length === 0) {
    errors.fileName = 'A file name is required';
  } else if (String(fileName).length > 255) {
    errors.fileName = 'File name must be 255 characters or fewer';
  }

  if (!mimeType || !ALLOWED_MIME_TYPES.has(mimeType)) {
    errors.mimeType = 'That file type is not accepted';
  }

  const size = Number(sizeBytes);
  if (!Number.isFinite(size) || size <= 0) {
    errors.sizeBytes = 'A file size is required';
  } else if (size > MAX_FILE_BYTES) {
    errors.sizeBytes = 'Files must be 25 MB or smaller';
  }

  return { isValid: Object.keys(errors).length === 0, errors };
}

async function assertParentOwned({ supabase, userId, parentType, parentId }) {
  const entry = PARENT_TABLES[parentType];
  if (!entry) return { status: 400, message: 'Unknown parent type' };

  const [table] = entry;
  const { data, error } = await supabase
    .from(table)
    .select('user_id')
    .eq('id', parentId)
    .maybeSingle();

  if (error || !data) return { status: 404, message: 'Parent not found' };
  if (data.user_id !== userId) return { status: 403, message: 'Forbidden' };
  return null;
}

/**
 * Step one of three: create the pending row and mint a signed upload URL.
 *
 * The row IS the authorisation record. It holds the server-generated path, the
 * intended parent, the declared metadata and an expiry, so nothing about the
 * upload has to be taken on the client's word afterwards.
 *
 * @returns {Promise<{data: Object|null, error: Object|null}>}
 */
export async function createUploadUrl({ supabase, userId, parentType, parentId, fileName, mimeType, sizeBytes }) {
  const validation = validateUploadRequest({ fileName, mimeType, sizeBytes });
  if (!validation.isValid) {
    return { data: null, error: { status: 400, message: 'Validation failed', details: validation.errors } };
  }

  const ownerError = await assertParentOwned({ supabase, userId, parentType, parentId });
  if (ownerError) return { data: null, error: ownerError };

  const [, column] = PARENT_TABLES[parentType];

  const { count: parentCount } = await supabase
    .from('attachments')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq(column, parentId)
    .eq('status', 'ready');

  if ((parentCount || 0) >= MAX_PER_PARENT) {
    return { data: null, error: { status: 400, message: `Up to ${MAX_PER_PARENT} files per item.` } };
  }

  const { data: existing } = await supabase
    .from('attachments')
    .select('size_bytes')
    .eq('user_id', userId)
    .eq('status', 'ready');

  const used = (existing || []).reduce((total, row) => total + Number(row.size_bytes || 0), 0);
  if (used + Number(sizeBytes) > MAX_TOTAL_BYTES) {
    return { data: null, error: { status: 400, message: 'That would exceed your 2 GB storage limit.' } };
  }

  const { data: row, error: insertError } = await supabase
    .from('attachments')
    .insert({
      user_id: userId,
      [column]: parentId,
      // Placeholder, replaced immediately below once the id exists. The column
      // is NOT NULL and UNIQUE, so it cannot simply be left out.
      storage_path: `pending/${crypto.randomUUID()}`,
      file_name: String(fileName).trim(),
      mime_type: mimeType,
      status: 'pending',
      upload_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    })
    .select(ATTACHMENT_COLUMNS)
    .single();

  if (insertError) {
    return { data: null, error: { status: 500, message: insertError.message } };
  }

  const storagePath = buildStoragePath(userId, row.id);

  const { error: pathError } = await supabase
    .from('attachments')
    .update({ storage_path: storagePath })
    .eq('id', row.id);

  if (pathError) {
    return { data: null, error: { status: 500, message: pathError.message } };
  }

  const { data: signed, error: signError } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .createSignedUploadUrl(storagePath);

  if (signError) {
    await supabase.from('attachments').delete().eq('id', row.id);
    return { data: null, error: { status: 500, message: signError.message } };
  }

  return {
    data: {
      attachmentId: row.id,
      path: storagePath,
      token: signed.token,
      signedUrl: signed.signedUrl,
    },
    error: null,
  };
}

/**
 * Step three: measure the real object and mark the row ready.
 *
 * A signed upload authorises a transfer, it does not promise the finished
 * object matches the JSON that asked for it. Without measuring here, a client
 * could declare 1 MB and upload 500 MB, or declare a PDF and upload anything,
 * and both the size cap and the MIME allowlist would be decorative.
 *
 * Idempotent: finalising an already-ready row returns it rather than erroring,
 * because a flaky network retry is normal.
 *
 * @returns {Promise<{data: Object|null, error: Object|null}>}
 */
export async function finaliseUpload({ supabase, userId, attachmentId }) {
  const { data: row, error: loadError } = await supabase
    .from('attachments')
    .select(ATTACHMENT_COLUMNS)
    .eq('id', attachmentId)
    .maybeSingle();

  if (loadError) return { data: null, error: { status: 500, message: loadError.message } };
  if (!row) return { data: null, error: { status: 404, message: 'Attachment not found' } };
  if (row.user_id !== userId) return { data: null, error: { status: 403, message: 'Forbidden' } };

  if (row.status === 'ready') return { data: row, error: null };
  if (row.status !== 'pending') {
    return { data: null, error: { status: 409, message: 'This upload is no longer pending' } };
  }
  if (row.upload_expires_at && new Date(row.upload_expires_at) < new Date()) {
    return { data: null, error: { status: 409, message: 'That upload link expired. Try again.' } };
  }

  const { data: info, error: infoError } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .info(row.storage_path);

  if (infoError || !info) {
    return { data: null, error: { status: 422, message: 'No file was uploaded for this attachment' } };
  }

  const actualSize = Number(info.size ?? info.contentLength ?? 0);
  const actualType = info.contentType || info.mimetype || null;

  const problems = [];
  if (!Number.isFinite(actualSize) || actualSize <= 0) problems.push('the file is empty');
  if (actualSize > MAX_FILE_BYTES) problems.push('the file is larger than 25 MB');
  if (actualType && !ALLOWED_MIME_TYPES.has(actualType)) problems.push('that file type is not accepted');

  if (problems.length > 0) {
    // The object failed validation, so it must not be left sitting in the
    // bucket consuming quota for a row nobody can use.
    await supabase.storage.from(ATTACHMENT_BUCKET).remove([row.storage_path]);
    await supabase
      .from('attachments')
      .update({ status: 'failed', last_error: problems.join(', ') })
      .eq('id', attachmentId);

    return { data: null, error: { status: 422, message: `Upload rejected: ${problems.join(', ')}.` } };
  }

  const { data, error } = await supabase
    .from('attachments')
    .update({
      status: 'ready',
      size_bytes: actualSize,
      mime_type: actualType || row.mime_type,
      ready_at: new Date().toISOString(),
      last_error: null,
    })
    .eq('id', attachmentId)
    .eq('user_id', userId)
    .select(ATTACHMENT_COLUMNS)
    .single();

  if (error) return { data: null, error: { status: 500, message: error.message } };
  return { data, error: null };
}

/**
 * Files for one parent. Only ready rows: a pending or failed one is not a file
 * anyone can open.
 */
export async function listAttachments({ supabase, userId, parentType, parentId }) {
  const entry = PARENT_TABLES[parentType];
  if (!entry) return { data: null, error: { status: 400, message: 'Unknown parent type' } };

  const [, column] = entry;

  const { data, error } = await supabase
    .from('attachments')
    .select(ATTACHMENT_COLUMNS)
    .eq('user_id', userId)
    .eq(column, parentId)
    .eq('status', 'ready')
    .order('created_at', { ascending: false });

  if (error) return { data: null, error: { status: 500, message: error.message } };
  return { data: data || [], error: null };
}

/**
 * A short-lived download URL.
 *
 * The download option forces the original filename and a download rather than
 * inline rendering, so a file type that ever slipped the allowlist still cannot
 * render in a browser context.
 */
export async function createDownloadUrl({ supabase, userId, attachmentId }) {
  const { data: row, error: loadError } = await supabase
    .from('attachments')
    .select(ATTACHMENT_COLUMNS)
    .eq('id', attachmentId)
    .maybeSingle();

  if (loadError) return { data: null, error: { status: 500, message: loadError.message } };
  if (!row) return { data: null, error: { status: 404, message: 'Attachment not found' } };
  if (row.user_id !== userId) return { data: null, error: { status: 403, message: 'Forbidden' } };
  if (row.status !== 'ready') {
    return { data: null, error: { status: 409, message: 'That file is not ready' } };
  }

  const { data, error } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .createSignedUrl(row.storage_path, 60, { download: row.file_name });

  if (error) return { data: null, error: { status: 500, message: error.message } };
  return { data: { url: data.signedUrl, fileName: row.file_name }, error: null };
}

/**
 * Delete a file.
 *
 * Two phases, not an ordering trick. An earlier design deleted the object first
 * and the row second, claiming a failure would leave a recoverable row. It
 * would not: if the object delete succeeds and the row delete then fails, the
 * row survives pointing at a file that is already gone, and every download from
 * it fails forever. The database and object storage cannot share a transaction,
 * so ordering alone cannot fix that.
 *
 * Instead the row is marked deleting and committed (so it disappears from the
 * UI immediately), then the object goes, then the row. A failure at either
 * later step leaves a deleting row for reconciliation to retry.
 */
export async function deleteAttachment({ supabase, userId, attachmentId }) {
  const { data: row, error: loadError } = await supabase
    .from('attachments')
    .select(ATTACHMENT_COLUMNS)
    .eq('id', attachmentId)
    .maybeSingle();

  if (loadError) return { data: null, error: { status: 500, message: loadError.message } };
  if (!row) return { data: null, error: { status: 404, message: 'Attachment not found' } };
  if (row.user_id !== userId) return { data: null, error: { status: 403, message: 'Forbidden' } };

  const { error: markError } = await supabase
    .from('attachments')
    .update({ status: 'deleting', deleting_at: new Date().toISOString() })
    .eq('id', attachmentId)
    .eq('user_id', userId);

  if (markError) return { data: null, error: { status: 500, message: markError.message } };

  const { error: objectError } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .remove([row.storage_path]);

  if (objectError) {
    // Left as deleting on purpose. Reconciliation retries it, and the file is
    // already hidden from the UI, so this is not a user-facing failure.
    return { data: { deleted: false, retrying: true }, error: null };
  }

  await supabase.from('attachments').delete().eq('id', attachmentId).eq('user_id', userId);
  return { data: { deleted: true }, error: null };
}

/**
 * Sweep up after uploads that never finished and deletes that never completed.
 *
 * Database driven, not a bucket scan. storage.list() returns 100 objects by
 * default and lists a single folder level, so "list the bucket and compare"
 * would silently stop after 100 rows and never recurse into the per-user
 * folders. Querying the rows instead gives bounded batches that cannot outgrow
 * a function timeout.
 *
 * @returns {Promise<{data: Object, error: Object|null}>}
 */
export async function reconcileAttachments({ supabase, now = new Date() }) {
  const result = { stalePendingRemoved: 0, stuckDeletesCompleted: 0, failures: 0 };

  // Pending uploads whose hour is up. The expiry is the grace period, so an
  // in-flight upload is never swept.
  const { data: stale } = await supabase
    .from('attachments')
    .select('id, storage_path')
    .eq('status', 'pending')
    .lt('upload_expires_at', now.toISOString())
    .limit(200);

  for (const row of stale || []) {
    try {
      await supabase.storage.from(ATTACHMENT_BUCKET).remove([row.storage_path]);
      await supabase.from('attachments').delete().eq('id', row.id);
      result.stalePendingRemoved += 1;
    } catch {
      result.failures += 1;
    }
  }

  // Deletes that got as far as the marker and no further.
  const cutoff = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const { data: stuck } = await supabase
    .from('attachments')
    .select('id, storage_path')
    .eq('status', 'deleting')
    .lt('deleting_at', cutoff)
    .limit(200);

  for (const row of stuck || []) {
    try {
      await supabase.storage.from(ATTACHMENT_BUCKET).remove([row.storage_path]);
      await supabase.from('attachments').delete().eq('id', row.id);
      result.stuckDeletesCompleted += 1;
    } catch {
      result.failures += 1;
    }
  }

  return { data: result, error: null };
}
