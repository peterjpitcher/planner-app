'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useApiClient } from '@/hooks/useApiClient';
import { handleError } from '@/lib/errorHandler';
import { useSession } from 'next-auth/react';
import MobileLayout from '@/components/Mobile/MobileLayout';
import { format, parseISO } from 'date-fns';
import { quickPickOptions } from '@/lib/dateUtils';

const MobileAddTaskPage = () => {
  const api = useApiClient();
  const { data: session, status } = useSession();
  const user = session?.user;
  const authLoading = status === 'loading';
  const router = useRouter();
  const params = useParams();
  const projectId = params?.id;

  const [taskName, setTaskName] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState('Medium'); // Default priority
  
  const [isLoadingProject, setIsLoadingProject] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [addAnother, setAddAnother] = useState(false); // State for add another

  const nameInputRef = useRef(null); // Ref for focusing name input
  const priorityOptions = ['Low', 'Medium', 'High'];

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
      return;
    }
    // Fetch project to potentially set default priority for new task
    if (status === 'authenticated' && user && projectId) {
      const fetchProjectPriority = async () => {
        setIsLoadingProject(true);
        try {
          const { data, error } = await api.projects.list();
          if (error) throw new Error(error);
          
          const project = data?.find(p => p.id === projectId);
          if (project && project.priority) {
            setPriority(project.priority); // Set default task priority from project
          }
        } catch (err) {
          // Keep default medium if project fetch fails
        }
        setIsLoadingProject(false);
      };
      fetchProjectPriority();
    }
    // Focus the name input on initial load
    if (nameInputRef.current) {
        nameInputRef.current.focus();
    }
  }, [user, status, projectId, router, api.projects]);

  const resetForm = () => {
    setTaskName('');
    setDescription('');
    setDueDate('');
    setFormError('');
    if (nameInputRef.current) {
      nameInputRef.current.focus();
    }
  };

  const handleSubmit = async (e, shouldAddAnother = false) => {
    if (e && typeof e.preventDefault === 'function') {
      e.preventDefault();
    }
    const isAddingAnother = shouldAddAnother || addAnother;

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
      const { data, error: insertError } = await api.tasks.create({
        name: taskName.trim(),
        description: description.trim(),
        due_date: dueDate || null,
        priority: priority,
        project_id: projectId,
        is_completed: false, // New tasks are not completed
        // created_at and updated_at will be set by default by Supabase
      });

      if (insertError) throw new Error(insertError);
      
      // Also update the parent project's updated_at timestamp
      await api.projects.update(projectId, { 
        updated_at: new Date().toISOString() 
      });

      if (isAddingAnother) {
        resetForm();
        setAddAnother(false); // Reset the flag for next explicit click
      } else {
        router.replace(`/m/project/${projectId}`); // Use replace to avoid edit page in history
      }
    } catch (err) {
      const errorMsg = handleError(err, 'create task');
      setFormError(errorMsg);
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
          <input ref={nameInputRef} type="text" name="taskName" id="taskName" value={taskName} onChange={(e) => setTaskName(e.target.value)} required className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-gray-900 placeholder-gray-500" />
        </div>
        <div>
          <label htmlFor="description" className="block text-sm font-medium text-gray-700">Description</label>
          <textarea name="description" id="description" value={description} onChange={(e) => setDescription(e.target.value)} rows="3" className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-gray-900 placeholder-gray-500"></textarea>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="dueDate" className="block text-sm font-medium text-gray-700">Due Date</label>
            <input type="date" name="dueDate" id="dueDate" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-gray-900" />
            <div className="mt-2 flex flex-wrap gap-2">
              {quickPickOptions.map(option => (
                <span
                  key={option.label}
                  role="button"
                  tabIndex={0}
                  onClick={() => setDueDate(option.getValue())}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') setDueDate(option.getValue());
                  }}
                  className="px-2 py-1 rounded-full bg-gray-100 text-xs font-medium text-gray-700 cursor-pointer hover:bg-indigo-100 hover:text-indigo-700 focus:outline-none focus:ring-1 focus:ring-indigo-500 select-none"
                >
                  {option.label}
                </span>
              ))}
            </div>
          </div>
          <div>
            <label htmlFor="priority" className="block text-sm font-medium text-gray-700">Priority</label>
            <select name="priority" id="priority" value={priority} onChange={(e) => setPriority(e.target.value)} className="mt-1 block w-full px-3 py-2 border border-gray-300 bg-white rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-gray-900">
              {priorityOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          </div>
        </div>

        {formError && <p className="text-sm text-red-600">{formError}</p>}

        <div className="flex flex-col sm:flex-row items-center justify-end space-y-2 sm:space-y-0 sm:space-x-3 pt-2">
          <button type="button" onClick={() => router.back()} disabled={isSaving} className="w-full sm:w-auto px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              setAddAnother(true); // Set flag before calling submit
              handleSubmit(null, true); // Pass explicit flag to handle submit logic
            }}
            disabled={isSaving}
            className="w-full sm:w-auto px-4 py-2 text-sm font-medium text-white bg-green-600 border border-transparent rounded-md shadow-sm hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50"
          >
            Save & Add Another
          </button>
          <button type="submit" disabled={isSaving} className="w-full sm:w-auto px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50">
            {isSaving && !addAnother ? 'Saving Task...' : 'Save Task'}
          </button>
        </div>
      </form>
    </MobileLayout>
  );
};

export default MobileAddTaskPage; 
