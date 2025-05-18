'use client';

import { useState } from 'react';
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

    setError(null);
    setLoading(true);

    const projectData = {
      user_id: user.id,
      name: name.trim(),
      due_date: dueDate || null, // Handle empty date string
      priority,
      stakeholders: stakeholders.split(',').map(s => s.trim()).filter(s => s), // Convert to array, remove empty strings
      description: description.trim() || null,
      status: 'Open', // Default status
    };

    try {
      const { data, error: insertError } = await supabase
        .from('projects')
        .insert([projectData])
        .select() // To get the newly created record back
        .single(); // Assuming we insert one record and want it back

      if (insertError) throw insertError;

      if (data) {
        onProjectAdded(data); // Pass the newly created project back to the dashboard
      }
      onClose(); // Close the modal/form on success
    } catch (err) {
      console.error('Error adding project:', err);
      setError(err.message || 'Failed to add project.');
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