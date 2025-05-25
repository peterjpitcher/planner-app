'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import MobileLayout from '@/components/Mobile/MobileLayout';
import { format, parseISO } from 'date-fns';

const MobileEditProjectPage = () => {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const projectId = params?.id;

  const [project, setProject] = useState(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState('Medium');
  const [status, setStatus] = useState('Open');
  const [stakeholders, setStakeholders] = useState(''); // Comma-separated string
  
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState(null);
  const [formError, setFormError] = useState('');

  const projectStatusOptions = ['Open', 'In Progress', 'On Hold', 'Completed', 'Cancelled'];
  const priorityOptions = ['Low', 'Medium', 'High'];

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
      return;
    }
    if (user && projectId) {
      const fetchProjectData = async () => {
        setIsLoading(true);
        setError(null);
        try {
          const { data, error: dbError } = await supabase
            .from('projects')
            .select('*')
            .eq('id', projectId)
            .eq('user_id', user.id)
            .single();
          if (dbError) throw dbError;
          if (data) {
            setProject(data);
            setName(data.name || '');
            setDescription(data.description || '');
            setDueDate(data.due_date ? format(parseISO(data.due_date), 'yyyy-MM-dd') : '');
            setPriority(data.priority || 'Medium');
            setStatus(data.status || 'Open');
            setStakeholders(data.stakeholders ? data.stakeholders.join(', ') : '');
          } else {
            setError('Project not found.');
          }
        } catch (e) {
          console.error('Error fetching project for edit:', e);
          setError('Failed to load project data.');
        }
        setIsLoading(false);
      };
      fetchProjectData();
    }
  }, [user, authLoading, projectId, router]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) {
      setFormError('Project name is required.');
      return;
    }
    setFormError('');
    setIsSaving(true);

    const stakeholdersArray = stakeholders.split(',').map(s => s.trim()).filter(s => s);

    try {
      const { error: updateError } = await supabase
        .from('projects')
        .update({
          name: name.trim(),
          description: description.trim(),
          due_date: dueDate || null,
          priority: priority,
          status: status,
          stakeholders: stakeholdersArray,
          updated_at: new Date().toISOString(),
        })
        .eq('id', projectId)
        .eq('user_id', user.id);

      if (updateError) throw updateError;
      router.replace(`/m/project/${projectId}`); // Navigate back using replace
      // router.refresh(); // Consider if a refresh is needed or if optimistic update is better
    } catch (err) {
      console.error('Error updating project:', err);
      setFormError('Failed to save project. ' + (err.message || ''));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteProject = async () => {
    if (!project || !window.confirm(`Are you sure you want to delete project "${project.name}"? This action cannot be undone and will delete all associated tasks and notes.`)) {
      return;
    }
    setIsDeleting(true);
    setFormError('');
    try {
      const { error: deleteError } = await supabase
        .from('projects')
        .delete()
        .eq('id', projectId)
        .eq('user_id', user.id);
      if (deleteError) throw deleteError;
      // On successful deletion, navigate to the mobile dashboard
      // and ideally, the dashboard should re-fetch or update its list.
      router.replace('/m/dashboard'); 
    } catch (err) {
      console.error('Error deleting project:', err);
      setFormError('Failed to delete project. ' + (err.message || ''));
      setIsDeleting(false); // Only set to false on error, otherwise page navigates away
    }
    // No finally setIsDeleting(false) needed if navigation occurs on success.
  };

  if (isLoading) {
    return <MobileLayout title="Loading Form..."><div className="p-4 text-center">Loading project details...</div></MobileLayout>;
  }
  if (error) {
    return <MobileLayout title="Error"><div className="p-4 text-center text-red-500">{error}</div></MobileLayout>;
  }
  if (!project) { // Should be caught by error state, but as a fallback
    return <MobileLayout title="Not Found"><div className="p-4 text-center">Project not found.</div></MobileLayout>;
  }

  return (
    <MobileLayout title={`Edit: ${project.name}`}>
      <form onSubmit={handleSubmit} className="p-4 space-y-4 bg-white shadow-md rounded-lg">
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-gray-700">Name <span className="text-red-500">*</span></label>
          <input type="text" name="name" id="name" value={name} onChange={(e) => setName(e.target.value)} required className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" />
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
          <div>
            <label htmlFor="status" className="block text-sm font-medium text-gray-700">Status</label>
            <select name="status" id="status" value={status} onChange={(e) => setStatus(e.target.value)} className="mt-1 block w-full px-3 py-2 border border-gray-300 bg-white rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm">
              {projectStatusOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="stakeholders" className="block text-sm font-medium text-gray-700">Stakeholders</label>
            <input type="text" name="stakeholders" id="stakeholders" value={stakeholders} onChange={(e) => setStakeholders(e.target.value)} placeholder="John, Jane (comma-sep)" className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" />
          </div>
        </div>

        {formError && <p className="text-sm text-red-600">{formError}</p>}

        <div className="flex items-center justify-end space-x-3 pt-2">
          <button type="button" onClick={() => router.back()} disabled={isSaving || isDeleting} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50">
            Cancel
          </button>
          <button type="submit" disabled={isSaving || isDeleting} className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50">
            {isSaving ? 'Saving...' : 'Save Project'}
          </button>
        </div>

        {/* Delete Project button and handler are removed as per new requirements */}
        {/* <div className="mt-8 pt-4 border-t border-gray-200">
          <button 
            type="button" 
            onClick={handleDeleteProject} 
            disabled={isSaving || isDeleting}
            className="w-full px-4 py-2 text-sm font-medium text-white bg-red-600 border border-transparent rounded-md shadow-sm hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50 disabled:bg-red-400"
          >
            {isDeleting ? 'Deleting...' : 'Delete Project'}
          </button>
        </div> */}
      </form>
    </MobileLayout>
  );
};

export default MobileEditProjectPage; 