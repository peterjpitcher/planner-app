'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';

export default function AddNoteForm({ parentId, parentType, onNoteAdded }) {
  const { user } = useAuth();
  const [noteContent, setNoteContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!noteContent.trim()) {
      setError('Note content cannot be empty.');
      return;
    }
    if (!user) {
      setError('You must be logged in to add a note.');
      return;
    }

    setIsSaving(true);
    setError(null);

    const noteData = {
      content: noteContent.trim(),
      user_id: user.id,
    };

    if (parentType === 'project') {
      noteData.project_id = parentId;
    } else if (parentType === 'task') {
      noteData.task_id = parentId;
    } else {
      setError('Invalid parent type for note.');
      setIsSaving(false);
      return;
    }

    try {
      const { data, error: insertError } = await supabase
        .from('notes')
        .insert(noteData)
        .select();

      if (insertError) throw insertError;

      setNoteContent(''); // Clear input
      if (onNoteAdded) {
        onNoteAdded(data[0]); // Pass the newly added note back
      }
    } catch (err) {
      console.error('Error saving note:', err);
      setError(err.message || 'Failed to save note.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mt-3">
      <textarea
        value={noteContent}
        onChange={(e) => {
          setNoteContent(e.target.value);
          if (error) setError(null); // Clear error when user starts typing
        }}
        placeholder="Add a new note..."
        rows={3}
        className="w-full p-2 text-xs border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500 disabled:opacity-70"
        disabled={isSaving}
      />
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
      <div className="mt-2 text-right">
        <button 
          type="submit"
          disabled={isSaving || !noteContent.trim()}
          className="px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
        >
          {isSaving ? 'Saving...' : 'Save Note'}
        </button>
      </div>
    </form>
  );
} 