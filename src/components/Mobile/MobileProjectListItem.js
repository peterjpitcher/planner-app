'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useSwipeable } from 'react-swipeable';
import { supabase } from '@/lib/supabaseClient';
import { format, isToday, isTomorrow, isPast, startOfDay } from 'date-fns';
import { 
    ClockIcon, CheckCircleIcon as SolidCheckIcon, ExclamationTriangleIcon, FireIcon, 
    ArrowPathIcon, ShieldCheckIcon
} from '@heroicons/react/20/solid';

const getPriorityStyles = (priority) => {
  switch (priority) {
    case 'High':
      return { icon: <FireIcon className="h-4 w-4 text-red-500" />, textClass: 'text-red-600 font-semibold', bgColor: 'bg-red-50' };
    case 'Medium':
      return { icon: <ExclamationTriangleIcon className="h-4 w-4 text-yellow-500" />, textClass: 'text-yellow-600 font-semibold', bgColor: 'bg-yellow-50' };
    case 'Low':
      return { icon: <SolidCheckIcon className="h-4 w-4 text-green-500" />, textClass: 'text-green-600', bgColor: 'bg-green-50' };
    default:
      return { icon: <ClockIcon className="h-4 w-4 text-gray-400" />, textClass: 'text-gray-500', bgColor: 'bg-gray-50' };
  }
};

const getDueDateStatus = (dateString) => {
  if (!dateString) return { text: 'No due date', classes: 'text-gray-500' };
  const date = startOfDay(new Date(dateString));
  const today = startOfDay(new Date());

  if (isToday(date)) return { text: 'Due Today', classes: 'text-red-600 font-bold' };
  if (isTomorrow(date)) return { text: 'Due Tomorrow', classes: 'text-yellow-600 font-semibold' };
  if (isPast(date)) return { text: `Overdue: ${format(date, 'MMM do')}`,
classes: 'text-red-600 font-bold' };
  return { text: `Due ${format(date, 'EEEE, MMM do')}`, classes: 'text-gray-700' };
};

const priorityCycle = ['Low', 'Medium', 'High'];

const MobileProjectListItem = ({ project: initialProject, onProjectUpdated, onProjectDeleted }) => {
  const router = useRouter();
  const [project, setProject] = useState(initialProject);
  const [revealed, setRevealed] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showCompleteTasksModal, setShowCompleteTasksModal] = useState(false);

  useEffect(() => {
    setProject(initialProject);
    setRevealed(null); 
  }, [initialProject]);

  const handleCyclePriority = useCallback(async () => {
    if (isProcessing || !project || project.status === 'Completed' || project.status === 'Cancelled') return;
    setIsProcessing(true);
    const currentPriorityIndex = priorityCycle.indexOf(project.priority || 'Low');
    const nextPriorityIndex = (currentPriorityIndex + 1) % priorityCycle.length;
    const newPriority = priorityCycle[nextPriorityIndex];
    try {
      const { data: updatedProject, error } = await supabase
        .from('projects')
        .update({ priority: newPriority, updated_at: new Date().toISOString() })
        .eq('id', project.id)
        .select('*, tasks(id, is_completed)')
        .single();
      if (error) throw error;
      const projectWithOpenTaskCount = {
          ...updatedProject,
          open_tasks_count: updatedProject.tasks ? updatedProject.tasks.filter(t => !t.is_completed).length : 0,
      };
      setProject(projectWithOpenTaskCount);
      if (onProjectUpdated) onProjectUpdated(projectWithOpenTaskCount);
    } catch (err) {
      console.error('Error cycling project priority:', err);
      alert('Could not update priority.');
    } finally {
      setIsProcessing(false);
      setRevealed(null);
    }
  }, [project, isProcessing, onProjectUpdated]);

  const handleMarkProjectCompleted = useCallback(async (completeTasks = false) => {
    if (isProcessing || !project || project.status === 'Completed' || project.status === 'Cancelled') return;
    
    setIsProcessing(true);
    try {
        if (completeTasks) {
            const { error: taskUpdateError } = await supabase
                .from('tasks')
                .update({ is_completed: true, completed_at: new Date().toISOString() })
                .eq('project_id', project.id)
                .eq('is_completed', false);
            if (taskUpdateError) throw taskUpdateError;
        }

      const { data: updatedProject, error } = await supabase
        .from('projects')
        .update({ status: 'Completed', updated_at: new Date().toISOString() })
        .eq('id', project.id)
        .select('*, tasks(id, is_completed)')
        .single();
      if (error) throw error;
      const projectWithOpenTaskCount = {
        ...updatedProject,
        open_tasks_count: 0,
      };
      setProject(projectWithOpenTaskCount);
      if (onProjectDeleted) onProjectDeleted(project.id); 
    } catch (err) {
      console.error('Error marking project completed:', err);
      alert('Could not mark project as completed.');
    } finally {
      setIsProcessing(false);
      setRevealed(null);
      setShowCompleteTasksModal(false);
    }
  }, [project, isProcessing, onProjectDeleted]);
  
  const checkAndPromptComplete = () => {
    const openTasks = project.open_tasks_count || 0;
    if (openTasks > 0) {
        if (window.confirm(`This project has ${openTasks} open task(s). Mark them as complete along with the project?`)) {
            handleMarkProjectCompleted(true);
        } else {
            setRevealed(null);
        }
    } else {
        handleMarkProjectCompleted(false);
    }
  };

  const swipeHandlers = useSwipeable({
    onSwipedLeft: () => !isProcessing && project.status !== 'Completed' && project.status !== 'Cancelled' && setRevealed('left-complete'),
    onSwipedRight: () => !isProcessing && project.status !== 'Completed' && project.status !== 'Cancelled' && setRevealed('right-priority'),
    onTap: (event) => {
      const tappedOnActionButton = event.event.target.closest('button[data-swipe-action]');
      if (tappedOnActionButton) return;
      if (revealed) {
        setRevealed(null);
      } else if (project) {
        router.push(`/m/project/${project.id}`);
      }
    },
    preventScrollOnSwipe: true,
    trackMouse: true,
    delta: 10,
  });

  if (!project) return null;

  const priorityStylesToUse = getPriorityStyles(project.priority);
  const dueDateStatusToUse = getDueDateStatus(project.due_date);
  const statusColors = {
    'Open': 'text-blue-600 bg-blue-100',
    'In Progress': 'text-purple-600 bg-purple-100',
    'On Hold': 'text-yellow-700 bg-yellow-100',
    'Completed': 'text-green-600 bg-green-100 line-through',
    'Cancelled': 'text-red-600 bg-red-100 line-through',
  };
  const statusClass = statusColors[project.status] || 'text-gray-600 bg-gray-100';

  const openTasksCount = project.open_tasks_count || 0;

  const baseCardClasses = "relative p-3 mb-2 rounded-lg shadow group overflow-hidden";
  const dynamicCardClasses = `${priorityStylesToUse.bgColor} ${(project.status === 'Completed' || project.status === 'Cancelled') && !revealed ? 'opacity-60' : ''}`;
  const contentTransform = revealed === 'left-complete' ? '-translate-x-24' : revealed === 'right-priority' ? 'translate-x-24' : 'translate-x-0';
  const mainContentWrapperClasses = `transition-transform duration-300 ease-out ${contentTransform}`;

  // Add a sticky bottom menu
  const StickyBottomMenu = () => (
    <div className="fixed bottom-0 left-0 right-0 bg-white shadow-md p-2 flex justify-around">
      <button className="text-blue-500">Home</button>
      <button className="text-blue-500">Projects</button>
      <button className="text-blue-500">Tasks</button>
    </div>
  );

  return (
    <div {...swipeHandlers} className={`${baseCardClasses} ${dynamicCardClasses}`}>
      {(project.status !== 'Completed' && project.status !== 'Cancelled') && (
        <div className="absolute inset-y-0 left-0 flex items-center">
          <button 
              data-swipe-action
              onClick={handleCyclePriority} 
              disabled={isProcessing}
              className={`w-24 h-full flex flex-col items-center justify-center p-2 text-xs text-white bg-purple-500 transition-opacity duration-300 ease-out ${revealed === 'right-priority' ? 'opacity-100' : 'opacity-0'}`}
          >
              <ArrowPathIcon className="h-6 w-6 mb-1" />
              {isProcessing ? '...' : 'Priority'}
          </button>
        </div>
      )}

      <div className={`${mainContentWrapperClasses} ${priorityStylesToUse.bgColor} rounded-lg`} onClick={(e) => { if (revealed) e.stopPropagation(); }}>
        <div className="flex justify-between items-start mb-1 space-x-2">
          <h3 className="text-md font-semibold text-gray-800 break-words min-w-0 flex-grow">{project.name || 'Unnamed Project'}</h3>
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${statusClass}`}>
            {project.status || 'N/A'}
          </span>
        </div>

        <div className="flex items-center justify-between text-xs text-gray-600 mb-1.5">
          <div className="flex items-center" title={`Priority: ${project.priority || 'N/A'}`}>
            {priorityStylesToUse.icon}
            <span className={`ml-1 ${priorityStylesToUse.textClass}`}>{project.priority || 'No Priority'}</span>
          </div>
          <div className={`${dueDateStatusToUse.classes} break-words text-right`} title={dueDateStatusToUse.text === 'No due date' ? 'No due date set' : `Due date: ${dueDateStatusToUse.text}`}>
              {dueDateStatusToUse.text}
          </div>
        </div>

        {openTasksCount > 0 && project.status !== 'Completed' && project.status !== 'Cancelled' && (
          <p className="text-2xs text-indigo-600 font-medium">
            {openTasksCount} open task{openTasksCount > 1 ? 's' : ''}
          </p>
        )}
        {project.stakeholders && project.stakeholders.length > 0 && (
          <div className="mt-1.5 pt-1.5 border-t border-gray-200/60">
            <p className="text-2xs text-gray-500 truncate">Stakeholders: {project.stakeholders.join(', ')}</p>
          </div>
        )}
      </div>

      {(project.status !== 'Completed' && project.status !== 'Cancelled') && (
        <div className="absolute inset-y-0 right-0 flex items-center">
          <button 
              data-swipe-action
              onClick={checkAndPromptComplete} 
              disabled={isProcessing} 
              className={`w-24 h-full flex flex-col items-center justify-center p-2 text-xs text-white bg-green-500 transition-opacity duration-300 ease-out ${revealed === 'left-complete' ? 'opacity-100' : 'opacity-0'} rounded-r-lg`}
          >
              <ShieldCheckIcon className="h-6 w-6 mb-1" />
              {isProcessing ? '...' : 'Complete'}
          </button>
        </div>
      )}
      <StickyBottomMenu />
    </div>
  );
};

export default MobileProjectListItem; 