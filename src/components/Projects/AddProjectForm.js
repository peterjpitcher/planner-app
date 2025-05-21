'use client';

import { useState, useRef, useEffect, Fragment } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { quickPickOptions } from '@/lib/dateUtils'; // Import quickPickOptions

export default function AddProjectForm({ onProjectAdded, onClose }) {
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState('Medium'); // Default priority
  const [stakeholders, setStakeholders] = useState(''); // Input as comma-separated string
  const [description, setDescription] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [tasks, setTasks] = useState([
    { name: '', description: '', dueDate: '', priority: '' }
  ]);
  const [taskErrors, setTaskErrors] = useState([]);

  const nameInputRef = useRef(null);
  useEffect(() => {
    if (nameInputRef.current) {
      nameInputRef.current.focus();
    }
  }, []);

  const handleTaskChange = (idx, field, value) => {
    setTasks(tasks => tasks.map((t, i) => i === idx ? { ...t, [field]: value } : t));
  };
  const handleAddTask = () => {
    setTasks(tasks => [...tasks, { name: '', description: '', dueDate: '', priority: '' }]);
  };
  const handleRemoveTask = (idx) => {
    setTasks(tasks => tasks.filter((_, i) => i !== idx));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!user) {
      setError('You must be logged in to add a project.');
      return;
    }
    if (!name.trim()) {
        setError('Project name is required.');
        return;
    }
    // Validate tasks
    const newTaskErrors = tasks.map(t => !t.name.trim() ? 'Task name is required.' : null);
    setTaskErrors(newTaskErrors);
    if (newTaskErrors.some(Boolean)) return;

    setError(null);
    setLoading(true);

    const projectData = {
      user_id: user.id,
      name: name.trim(),
      due_date: dueDate || null,
      priority,
      stakeholders: stakeholders.split(',').map(s => s.trim()).filter(s => s),
      description: description.trim() || null,
      status: 'Open',
    };

    try {
      const { data: project, error: insertError } = await supabase
        .from('projects')
        .insert([projectData])
        .select()
        .single();
      if (insertError) throw insertError;
      if (project) {
        // Add tasks if any
        const tasksToAdd = tasks.filter(t => t.name.trim());
        let taskInsertError = null;
        if (tasksToAdd.length > 0) {
          const { error: taskError } = await supabase
            .from('tasks')
            .insert(tasksToAdd.map(t => ({
              project_id: project.id,
              user_id: user.id,
              name: t.name.trim(),
              description: t.description.trim() || null,
              due_date: t.dueDate || null,
              priority: t.priority || priority,
            })));
          if (taskError) taskInsertError = taskError;
        }
        onProjectAdded(project);
        if (taskInsertError) {
          setError('Project created, but some tasks failed to be added: ' + taskInsertError.message);
        } else {
          onClose();
        }
      }
    } catch (err) {
      console.error('Error adding project or tasks:', err);
      setError(err.message || 'Failed to add project or tasks.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="projectName" className="block text-sm font-medium text-gray-700">
          Project Name <span className="text-red-500">*</span>
        </label>
        <input
          id="projectName"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
          required
          ref={nameInputRef}
        />
      </div>

      <div>
        <label htmlFor="projectDescription" className="block text-sm font-medium text-gray-700">
          Description
        </label>
        <textarea
          id="projectDescription"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
        />
      </div>

      <div>
        <label htmlFor="dueDate" className="block text-sm font-medium text-gray-700">
          Due Date
        </label>
        <input
          id="dueDate"
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
        />
        {/* Quick Pick Date Buttons */}
        <div className="mt-2 grid grid-cols-3 sm:grid-cols-6 gap-2">
          {quickPickOptions.map(option => (
            <button
              key={option.label}
              type="button"
              onClick={() => setDueDate(option.getValue())}
              className="px-1.5 py-0.5 text-3xs font-medium text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 rounded-full cursor-pointer focus:outline-none focus:ring-1 focus:ring-indigo-300 text-center"
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label htmlFor="priority" className="block text-sm font-medium text-gray-700">
          Priority
        </label>
        <select
          id="priority"
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
          className="mt-1 block w-full px-3 py-2 border border-gray-300 bg-white rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
        >
          <option value="High">High</option>
          <option value="Medium">Medium</option>
          <option value="Low">Low</option>
        </select>
      </div>

      <div>
        <label htmlFor="stakeholders" className="block text-sm font-medium text-gray-700">
          Stakeholders (comma-separated)
        </label>
        <input
          id="stakeholders"
          type="text"
          value={stakeholders}
          onChange={(e) => setStakeholders(e.target.value)}
          placeholder="e.g., Jane Doe, John Smith"
          className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
        />
      </div>

      <div className="border-t pt-4 mt-4">
        <h3 className="text-md font-semibold text-gray-800 mb-2">Add Tasks (optional)</h3>
        {tasks.map((task, idx) => (
          <div key={idx} className="mb-3 p-3 bg-gray-50 rounded-md border border-gray-200">
            <div className="flex gap-2 items-center">
              <input
                type="text"
                placeholder="Task name*"
                value={task.name}
                onChange={e => handleTaskChange(idx, 'name', e.target.value)}
                className="flex-1 px-2 py-1 border border-gray-300 rounded-md text-sm"
                required
              />
              <button type="button" onClick={() => handleRemoveTask(idx)} className="text-xs text-red-500 hover:underline" disabled={tasks.length === 1}>Remove</button>
            </div>
            {taskErrors[idx] && <p className="text-xs text-red-500 mt-1">{taskErrors[idx]}</p>}
            <textarea
              placeholder="Description (optional)"
              value={task.description}
              onChange={e => handleTaskChange(idx, 'description', e.target.value)}
              className="mt-2 w-full px-2 py-1 border border-gray-300 rounded-md text-xs"
              rows={2}
            />
            <div className="flex gap-2 mt-2">
              <input
                type="date"
                value={task.dueDate}
                onChange={e => handleTaskChange(idx, 'dueDate', e.target.value)}
                className="px-2 py-1 border border-gray-300 rounded-md text-xs"
              />
              <select
                value={task.priority || priority}
                onChange={e => handleTaskChange(idx, 'priority', e.target.value)}
                className="px-2 py-1 border border-gray-300 rounded-md text-xs"
              >
                <option value="High">High</option>
                <option value="Medium">Medium</option>
                <option value="Low">Low</option>
              </select>
            </div>
          </div>
        ))}
        <button type="button" onClick={handleAddTask} className="text-indigo-600 hover:underline text-sm">+ Add another task</button>
      </div>

      {error && <p className="text-sm text-red-600">Error: {error}</p>}

      <div className="flex flex-col sm:flex-row justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={() => {
            setName('');
            setDueDate('');
            setPriority('Medium');
            setStakeholders('');
            setDescription('');
            setError(null);
            if (onClose) {
                onClose(); 
            } else {
                // If no onClose, default behavior for inline form is to clear.
            }
          }}
          className="w-full sm:w-auto px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={loading}
          className="w-full sm:w-auto px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
        >
          {loading ? 'Adding Project...' : 'Add Project'}
        </button>
      </div>
    </form>
  );
} 