'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import MobileLayout from '@/components/Mobile/MobileLayout';
import { format, parseISO } from 'date-fns';

const MobileAddTaskPage = () => {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const projectId = params?.id;

  const [taskName, setTaskName] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState('Medium'); // Default priority
  
  const [isLoadingProject, setIsLoadingProject] = useState(true);
  const [projectPriority, setProjectPriority] = useState('Medium'); // To default task priority
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const priorityOptions = ['Low', 'Medium', 'High'];

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
      return;
    }
    // Fetch project to potentially set default priority for new task
    if (user && projectId) {
      const fetchProjectPriority = async () => {
        setIsLoadingProject(true);
        try {
          const { data, error } = await supabase
            .from('projects')
            .select('priority')
            .eq('id', projectId)
            .eq('user_id', user.id)
            .single();
          if (error) throw error;
          if (data && data.priority) {
            setPriority(data.priority); // Set default task priority from project
            setProjectPriority(data.priority);
          }
        } catch (err) {
          console.error('Error fetching project priority for new task:', err);
          // Keep default medium if project fetch fails
        }
        setIsLoadingProject(false);
      };
      fetchProjectPriority();
    }
  }, [user, authLoading, projectId, router]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!taskName.trim()) {
      setFormError('Task name is required.');
      return;
    }
    if (!projectId || !user) {
        setFormError('Project or User information is missing. Cannot save task.');
        return;
    }
    setFormError('');
    setIsSaving(true);

    try {
      const { error: insertError } = await supabase.from('tasks').insert({
        name: taskName.trim(),
        description: description.trim(),
        due_date: dueDate || null,
        priority: priority,
        project_id: projectId,
        user_id: user.id,
        is_completed: false, // New tasks are not completed
        // created_at and updated_at will be set by default by Supabase
      });

      if (insertError) throw insertError;
      
      // Also update the parent project's updated_at timestamp
      await supabase
        .from('projects')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', projectId);

      router.replace(`/m/project/${projectId}`); // Use replace to avoid edit page in history
    } catch (err) {
      console.error('Error creating task:', err);
      setFormError('Failed to create task. ' + (err.message || ''));
    } finally {
      setIsSaving(false);
    }
  };
  
  if (authLoading || isLoadingProject) {
    return <MobileLayout title="New Task Form"><div className="p-4 text-center">Loading...</div></MobileLayout>;
  }

  return (
    <MobileLayout title="Add New Task">
      <form onSubmit={handleSubmit} className="p-4 space-y-4 bg-white shadow-md rounded-lg">
        <div>
          <label htmlFor="taskName" className="block text-sm font-medium text-gray-700">Task Name <span className="text-red-500">*</span></label>
          <input type="text" name="taskName" id="taskName" value={taskName} onChange={(e) => setTaskName(e.target.value)} required className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" />
        </div>
        <div>
          <label htmlFor="description" className="block text-sm font-medium text-gray-700">Description</label>
          <textarea name="description" id="description" value={description} onChange={(e) => setDescription(e.target.value)} rows="3" className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"></textarea>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="dueDate" className="block text-sm font-medium text-gray-700">Due Date</label>
            <input type="date" name="dueDate" id="dueDate" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" />
          </div>
          <div>
            <label htmlFor="priority" className="block text-sm font-medium text-gray-700">Priority</label>
            <select name="priority" id="priority" value={priority} onChange={(e) => setPriority(e.target.value)} className="mt-1 block w-full px-3 py-2 border border-gray-300 bg-white rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm">
              {priorityOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          </div>
        </div>

        {formError && <p className="text-sm text-red-600">{formError}</p>}

        <div className="flex items-center justify-end space-x-3 pt-2">
          <button type="button" onClick={() => router.back()} disabled={isSaving} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50">
            Cancel
          </button>
          <button type="submit" disabled={isSaving} className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50">
            {isSaving ? 'Saving Task...' : 'Save Task'}
          </button>
        </div>
      </form>
    </MobileLayout>
  );
};

export default MobileAddTaskPage; 