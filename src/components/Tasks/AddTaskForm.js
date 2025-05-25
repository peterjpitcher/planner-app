'use client';

import { useState, useRef, useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { quickPickOptions } from '@/lib/dateUtils';

export default function AddTaskForm({ projectId, onTaskAdded, onClose, defaultPriority }) {
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState(defaultPriority || 'Medium');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [addAnother, setAddAnother] = useState(false);

  const nameInputRef = useRef(null);
  useEffect(() => {
    if (nameInputRef.current) {
      nameInputRef.current.focus();
    }
  }, []);

  const handleSubmit = async (e, shouldAddAnother = false) => {
    if (e && typeof e.preventDefault === 'function') {
      e.preventDefault();
    }
    
    const addingAnother = shouldAddAnother || addAnother;

    if (!user) {
      setError('You must be logged in to add a task.');
      return;
    }
    if (!name.trim()) {
      setError('Task name is required.');
      return;
    }
    if (!projectId) {
      setError('Project ID is missing. Cannot add task.');
      console.error('AddTaskForm: projectId is missing');
      return;
    }

    setError(null);
    setLoading(true);

    const taskData = {
      project_id: projectId,
      user_id: user.id, // For RLS and ownership
      name: name.trim(),
      description: description.trim() || null,
      due_date: dueDate || null,
      priority,
    };

    try {
      const { data, error: insertError } = await supabase
        .from('tasks')
        .insert([taskData])
        .select()
        .single();

      if (insertError) throw insertError;

      if (data) {
        onTaskAdded(data); // Pass the newly created task back
      }
      
      if (addingAnother) {
        setName('');
        setDescription('');
        setDueDate('');
        setError(null);
        setAddAnother(false);
        if (nameInputRef.current) {
          nameInputRef.current.focus();
        }
      } else {
        onClose(); // Close the modal/form on success if not adding another
      }
    } catch (err) {
      console.error('Error adding task:', err);
      setError(err.message || 'Failed to add task.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label htmlFor="taskName" className="block text-sm font-medium text-gray-700">
          Task Name <span className="text-red-500">*</span>
        </label>
        <input
          id="taskName"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
          required
          ref={nameInputRef}
        />
      </div>

      <div>
        <label htmlFor="taskDescription" className="block text-sm font-medium text-gray-700">
          Description (Optional)
        </label>
        <textarea
          id="taskDescription"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label htmlFor="taskDueDate" className="block text-sm font-medium text-gray-700">
            Due Date
          </label>
          <input
            id="taskDueDate"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
          />
        </div>
        <div>
          <label htmlFor="taskPriority" className="block text-sm font-medium text-gray-700">
            Priority
          </label>
          <select
            id="taskPriority"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            className="mt-1 block w-full px-3 py-2 border border-gray-300 bg-white rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
          >
            <option value="High">High</option>
            <option value="Medium">Medium</option>
            <option value="Low">Low</option>
          </select>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-2 w-full">
        {quickPickOptions.map(option => (
          <span
            key={option.label}
            role="button"
            tabIndex={0}
            onClick={() => setDueDate(option.getValue())}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') setDueDate(option.getValue());
            }}
            className="px-2 py-1 rounded-full bg-gray-200 text-xs font-medium text-gray-700 cursor-pointer hover:bg-indigo-100 focus:outline-none focus:ring-2 focus:ring-indigo-400 select-none"
            style={{ minWidth: 60, textAlign: 'center' }}
          >
            {option.label}
          </span>
        ))}
      </div>

      {error && <p className="text-sm text-red-600">Error: {error}</p>}

      <div className="flex flex-col sm:flex-row justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={onClose}
          className="w-full sm:w-auto px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => handleSubmit(null, true)}
          disabled={loading}
          className="w-full sm:w-auto px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50"
        >
          {loading && addAnother ? 'Adding...' : 'Add & Add Another'}
        </button>
        <button
          type="submit"
          disabled={loading}
          className="w-full sm:w-auto px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
        >
          {loading && !addAnother ? 'Adding Task...' : 'Add Task'}
        </button>
      </div>
    </form>
  );
} 