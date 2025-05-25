'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import MobileLayout from '@/components/Mobile/MobileLayout';
import { format, parseISO, isToday, isTomorrow, isPast, startOfDay } from 'date-fns';
import { ArrowLeftIcon, PencilIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import { ClockIcon, FireIcon, ExclamationTriangleIcon, CheckCircleIcon as SolidCheckIcon } from '@heroicons/react/20/solid';

const getPriorityStyles = (priority) => {
  switch (priority) {
    case 'High': return { icon: <FireIcon className="h-5 w-5 text-red-500 inline mr-1" />, textClass: 'text-red-600 font-semibold', badgeClass: 'bg-red-100 text-red-700' };
    case 'Medium': return { icon: <ExclamationTriangleIcon className="h-5 w-5 text-yellow-500 inline mr-1" />, textClass: 'text-yellow-600 font-semibold', badgeClass: 'bg-yellow-100 text-yellow-700' };
    case 'Low': return { icon: <SolidCheckIcon className="h-5 w-5 text-green-500 inline mr-1" />, textClass: 'text-green-600', badgeClass: 'bg-green-100 text-green-700' };
    default: return { icon: <ClockIcon className="h-5 w-5 text-gray-400 inline mr-1" />, textClass: 'text-gray-500', badgeClass: 'bg-gray-100 text-gray-700' };
  }
};

const getDueDateStatusText = (dateString) => {
  if (!dateString) return 'No due date';
  let date;
  if (typeof dateString === 'string' && dateString.match(/^\d{4}-\d{2}-\d{2}$/)) {
    date = startOfDay(new Date(dateString + 'T00:00:00'));
  } else {
    date = startOfDay(parseISO(dateString));
  }
  const today = startOfDay(new Date());
  if (isToday(date)) return 'Due Today';
  if (isTomorrow(date)) return 'Due Tomorrow';
  if (isPast(date)) return `Overdue: ${format(date, 'MMM d, yyyy')}`;
  return `Due: ${format(date, 'MMM d, yyyy')}`;
};

const MobileTaskDetailPage = () => {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const taskId = params?.id;

  const [task, setTask] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [notes, setNotes] = useState([]);
  const [isLoadingNotes, setIsLoadingNotes] = useState(false);
  const [newNoteContent, setNewNoteContent] = useState('');
  const [isAddingNote, setIsAddingNote] = useState(false);

  const fetchData = useCallback(async () => {
    if (!user || !taskId) return;
    setIsLoading(true);
    setError(null);
    setIsLoadingNotes(true); // Start loading notes as well

    try {
      const { data: taskData, error: taskError } = await supabase
        .from('tasks')
        .select('*, projects(id, name)') // Fetch parent project name
        .eq('id', taskId)
        .eq('user_id', user.id)
        .single();

      if (taskError) throw taskError;
      setTask(taskData);

      // Fetch task notes
      const { data: notesData, error: notesError } = await supabase
        .from('notes')
        .select('*')
        .eq('task_id', taskId)
        .order('created_at', { ascending: false }); // Show newest notes first
      
      if (notesError) throw notesError;
      setNotes(notesData || []);

    } catch (e) {
      console.error('Error fetching task details or notes:', e);
      setError('Failed to load task information or notes.');
      setTask(null);
      setNotes([]);
    } finally {
      setIsLoading(false);
      setIsLoadingNotes(false);
    }
  }, [user, taskId]);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    } else if (user && taskId) {
      fetchData();
    }
  }, [user, authLoading, taskId, router, fetchData]);
  
  const handleEditTask = () => {
    console.log('Edit task clicked:', taskId);
    router.push(`/m/task/${taskId}/edit`);
  };

  const handleToggleComplete = async () => {
    if (!task || isUpdatingStatus) return;
    setIsUpdatingStatus(true);
    const newCompletedStatus = !task.is_completed;
    try {
      const { data: updatedTask, error: updateError } = await supabase
        .from('tasks')
        .update({
          is_completed: newCompletedStatus,
          completed_at: newCompletedStatus ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', task.id)
        .select('*, projects(id,name)') // Re-select to get projects info for UI consistency
        .single();

      if (updateError) throw updateError;
      setTask(updatedTask); // Update local state with the full task object
    } catch (err) {
      console.error('Error toggling task status:', err);
      // Optionally show an error message to the user
      alert('Failed to update task status. Please try again.');
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const handleAddNote = async (e) => {
    e.preventDefault();
    if (!newNoteContent.trim() || !user || !task) return;
    setIsAddingNote(true);

    try {
      const { data: newNote, error: insertError } = await supabase
        .from('notes')
        .insert({
          content: newNoteContent.trim(),
          task_id: task.id,
          project_id: task.project_id, // Ensure project_id is available on task object
          user_id: user.id,
        })
        .select()
        .single();
      
      if (insertError) throw insertError;

      setNotes(prevNotes => [newNote, ...prevNotes]); // Add to top for newest first
      setNewNoteContent('');

      // Update task's updated_at timestamp
      await supabase
        .from('tasks')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', task.id);

    } catch (err) {
      console.error('Error adding note:', err);
      alert('Failed to add note. Please try again.');
    } finally {
      setIsAddingNote(false);
    }
  };

  if (authLoading || isLoading) {
    return (
      <MobileLayout title="Loading Task...">
        <div className="text-center py-10"><p className="text-gray-500">Loading task details...</p></div>
      </MobileLayout>
    );
  }

  if (error) {
    return (
      <MobileLayout title="Error">
        <div className="text-center py-10">
          <p className="text-red-500">{error}</p>
          <button onClick={fetchData} className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700">
            Try Again
          </button>
        </div>
      </MobileLayout>
    );
  }

  if (!task) {
    return (
      <MobileLayout title="Task Not Found">
        <div className="text-center py-10">
          <p className="text-gray-500">Sorry, we couldn't find that task.</p>
          <button onClick={() => router.back()} className="mt-4 text-indigo-600 hover:underline">
            Go Back
          </button>
        </div>
      </MobileLayout>
    );
  }

  const priorityInfo = getPriorityStyles(task.priority);
  const dueDateText = getDueDateStatusText(task.due_date);

  return (
    <MobileLayout title={task.name || 'Task Details&apos;'}>
      <div className="bg-white shadow-md rounded-lg p-4">
        <div className="flex justify-between items-center mb-3 space-x-1">
          <button onClick={() => router.back()} className="p-2 rounded-full hover:bg-gray-100 flex-shrink-0" title="Go Back">
            <ArrowLeftIcon className="h-5 w-5 text-gray-700" />
          </button>
          <h1 className="text-xl font-semibold text-gray-800 text-center flex-grow min-w-0 break-words">
            {task.name}
          </h1>
          <div className="flex items-center space-x-1 flex-shrink-0">
            <button onClick={handleEditTask} className="p-2 rounded-full hover:bg-gray-100" title="Edit Task">
              <PencilIcon className="h-5 w-5 text-indigo-600" />
            </button>
            <button 
              onClick={handleToggleComplete}
              disabled={isUpdatingStatus}
              title={task.is_completed ? "Mark as Incomplete" : "Mark as Complete"}
              className={`p-2 rounded-full ${task.is_completed ? 'bg-green-100 hover:bg-green-200' : 'bg-gray-100 hover:bg-gray-200'} ${isUpdatingStatus ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {isUpdatingStatus ? (
                <svg className="animate-spin h-5 w-5 text-gray-700" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              ) : task.is_completed ? (
                <SolidCheckIcon className="h-5 w-5 text-green-600" /> 
              ) : (
                <CheckCircleIcon className="h-5 w-5 text-gray-600" />
              )}
            </button>
          </div>
        </div>

        {task.description && (
          <p className="text-sm text-gray-600 mb-3 whitespace-pre-wrap break-words">
            {task.description}
          </p>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3 text-sm mb-2">
          <div>
            <span className="font-medium text-gray-500">Status:</span>
            <span className={`ml-2 px-2 py-0.5 rounded-full text-xs font-medium ${task.is_completed ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
              {task.is_completed ? 'Completed' : 'Open'}
            </span>
            {task.is_completed && task.completed_at && (
                <span className="ml-2 text-xs text-gray-500">
                    on {format(parseISO(task.completed_at), 'MMM d, yyyy')}
                </span>
            )}
          </div>
          <div>
            <span className="font-medium text-gray-500">Priority:</span>
            <span className={`ml-2 inline-flex items-center ${priorityInfo.textClass}`}>
              {priorityInfo.icon}{task.priority || 'N/A'}
            </span>
          </div>
          <div className="col-span-1 sm:col-span-2">
            <span className="font-medium text-gray-500">Due Date:</span>
            <span className="ml-2 text-gray-700">{dueDateText}</span>
          </div>
          {task.projects && (
            <div className="col-span-1 sm:col-span-2">
              <span className="font-medium text-gray-500">Project:</span>
              <span 
                onClick={() => router.push(`/m/project/${task.projects.id}`)} 
                className="ml-2 text-indigo-600 hover:underline cursor-pointer truncate"
              >
                {task.projects.name}
              </span>
            </div>
          )}
          <div>
            <span className="font-medium text-gray-500">Last Updated:</span>
            <span className="ml-2 text-gray-700">
              {task.updated_at ? format(parseISO(task.updated_at), 'MMM d, yyyy HH:mm') : 'N/A'}
            </span>
          </div>
        </div>
      </div>

      {/* Notes Section */}
      <div className="mt-4 bg-white shadow-md rounded-lg p-4">
        <h2 className="text-lg font-semibold text-gray-700 mb-2">Notes</h2>
        <form onSubmit={handleAddNote} className="mb-3">
          <textarea 
            value={newNoteContent} 
            onChange={(e) => setNewNoteContent(e.target.value)} 
            placeholder="Add a new note..." 
            rows="2"
            className="w-full p-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500 text-sm"
          />
          <button 
            type="submit" 
            disabled={isAddingNote || !newNoteContent.trim()} 
            className="mt-2 px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
          >
            {isAddingNote ? 'Adding Note...' : 'Add Note'}
          </button>
        </form>
        {isLoadingNotes ? (
          <p className="text-sm text-gray-500">Loading notes...</p>
        ) : notes.length > 0 ? (
          <div className="space-y-2">
            {notes.map(note => (
              <div key={note.id} className="bg-gray-50 p-2 rounded-md text-sm">
                <p className="text-gray-800 whitespace-pre-wrap break-words">{note.content}</p>
                <p className="text-xs text-gray-400 mt-1">{format(parseISO(note.created_at), 'MMM d, yyyy HH:mm')}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500">No notes for this task yet.</p>
        )}
      </div>
    </MobileLayout>
  );
};

export default MobileTaskDetailPage; 