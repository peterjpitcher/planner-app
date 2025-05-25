'use client';

import { format } from 'date-fns';

export default function NoteItem({ note }) {
  if (!note) return null;

  const formattedDate = format(new Date(note.created_at), 'EEEE, MMM do, h:mm a');

  return (
    <div className="py-0.5 px-1.5 rounded-md">
      <p className="text-[0.7rem] leading-snug text-gray-700 whitespace-pre-wrap">
        <span className="text-gray-500">{formattedDate}:</span> {note.content}
      </p>
    </div>
  );
} 