'use client';

import { useState, useRef, useEffect, Fragment } from 'react';
import { apiClient } from '@/lib/apiClient';
import { useSession } from 'next-auth/react';
import { quickPickOptions } from '@/lib/dateUtils';
import { validateProject, validateTask, sanitizeInput } from '@/lib/validators';
import { PRIORITY, PROJECT_STATUS } from '@/lib/constants';
import { handleSupabaseError } from '@/lib/errorHandler';

export default function AddProjectForm({ onProjectAdded, onClose }) {
  const { data: session } = useSession();
  const user = session?.user;
  const [name, setName] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState('Medium'); // Default priority
  const [job, setJob] = useState('');
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
    setTasks(currentTasks => currentTasks.map((t, i) => i === idx ? { ...t, [field]: value } : t));
  };
  const handleAddTask = () => {
    setTasks(currentTasks => [...currentTasks, { name: '', description: '', dueDate: '', priority: '' }]);
  };
  const handleRemoveTask = (idx) => {
    setTasks(currentTasks => currentTasks.filter((_, i) => i !== idx));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!user) {
      setError('You must be logged in to add a project.');
      return;
    }
    // Prepare and validate project data
    const projectData = {
      user_id: user.id,
      name: sanitizeInput(name),
      due_date: dueDate || null,
      priority: priority || PRIORITY.MEDIUM,
      job: sanitizeInput(job) || null,
      stakeholders: stakeholders.split(',').map(s => sanitizeInput(s)).filter(s => s),
      description: sanitizeInput(description) || null,
      status: PROJECT_STATUS.OPEN,
    };
    
    const projectValidation = validateProject(projectData);
    if (!projectValidation.isValid) {
      setError(Object.values(projectValidation.errors)[0]); // Show first error
      return;
    }
    
    // Validate tasks
    const tasksToValidate = tasks.filter(t => t.name.trim() || t.description.trim() || t.dueDate || t.priority);
    const newTaskErrors = tasksToValidate.map((t, idx) => {
      const taskData = {
        name: sanitizeInput(t.name),
        description: sanitizeInput(t.description),
        due_date: t.dueDate || null,
        priority: t.priority || priority,
        project_id: 'temp' // Placeholder for validation
      };
      const validation = validateTask(taskData);
      return validation.isValid ? null : Object.values(validation.errors)[0];
    });
    
    if (newTaskErrors.some(err => err !== null)) {
      setTaskErrors(newTaskErrors);
      return;
    }
    setTaskErrors([]);

    setError(null);
    setLoading(true);

    try {
      const project = await apiClient.createProject(projectData);
      if (project) {
        const tasksToAdd = tasks.filter(t => t.name.trim());
        let taskInsertError = null;
        if (tasksToAdd.length > 0) {
          try {
            await Promise.all(
              tasksToAdd.map(t => 
                apiClient.createTask({
                  project_id: project.id,
                  user_id: user.id,
                  name: sanitizeInput(t.name),
                  description: sanitizeInput(t.description) || null,
                  due_date: t.dueDate || null,
                  priority: t.priority || priority, // Default to project priority if task priority not set
                })
              )
            );
          } catch (taskError) {
            taskInsertError = taskError;
          }
        }
        onProjectAdded(project);
        if (taskInsertError) {
          setError('Project created, but some tasks failed: ' + taskInsertError.message);
          // Keep modal open if tasks fail, but project was created.
        } else {
          onClose();
        }
      }
    } catch (err) {
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
        <div className="mt-2 flex flex-wrap gap-2">
          {quickPickOptions.map(option => (
            <span
              key={option.label}
              role="button"
              tabIndex={0} // Make it focusable
              onClick={() => setDueDate(option.getValue())}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') setDueDate(option.getValue());
              }}
              className="px-2 py-1 rounded-full bg-gray-100 text-xs font-medium text-gray-600 cursor-pointer hover:bg-indigo-100 hover:text-indigo-700 focus:outline-none focus:ring-1 focus:ring-indigo-500 select-none"
            >
              {option.label}
            </span>
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
        <label htmlFor="job" className="block text-sm font-medium text-gray-700">
          Job / Swimlane
        </label>
        <input
          id="job"
          type="text"
          value={job}
          onChange={(e) => setJob(e.target.value)}
          placeholder="e.g., Job A, Freelance, Client X"
          className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
        />
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
                // Conditionally required if any other part of task is filled or if it's not the only empty task
              />
              {tasks.length > 1 && (
                <button type="button" onClick={() => handleRemoveTask(idx)} className="text-xs text-red-500 hover:underline">
                  Remove
                </button>
              )}
            </div>
            {taskErrors[idx] && <p className="text-xs text-red-500 mt-1">{taskErrors[idx]}</p>}
            <textarea
              placeholder="Description (optional)"
              value={task.description}
              onChange={e => handleTaskChange(idx, 'description', e.target.value)}
              className="mt-2 w-full px-2 py-1 border border-gray-300 rounded-md text-xs"
              rows={2}
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-2 gap-y-2 mt-2">
              <div>
                <label htmlFor={`taskDueDate-${idx}`} className="sr-only">Task Due Date</label>
                <input
                  id={`taskDueDate-${idx}`}
                  type="date"
                  value={task.dueDate}
                  onChange={e => handleTaskChange(idx, 'dueDate', e.target.value)}
                  className="w-full px-2 py-1 border border-gray-300 rounded-md text-xs"
                  aria-label="Task due date"
                />
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {quickPickOptions.map(option => (
                    <span
                      key={option.label}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleTaskChange(idx, 'dueDate', option.getValue())}
                      onKeyDown={e => {
                         if (e.key === 'Enter' || e.key === ' ') handleTaskChange(idx, 'dueDate', option.getValue());
                      }}
                      className="px-1.5 py-0.5 rounded-full bg-gray-200 text-[0.6rem] font-medium text-gray-600 cursor-pointer hover:bg-indigo-100 hover:text-indigo-700 focus:outline-none focus:ring-1 focus:ring-indigo-500 select-none"
                    >
                      {option.label}
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <label htmlFor={`taskPriority-${idx}`} className="sr-only">Task Priority</label>
                <select
                  id={`taskPriority-${idx}`}
                  value={task.priority || priority} // Default to project priority
                  onChange={e => handleTaskChange(idx, 'priority', e.target.value)}
                  className="w-full px-2 py-1 border border-gray-300 rounded-md text-xs bg-white"
                  aria-label="Task priority"
                >
                  <option value="" disabled={!!(task.priority || priority)}>Select Priority</option>
                  <option value="High">High</option>
                  <option value="Medium">Medium</option>
                  <option value="Low">Low</option>
                </select>
              </div>
            </div>
          </div>
        ))}
        <button type="button" onClick={handleAddTask} className="text-indigo-600 hover:underline text-sm">+ Add another task</button>
      </div>

      {error && <p className="text-sm text-red-600 mt-2">Error: {error}</p>}

      <div className="flex flex-col sm:flex-row justify-end gap-3 pt-4 border-t mt-4">
        <button
          type="button"
          onClick={() => {
            if (onClose) onClose(); 
          }}
          disabled={loading}
          className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
        >
          {loading ? 'Creating Project...' : 'Create Project'}
        </button>
      </div>
    </form>
  );
} 
