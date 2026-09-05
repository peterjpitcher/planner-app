// src/components/shared/AttachmentsPanel.jsx
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { PaperClipIcon, TrashIcon, ArrowDownTrayIcon } from '@heroicons/react/20/solid';
import { apiClient } from '@/lib/apiClient';
import { formatDate } from '@/lib/dateUtils';
import { cn } from '@/lib/styleUtils';

/**
 * Files on a customer, project, task or note.
 *
 * A direct browser upload has more failure modes than a form post, and each one
 * needs a defined outcome rather than a spinner that never resolves. The states
 * below mirror the row's own status, so what you see matches what the database
 * thinks.
 */

const STAGE_LABEL = {
  signing: 'Preparing…',
  uploading: 'Uploading…',
  finalising: 'Checking file…',
};

function formatSize(bytes) {
  const size = Number(bytes || 0);
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export default function AttachmentsPanel({
  parentType,
  parentId,
  title = 'Files',
  disabled = false,
}) {
  const [attachments, setAttachments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [uploads, setUploads] = useState([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);

  const parentRef = useRef({ key: null, generation: 0 });
  const parentKey = `${parentType}:${parentId}`;
  if (parentRef.current.key !== parentKey) {
    parentRef.current = { key: parentKey, generation: parentRef.current.generation + 1 };
  }
  const generation = parentRef.current.generation;
  const mountedRef = useRef(true);
  const requestRef = useRef(0);
  const uploadIdRef = useRef(0);
  const isCurrent = useCallback(
    () => mountedRef.current && parentRef.current.generation === generation,
    [generation]
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const load = useCallback(async () => {
    if (!parentId || !isCurrent()) return;
    const request = ++requestRef.current;
    setLoading(true);
    try {
      const data = await apiClient.getAttachments(parentType, parentId);
      if (!isCurrent() || request !== requestRef.current) return;
      setAttachments(data);
      setError(null);
    } catch (err) {
      if (isCurrent() && request === requestRef.current) setError(err.message || 'Could not load files.');
    } finally {
      if (isCurrent() && request === requestRef.current) setLoading(false);
    }
  }, [parentType, parentId, isCurrent]);

  useEffect(() => {
    setAttachments([]);
    setUploads([]);
    setError(null);
    setDragging(false);
    load();
  }, [load]);

  async function upload(files) {
    const list = Array.from(files || []);
    if (list.length === 0 || disabled) return;

    for (const file of list) {
      // Finish a file already submitted, but do not start the rest of an old
      // parent's queue after the user has moved to a different record.
      if (!isCurrent()) return;
      const key = `upload-${++uploadIdRef.current}`;
      setUploads((prev) => [...prev, { key, name: file.name, stage: 'signing', error: null }]);
      try {
        await apiClient.uploadAttachment(
          { parentType, parentId, file },
          (stage) => {
            if (isCurrent()) setUploads((prev) => prev.map((entry) => entry.key === key ? { ...entry, stage } : entry));
          }
        );
        if (!isCurrent()) return;
        setUploads((prev) => prev.filter((entry) => entry.key !== key));
        await load();
      } catch (err) {
        if (!isCurrent()) return;
        setUploads((prev) => prev.map((entry) => entry.key === key
          ? { ...entry, stage: 'failed', error: err.message || 'Upload failed' }
          : entry));
      }
    }
  }

  async function download(attachment) {
    try {
      const { url } = await apiClient.getAttachmentDownloadUrl(attachment.id);
      if (isCurrent()) window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      if (isCurrent()) setError(err.message || 'Could not open that file.');
    }
  }

  async function remove(attachmentId) {
    try {
      await apiClient.deleteAttachment(attachmentId);
      if (isCurrent()) {
        setAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
        await load();
      }
    } catch (err) {
      if (isCurrent()) setError(err.message || 'Could not delete that file.');
    }
  }

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-gray-700">
        {title} ({attachments.length})
      </h2>

      {!disabled && (
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            upload(event.dataTransfer.files);
          }}
          className={cn(
            'rounded-lg border border-dashed p-4 text-center transition-colors',
            dragging ? 'border-indigo-400 bg-indigo-50' : 'border-gray-200'
          )}
        >
          <p className="text-xs text-gray-500">
            Drop files here, or{' '}
            {/* A real file input, not a styled div, so choosing a file works
                from the keyboard as well as by dragging. */}
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="font-medium text-indigo-600 underline hover:text-indigo-700"
            >
              choose a file
            </button>
            .
          </p>
          <p className="mt-1 text-[11px] text-gray-400">
            Up to 25 MB each. PDFs, images, Office documents, CSV, text, zip and emails.
          </p>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="sr-only"
            aria-label={`Add files to this ${parentType}`}
            onChange={(event) => {
              upload(event.target.files);
              event.target.value = '';
            }}
          />
        </div>
      )}

      {uploads.length > 0 && (
        <ul className="mt-2 space-y-1">
          {uploads.map((entry) => (
            <li
              key={entry.key}
              className={cn(
                'flex items-center justify-between gap-3 rounded-md px-3 py-2 text-xs',
                entry.stage === 'failed' ? 'bg-red-50 text-red-700' : 'bg-gray-50 text-gray-600'
              )}
            >
              <span className="min-w-0 truncate">{entry.name}</span>
              <span className="shrink-0">
                {entry.stage === 'failed' ? entry.error : STAGE_LABEL[entry.stage]}
              </span>
              {entry.stage === 'failed' && (
                <button
                  type="button"
                  onClick={() => setUploads((prev) => prev.filter((e) => e.key !== entry.key))}
                  className="shrink-0 underline"
                >
                  Dismiss
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p role="alert" className="mt-2 text-xs text-red-600">
          {error}
        </p>
      )}

      {loading ? (
        <p className="py-3 text-xs text-gray-400">Loading…</p>
      ) : attachments.length === 0 ? (
        <p className="mt-2 text-center text-xs italic text-gray-400">No files yet.</p>
      ) : (
        <ul className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-200">
          {attachments.map((attachment) => (
            <li key={attachment.id} className="flex items-center gap-3 px-3 py-2">
              <PaperClipIcon className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-gray-900">{attachment.file_name}</p>
                <p className="text-xs text-gray-500">
                  {formatSize(attachment.size_bytes)} ·{' '}
                  {formatDate(attachment.created_at, 'MMM d, yyyy')}
                  {attachment.context_label && ` · ${attachment.context_label}`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => download(attachment)}
                aria-label={`Download ${attachment.file_name}`}
                className="shrink-0 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              >
                <ArrowDownTrayIcon className="h-4 w-4" aria-hidden="true" />
              </button>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => remove(attachment.id)}
                  aria-label={`Delete ${attachment.file_name}`}
                  className="shrink-0 rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                >
                  <TrashIcon className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
