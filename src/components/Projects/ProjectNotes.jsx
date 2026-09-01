// src/components/Projects/ProjectNotes.jsx
'use client';

/*
 * The project note list.
 *
 * The implementation moved to the shared NotesPanel when the customer workspace
 * needed the same thing: a textarea rather than a single-line input, editable
 * and deletable notes, and a real "when it happened" date.
 *
 * The API defaults to includeOrigin, so a closed project still lists the notes
 * it handed to its customer. Without that a completed project shows an empty
 * note list, which looks exactly like data loss even though every row is fine.
 */

import NotesPanel from '@/components/shared/NotesPanel';

export default function ProjectNotes({ projectId, disabled = false }) {
  if (!projectId) return null;
  return <NotesPanel projectId={projectId} disabled={disabled} />;
}
