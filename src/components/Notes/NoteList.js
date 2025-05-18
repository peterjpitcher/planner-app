'use client';

import NoteItem from './NoteItem';

export default function NoteList({ notes }) {
  if (!notes || notes.length === 0) {
    return <p className="text-xs text-gray-500 italic py-2">No notes yet.</p>;
  }

  return (
    <div className="mt-2 space-y-1 max-h-48 overflow-y-auto pr-1">
      {notes.map(note => (
        <NoteItem key={note.id} note={note} />
      ))}
    </div>
  );
} 