'use client';

import { useRef, useState } from 'react';
import { format } from 'date-fns';
import { apiClient } from '@/lib/apiClient';

export default function AddTaskInput({ projectId, onTaskAdded, disabled = false }) {
  const [name, setName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef(null);

  const isDisabled = disabled || isSubmitting;

  async function handleSubmit(e) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || isDisabled) return;
    setIsSubmitting(true);
    try {
      const newTask = await apiClient.createTask({
        name: trimmed,
        projectId: projectId ?? undefined,
        dueDate: format(new Date(), 'yyyy-MM-dd'),
        state: 'backlog',
      });
      setName('');
      onTaskAdded?.(newTask, projectId);
      // Re-focus for rapid-fire entry
      requestAnimationFrame(() => inputRef.current?.focus());
    } catch {
      // silently fail — task creation errors are rare
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-2 flex gap-2">
      <input
        ref={inputRef}
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Add a task…"
        maxLength={255}
        disabled={isDisabled}
        className="flex-1 rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm placeholder-gray-400 focus:border-indigo-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400"
      />
      <button
        type="submit"
        disabled={!name.trim() || isDisabled}
        className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        Add
      </button>
    </form>
  );
}
