'use client';

import { format } from 'date-fns';

export default function NoteItem({ note }) {
  if (!note) return null;

  return (
    <div className="p-2 mb-2 bg-gray-50 rounded-md border border-gray-200">
      <p className="text-xs text-gray-700 whitespace-pre-wrap">{note.content}</p>
      <p className="text-right text-xs text-gray-400 mt-1">
        {format(new Date(note.created_at), 'MMM d, yyyy, h:mm a')}
      </p>
    </div>
  );
} 