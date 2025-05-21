'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';

export default function AddNoteForm({ parentId, parentType, onNoteAdded, disabled }) {
  const { user } = useAuth();
  const [noteContent, setNoteContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);

  const internalHandleSubmit = async () => {
    if (!noteContent.trim()) {
      // setError('Note content cannot be empty.'); // Optional: can be annoying for quick submits
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
      // parent_type: parentType, // Not needed for DB, but good for logic
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
        .select()
        .single(); // Assuming we expect one note back

      if (insertError) throw insertError;

      setNoteContent(''); // Clear input
      if (onNoteAdded && data) { // Check if data is not null
        onNoteAdded(data); // Pass the newly added note back
      }
    } catch (err) {
      console.error('Error saving note:', err);
      setError(err.message || 'Failed to save note.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleFormSubmit = (e) => {
    e.preventDefault();
    internalHandleSubmit();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault(); // Prevent default form submission or newline in other inputs
      internalHandleSubmit();
    }
    if (e.key === 'Escape') {
      setNoteContent(''); // Clear on Escape
      if (error) setError(null);
    }
  };

  return (
    <form onSubmit={handleFormSubmit} className="mt-2 mb-1">
      <input
        type="text"
        value={noteContent}
        onChange={(e) => {
          setNoteContent(e.target.value);
          if (error) setError(null);
        }}
        onKeyDown={handleKeyDown} // Added keydown handler
        placeholder="Add a new note... (Enter to save)"
        className="w-full p-2 text-xs border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500 disabled:opacity-70 disabled:bg-gray-100"
        disabled={isSaving || disabled} // Use passed disabled prop
      />
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
      {/* Submit button can be kept for accessibility or removed if Enter is the only way */}
      <button 
        type="submit"
        disabled={isSaving || !noteContent.trim() || disabled}
        className="hidden" // Hiding button as Enter is primary interaction
        aria-hidden="true"
      >
        Save Note
      </button>
    </form>
  );
} 