'use client';

import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { quickPickOptions } from '@/lib/dateUtils';

// Reusable form for adding a task. 
// If `projectId` is provided, it's for adding a task to a specific project.
// If `projects` array is provided, it's for adding a task from a general page, requiring project selection.
export default function AddTaskForm({ projectId, projects, onTaskAdded, onClose, defaultPriority = 'Medium' }) {
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState(defaultPriority);
  const [selectedProjectId, setSelectedProjectId] = useState(projectId || '');
  
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [addAnother, setAddAnother] = useState(false);

  const nameInputRef = useRef(null);

  const priorityOptions = ['Low', 'Medium', 'High'];

  useEffect(() => {
    if (nameInputRef.current) {
      nameInputRef.current.focus();
    }
  }, []);

  useEffect(() => {
    if (projectId) {
      setSelectedProjectId(projectId);
    } else if (projects && projects.length > 0) {
      if (!selectedProjectId || !projects.find(p => p.id === selectedProjectId)) {
        // setSelectedProjectId(projects[0].id); // Example: auto-select first
        // Or leave it empty to force user selection if that's the desired UX
        // For the context of ProjectItem, projectId will always be there, so this branch is less critical.
      }
    } else if (!projectId) {
        // No projectId and no projects list, clear selectedProjectId if it was somehow set.
        // This scenario should ideally not happen if the form is used correctly.
        setSelectedProjectId('');
    }
  }, [projectId, projects, selectedProjectId]);

  useEffect(() => {
    // Set initial priority passed as prop (e.g. from parent project)
    setPriority(defaultPriority);
  }, [defaultPriority]);

  const handleSubmit = async (e, shouldAddAnother = false) => {
    if (e && typeof e.preventDefault === 'function') {
      e.preventDefault();
    }
    
    const addingAnother = shouldAddAnother || addAnother;

    if (!user) {
      setError('You must be logged in.');
      return;
    }
    if (!name.trim()) {
      setError('Task name is required.');
      return;
    }
    if (!selectedProjectId) {
      setError('A project must be selected for the task.');
      return;
    }

    setError(null);
    setLoading(true);

    const taskData = {
      user_id: user.id,
      project_id: selectedProjectId,
      name: name.trim(),
      description: description.trim() || null,
      due_date: dueDate || null,
      priority: priority,
      is_completed: false,
    };

    try {
      const { data: newTask, error: insertError } = await supabase
        .from('tasks')
        .insert(taskData)
        .select('*, projects(id, name)') // Select project name for optimistic update
        .single();

      if (insertError) throw insertError;

      // Update parent project's updated_at timestamp
      await supabase
        .from('projects')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', selectedProjectId);

      if (onTaskAdded) {
        onTaskAdded(newTask); // Pass the newly created task back
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
    <form onSubmit={handleSubmit} className="space-y-4">
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

      {/* Project Selector: Only show if no specific projectId is passed and projects list is available */}
      {!projectId && projects && projects.length > 0 && (
        <div>
          <label htmlFor="project" className="block text-sm font-medium text-gray-700">
            Project <span className="text-red-500">*</span>
          </label>
          <select
            id="project"
            value={selectedProjectId}
            onChange={(e) => setSelectedProjectId(e.target.value)}
            className="mt-1 block w-full px-3 py-2 border border-gray-300 bg-white rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            required
          >
            <option value="" disabled>Select a project</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      )}
      {/* If projectId is provided, could show a disabled input or just text of project name */}
      {projectId && !projects && (
          <div>
            <p className="text-sm text-gray-600">Adding task to a specific project.</p>
            {/* Consider fetching and displaying project name here if needed for context */}
          </div>
      )}

      <div>
        <label htmlFor="taskDescription" className="block text-sm font-medium text-gray-700">
          Description
        </label>
        <textarea
          id="taskDescription"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
            {priorityOptions.map(opt => (<option key={opt} value={opt}>{opt}</option>))}
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
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            setAddAnother(true);
            handleSubmit(null, true);
          }}
          disabled={loading}
          className="px-4 py-2 text-sm font-medium text-white bg-green-600 border border-transparent rounded-md shadow-sm hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50"
        >
          {loading && addAnother ? 'Adding...' : 'Add & Add Another'}
        </button>
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
        >
          {loading ? 'Adding Task...' : 'Add Task'}
        </button>
      </div>
    </form>
  );
} 