'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useApiClient } from '@/hooks/useApiClient';
import { handleError } from '@/lib/errorHandler';
import { useSession } from 'next-auth/react';
import MobileLayout from '@/components/Mobile/MobileLayout';
import { format, parseISO } from 'date-fns';

const MobileEditTaskPage = () => {
  const api = useApiClient();
  const { data: session, status } = useSession();
  const user = session?.user;
  const authLoading = status === 'loading';
  const router = useRouter();
  const params = useParams();
  const taskId = params?.id;

  const [task, setTask] = useState(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState('Medium');
  const [projectId, setProjectId] = useState('');
  
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState(null);
  const [formError, setFormError] = useState('');

  const priorityOptions = ['Low', 'Medium', 'High'];

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
      return;
    }
    if (status === 'authenticated' && user && taskId) {
      const fetchTaskData = async () => {
        setIsLoading(true);
        setError(null);
        try {
          const { data, error: dbError } = await api.tasks.list();
          if (dbError) throw new Error(dbError);
          
          const task = data?.find(t => t.id === taskId);
          if (task) {
            setTask(task);
            setName(task.name || '');
            setDescription(task.description || '');
            setDueDate(task.due_date ? format(parseISO(task.due_date), 'yyyy-MM-dd') : '');
            setPriority(task.priority || 'Medium');
            setProjectId(task.project_id || '');
          } else {
            setError('Task not found.');
          }
        } catch (e) {
          const errorMsg = handleError(e, 'fetch task data');
          setError(errorMsg);
        }
        setIsLoading(false);
      };
      fetchTaskData();
    }
  }, [user, status, taskId, router]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) {
      setFormError('Task name is required.');
      return;
    }
    setFormError('');
    setIsSaving(true);

    try {
      const { data, error: updateError } = await api.tasks.update(taskId, {
        name: name.trim(),
        description: description.trim(),
        due_date: dueDate || null,
        priority: priority,
        updated_at: new Date().toISOString(),
      });

      if (updateError) throw new Error(updateError);
      router.replace(`/m/task/${taskId}`); // Navigate back to task detail page
    } catch (err) {
      const errorMsg = handleError(err, 'save task');
      setFormError(errorMsg);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteTask = async () => {
    if (!task || !window.confirm(`Are you sure you want to delete task "${task.name}"? This action cannot be undone.`)) {
      return;
    }
    setIsDeleting(true);
    setFormError('');
    try {
      const { data, error: deleteError } = await api.tasks.delete(taskId);
      if (deleteError) throw new Error(deleteError);
      // On successful deletion, navigate to the parent project or tasks list
      if (projectId) {
        router.replace(`/m/project/${projectId}`);
      } else {
        router.replace('/m/tasks'); // Fallback if no project_id (should not happen for tasks)
      }
    } catch (err) {
      const errorMsg = handleError(err, 'delete task');
      setFormError(errorMsg);
      setIsDeleting(false);
    }
    // No finally setIsDeleting(false) if navigating away
  };
  
  if (isLoading) {
    return <MobileLayout title="Loading Form..."><div className="p-4 text-center">Loading task details...</div></MobileLayout>;
  }
  if (error) {
    return <MobileLayout title="Error"><div className="p-4 text-center text-red-500">{error}</div></MobileLayout>;
  }
  if (!task) {
    return <MobileLayout title="Not Found"><div className="p-4 text-center">Task not found.</div></MobileLayout>;
  }

  return (
    <MobileLayout title={`Edit: ${task.name}`}>
      <form onSubmit={handleSubmit} className="p-4 space-y-4 bg-white shadow-md rounded-lg">
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-gray-700">Name <span className="text-red-500">*</span></label>
          <input type="text" name="name" id="name" value={name} onChange={(e) => setName(e.target.value)} required className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-gray-900 placeholder-gray-500" />
        </div>
        <div>
          <label htmlFor="description" className="block text-sm font-medium text-gray-700">Description</label>
          <textarea name="description" id="description" value={description} onChange={(e) => setDescription(e.target.value)} rows="3" className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-gray-900 placeholder-gray-500"></textarea>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="dueDate" className="block text-sm font-medium text-gray-700">Due Date</label>
            <input type="date" name="dueDate" id="dueDate" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-gray-900" />
          </div>
          <div>
            <label htmlFor="priority" className="block text-sm font-medium text-gray-700">Priority</label>
            <select name="priority" id="priority" value={priority} onChange={(e) => setPriority(e.target.value)} className="mt-1 block w-full px-3 py-2 border border-gray-300 bg-white rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-gray-900">
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

export default MobileEditTaskPage; 