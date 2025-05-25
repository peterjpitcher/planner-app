'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useSwipeable } from 'react-swipeable';
import { supabase } from '@/lib/supabaseClient';
import { format, isToday, isTomorrow, isPast, startOfDay, parseISO } from 'date-fns';
import { 
    ClockIcon, FireIcon, ExclamationTriangleIcon, 
    CheckCircleIcon as SolidCheckIcon, ArrowPathIcon, ShieldCheckIcon // Replaced Pencil, Trash
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
  
  let date;
  // Handle both yyyy-MM-dd and full ISO strings
  if (typeof dateString === 'string' && dateString.match(/^\d{4}-\d{2}-\d{2}$/)) {
    date = startOfDay(new Date(dateString + 'T00:00:00')); // Ensure it's parsed as local time
  } else {
    date = startOfDay(parseISO(dateString));
  }
  
  const today = startOfDay(new Date());

  if (isToday(date)) return { text: 'Due Today', classes: 'text-red-600 font-bold' };
  if (isTomorrow(date)) return { text: 'Due Tomorrow', classes: 'text-yellow-600 font-semibold' };
  if (isPast(date) && !isToday(date)) return { text: `Overdue: ${format(date, 'MMM do')}`, classes: 'text-red-700 font-bold' };
  return { text: `Due ${format(date, 'MMM do')}`, classes: 'text-gray-700' }; // Simplified date format for mobile
};

const priorityCycle = ['Low', 'Medium', 'High'];

const MobileTaskListItem = ({ task: initialTask, onTaskUpdated, onTaskDeleted }) => {
  const router = useRouter();
  const [task, setTask] = useState(initialTask);
  const [revealed, setRevealed] = useState(null); // 'left-complete', 'right-priority', or null
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    setTask(initialTask);
    setRevealed(null);
  }, [initialTask]);

  const handleToggleComplete = useCallback(async () => {
    if (isProcessing || !task) return;
    setIsProcessing(true);
    const newCompletedStatus = !task.is_completed;
    try {
      const { data: updatedTask, error } = await supabase
        .from('tasks')
        .update({ 
            is_completed: newCompletedStatus,
            completed_at: newCompletedStatus ? new Date().toISOString() : null,
            updated_at: new Date().toISOString()
        })
        .eq('id', task.id)
        .select('*, projects(id, name)')
        .single();
      if (error) throw error;
      setTask(updatedTask);
      if (onTaskUpdated) onTaskUpdated(updatedTask);
    } catch (err) {
      console.error('Error toggling task completion:', err);
      alert('Could not update task status.');
    } finally {
      setIsProcessing(false);
      setRevealed(null);
    }
  }, [task, isProcessing, onTaskUpdated]);

  const handleCyclePriority = useCallback(async () => {
    if (isProcessing || !task) return;
    setIsProcessing(true);
    const currentPriorityIndex = priorityCycle.indexOf(task.priority || 'Low');
    const nextPriorityIndex = (currentPriorityIndex + 1) % priorityCycle.length;
    const newPriority = priorityCycle[nextPriorityIndex];
    try {
      const { data: updatedTask, error } = await supabase
        .from('tasks')
        .update({ priority: newPriority, updated_at: new Date().toISOString() })
        .eq('id', task.id)
        .select('*, projects(id, name)')
        .single();
      if (error) throw error;
      setTask(updatedTask);
      if (onTaskUpdated) onTaskUpdated(updatedTask);
    } catch (err) {
      console.error('Error cycling task priority:', err);
      alert('Could not update priority.');
    } finally {
      setIsProcessing(false);
      setRevealed(null);
    }
  }, [task, isProcessing, onTaskUpdated]);

  const swipeHandlers = useSwipeable({
    onSwipedLeft: () => !isProcessing && setRevealed('left-complete'), // Mark Complete/Open
    onSwipedRight: () => !isProcessing && !task.is_completed && setRevealed('right-priority'), // Cycle Priority (only if not completed)
    onTap: (event) => {
      const tappedOnActionButton = event.event.target.closest('button[data-swipe-action]');
      if (tappedOnActionButton) return;
      if (revealed) {
        setRevealed(null);
      } else if (task) {
        router.push(`/m/task/${task.id}`);
      }
    },
    preventScrollOnSwipe: true,
    trackMouse: true,
    delta: 10,
  });

  if (!task) return null;

  const priorityStylesToUse = getPriorityStyles(task.priority);
  const dueDateStatusToUse = getDueDateStatus(task.due_date);
  
  const baseCardClasses = "relative p-3 mb-2 rounded-lg shadow group overflow-hidden";
  const dynamicCardClasses = `${priorityStylesToUse.bgColor} ${task.is_completed && !revealed ? 'opacity-60' : ''}`;
  
  const contentTransform = revealed === 'left-complete' ? '-translate-x-24' : revealed === 'right-priority' ? 'translate-x-24' : 'translate-x-0';
  const mainContentWrapperClasses = `transition-transform duration-300 ease-out ${contentTransform}`;

  return (
    <div {...swipeHandlers} className={`${baseCardClasses} ${dynamicCardClasses}`}>
      {/* Background Action: Cycle Priority (Revealed on Swipe Right) */}
      {!task.is_completed && (
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

      {/* Main Task Content - This div moves */}
      <div className={`${mainContentWrapperClasses} ${priorityStylesToUse.bgColor} rounded-lg`} onClick={(e) => { if (revealed) e.stopPropagation(); }}>
        <div className="flex justify-between items-start mb-1 space-x-2">
          <h3 className={`text-md font-semibold text-gray-800 break-words min-w-0 flex-grow ${task.is_completed ? 'line-through' : ''}`}>
            {task.name || 'Unnamed Task'}
          </h3>
        </div>
        <div className="flex items-center justify-between text-xs text-gray-600 mb-1.5">
          <div className="flex items-center" title={`Priority: ${task.priority || 'N/A'}`}>
            {priorityStylesToUse.icon}
            <span className={`ml-1 ${priorityStylesToUse.textClass} ${task.is_completed ? 'line-through' : ''}`}>{task.priority || 'No Priority'}</span>
          </div>
          <div className={`${dueDateStatusToUse.classes} ${task.is_completed ? 'line-through' : ''} break-words text-right`} title={dueDateStatusToUse.text === 'No due date' ? 'No due date set' : `Due date: ${dueDateStatusToUse.text}`}>
              {dueDateStatusToUse.text}
          </div>
        </div>
        {task.projects && (
          <p className="text-2xs text-indigo-600 font-medium truncate" title={`Project: ${task.projects.name}`}>
            Project: {task.projects.name}
          </p>
        )}
      </div>

      {/* Background Action: Mark Complete/Incomplete (Revealed on Swipe Left) */}
      <div className="absolute inset-y-0 right-0 flex items-center">
         <button 
            data-swipe-action
            onClick={handleToggleComplete} 
            disabled={isProcessing} 
            className={`w-24 h-full flex flex-col items-center justify-center p-2 text-xs text-white ${task.is_completed ? 'bg-yellow-500' : 'bg-green-500'} transition-opacity duration-300 ease-out ${revealed === 'left-complete' ? 'opacity-100' : 'opacity-0'} rounded-r-lg`}
        >
            <ShieldCheckIcon className="h-6 w-6 mb-1" /> {/* Using ShieldCheckIcon for complete/open verb */}
            {isProcessing ? '...' : (task.is_completed ? 'Mark Open' : 'Complete')}
        </button>
      </div>
    </div>
  );
};

export default MobileTaskListItem; 