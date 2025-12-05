'use client';

import React, { useState, useEffect } from 'react';
import { formatDistanceToNowStrict, parseISO, format } from 'date-fns';
import { 
  ChevronDownIcon, ChevronRightIcon, UserGroupIcon, ChevronUpIcon,
  CalendarDaysIcon, ChatBubbleLeftEllipsisIcon, PencilSquareIcon,
  ClipboardDocumentIcon, TrashIcon
} from '@heroicons/react/24/outline';
import { useTargetProject } from '@/contexts/TargetProjectContext';
import { quickPickOptions } from '@/lib/dateUtils';
import { getPriorityClasses, getDueDateStatus, getStatusClasses } from '@/lib/projectHelpers';

export default function ProjectHeader({
  project,
  isExpanded,
  onToggleExpand,
  onUpdate,
  onDelete,
  onCopy,
  onToggleNotes,
  showNotes,
  notesCount,
  isLoadingNotes,
  onOpenWorkspace,
  openTasksCount,
  totalTasksCount,
  isDragOverTarget,
  dropStatusText
}) {
  const { setTargetProjectId } = useTargetProject();
  
  // Local editing state
  const [isEditingName, setIsEditingName] = useState(false);
  const [currentName, setCurrentName] = useState(project.name);
  
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [currentDescription, setCurrentDescription] = useState(project.description || '');
  
  const [isEditingDueDate, setIsEditingDueDate] = useState(false);
  const [currentDueDate, setCurrentDueDate] = useState(project.due_date ? format(new Date(project.due_date), 'yyyy-MM-dd') : '');
  
  const [isEditingPriority, setIsEditingPriority] = useState(false);
  const [currentPriority, setCurrentPriority] = useState(project.priority);
  
  const [isEditingStakeholders, setIsEditingStakeholders] = useState(false);
  const [currentStakeholdersText, setCurrentStakeholdersText] = useState(project.stakeholders ? project.stakeholders.join(', ') : '');
  
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);

  // Sync local state with props when project updates
  useEffect(() => {
    setCurrentName(project.name);
    setCurrentDescription(project.description || '');
    setCurrentDueDate(project.due_date ? format(new Date(project.due_date), 'yyyy-MM-dd') : '');
    setCurrentPriority(project.priority);
    setCurrentStakeholdersText(project.stakeholders ? project.stakeholders.join(', ') : '');
  }, [project]);

  const isProjectCompletedOrCancelled = project.status === 'Completed' || project.status === 'Cancelled';
  const priorityStyles = getPriorityClasses(currentPriority);
  const dueDateDisplayStatus = getDueDateStatus(project.due_date, isEditingDueDate, currentDueDate);
  const projectStatusClasses = getStatusClasses(project.status);
  const projectStatusOptions = ['Open', 'In Progress', 'On Hold', 'Completed', 'Cancelled'];

  const updatedAgo = project.updated_at
    ? formatDistanceToNowStrict(parseISO(project.updated_at), { addSuffix: true })
    : 'never';

  const commonInputClasses = "text-xs p-1 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500 disabled:bg-slate-100 disabled:cursor-not-allowed";
  const disabledInputClasses = "bg-slate-100 cursor-not-allowed";

  // Helper for updates
  const handleUpdate = async (field, value, setter, setIsEditing) => {
    if (value === project[field]) {
      setIsEditing(false);
      return;
    }
    
    try {
      const updateObj = { [field]: value };
      // Special case for due_date empty string -> null
      if (field === 'due_date' && !value) updateObj[field] = null;
      
      // Special case for stakeholders string -> array
      if (field === 'stakeholders') {
        updateObj[field] = value.split(',').map(s => s.trim()).filter(Boolean);
      }

      await onUpdate(updateObj);
      // Local state is updated via the useEffect above when parent prop changes
    } catch (error) {
      console.error(`Failed to update ${field}`, error);
      // Revert local state
      setter(project[field]);
    } finally {
      setIsEditing(false);
    }
  };

  // Handlers
  const handleNameSubmit = () => handleUpdate('name', currentName.trim(), setCurrentName, setIsEditingName);
  const handleDescriptionSubmit = () => handleUpdate('description', currentDescription.trim(), setCurrentDescription, setIsEditingDescription);
  const handleDueDateSubmit = (val) => handleUpdate('due_date', val !== undefined ? val : currentDueDate, setCurrentDueDate, setIsEditingDueDate);
  const handlePrioritySubmit = () => handleUpdate('priority', currentPriority, setCurrentPriority, setIsEditingPriority);
  const handleStakeholdersSubmit = () => handleUpdate('stakeholders', currentStakeholdersText, setCurrentStakeholdersText, setIsEditingStakeholders);
  const handleStatusChange = (status) => {
    setShowStatusDropdown(false);
    onUpdate({ status });
  };

  const renderStakeholders = () => {
    if (!project.stakeholders || project.stakeholders.length === 0) {
      return <span className="text-slate-400">No stakeholders</span>;
    }
    // Logic for rendering tags vs truncated list
    return project.stakeholders.map((sh, index) => (
      <span key={index} className="mr-1 mb-1 inline-block rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-600">
        {sh}
      </span>
    ));
  };

  return (
    <div className="relative z-10">
      <div 
        className="relative cursor-pointer rounded-2xl bg-white/65 px-4 py-4 shadow-inner shadow-slate-200/40 transition-colors hover:bg-white/80" 
        onClick={() => { onToggleExpand(); setTargetProjectId(null); }}
        role="button" tabIndex={0} 
        onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === ' ') && !isEditingName && !isEditingDueDate && !isEditingPriority && !isEditingStakeholders) {
                onToggleExpand();
            }
        }}
      >
        {/* Row 1: Icon, Name, Meta Stats */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-y-2 gap-x-3">
          <div className="flex-grow min-w-0 flex items-center gap-2">
            {isExpanded ? (
              <ChevronDownIcon className="h-5 w-5 text-slate-400 flex-shrink-0" />
            ) : (
              <ChevronRightIcon className="h-5 w-5 text-slate-400 flex-shrink-0" />
            )}
            
            {isDragOverTarget && (
               <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-500 mr-2">
                  {dropStatusText}
               </span>
            )}

            {isEditingName ? (
              <input
                type="text"
                value={currentName}
                onChange={(e) => setCurrentName(e.target.value)}
                onBlur={handleNameSubmit}
                onKeyDown={(e) => e.key === 'Enter' && handleNameSubmit() || e.key === 'Escape' && (setCurrentName(project.name), setIsEditingName(false))}
                className={`w-full text-base sm:text-lg font-semibold p-0.5 border-b border-indigo-500/80 bg-white/70 focus:outline-none focus:ring-1 focus:ring-indigo-500 ${isProjectCompletedOrCancelled ? disabledInputClasses : ''}`}
                autoFocus
                onClick={(e) => e.stopPropagation()}
                disabled={isProjectCompletedOrCancelled}
              />
            ) : (
              <h3 
                className={`text-base sm:text-lg font-semibold text-slate-900 truncate ${!isProjectCompletedOrCancelled ? 'cursor-text rounded-md px-1 py-0.5 -mx-1 transition hover:bg-indigo-50/80' : ''} ${project.status === 'Completed' ? 'line-through text-slate-400' : ''}`}
                onClick={(e) => {
                    if (!isProjectCompletedOrCancelled) {
                        e.stopPropagation();
                        setTargetProjectId(null);
                        setIsEditingName(true);
                    }
                }}
                title={project.name}
              >
                {currentName || 'Unnamed Project'}
              </h3>
            )}
          </div>

          {/* Meta: Stakeholders, Dates (Desktop) */}
          <div className="mt-1 ml-7 sm:flex sm:items-center sm:space-x-3 text-xs text-slate-500">
            <div className="hidden items-center text-slate-500 sm:flex">
              <UserGroupIcon className="mr-1 h-4 w-4 text-slate-400" />
              {project.stakeholders && project.stakeholders.length > 0 
                ? project.stakeholders.join(', ') 
                : <span className="text-slate-400">No stakeholders</span>}
            </div>
            
            <div className="hidden sm:flex items-center space-x-3">
              <span className="text-slate-400">•</span>
              <div className={`${dueDateDisplayStatus.classes} break-words`} title={dueDateDisplayStatus.fullDate}>
                  {dueDateDisplayStatus.text}
              </div>
              <span className="text-slate-400">•</span>
              <div className="text-xs text-slate-400">
                  Updated {updatedAgo}
              </div>
            </div>
             {/* Mobile Meta (Stacked) */}
             <div className="sm:hidden mt-1 space-y-1">
                <div className="flex items-center">
                    <UserGroupIcon className="mr-1 h-4 w-4 text-slate-400" />
                    <span className="truncate">{currentStakeholdersText || 'No stakeholders'}</span>
                </div>
                <div className={`${dueDateDisplayStatus.classes} break-words`}>
                    {dueDateDisplayStatus.text}
                </div>
            </div>
          </div>
        </div>

        {/* Row 2: Controls (Status, Priority, Date, Stakeholders, Actions) */}
        <div className="flex items-center gap-x-2 gap-y-1 sm:gap-x-3 flex-wrap justify-start sm:justify-end flex-shrink-0 mt-2">
          
          {/* Status */}
          <div className="relative">
            <button
              onClick={(e) => { 
                e.stopPropagation(); 
                if (isProjectCompletedOrCancelled) return;
                setShowStatusDropdown(!showStatusDropdown); 
              }}
              disabled={isProjectCompletedOrCancelled}
              className={`touch-target-sm text-xs font-medium px-3 py-1.5 rounded-full flex items-center gap-1 whitespace-nowrap border transition ${projectStatusClasses} ${isProjectCompletedOrCancelled ? 'cursor-not-allowed opacity-70' : 'hover:shadow'}`}
            >
              {project.status} <ChevronDownIcon className="w-3 h-3 ml-1 opacity-70"/>
            </button>
            {showStatusDropdown && !isProjectCompletedOrCancelled && (
              <div className="absolute right-0 mt-1 w-40 rounded-2xl border border-[#0496c7]/25 bg-white/95 p-1.5 text-xs text-[#036586] shadow-[0_18px_35px_-28px_rgba(4,150,199,0.45)] z-[100]">
                {projectStatusOptions.map(option => (
                  <button
                    key={option}
                    onClick={(e) => { e.stopPropagation(); handleStatusChange(option); }}
                    className={`block w-full rounded-xl px-3 py-2 text-left transition hover:bg-[#0496c7]/10 ${option === project.status ? 'bg-[#0496c7]/12 font-semibold' : ''}`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Priority */}
          <div className="relative">
            {isEditingPriority && !isProjectCompletedOrCancelled ? (
              <select 
                value={currentPriority}
                onChange={(e) => setCurrentPriority(e.target.value)}
                onBlur={handlePrioritySubmit}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handlePrioritySubmit();
                  } else if (e.key === 'Escape') {
                    setCurrentPriority(project.priority);
                    setIsEditingPriority(false);
                  }
                }}
                onClick={(e) => e.stopPropagation()}
                className="text-xs p-1 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
                autoFocus
              >
                <option value="Low">Low</option>
                <option value="Medium">Medium</option>
                <option value="High">High</option>
              </select>
            ) : (
              <div 
                className="flex items-center cursor-pointer hover:bg-slate-200/50 p-0.5 rounded" 
                onClick={(e) => {
                  e.stopPropagation(); 
                  if (!isProjectCompletedOrCancelled) {
                    setIsEditingPriority(true); 
                    setTargetProjectId(null);
                  }
                }}
                title={`Priority: ${currentPriority || 'N/A'}`}
              >
                {priorityStyles.icon}
                <span className={`ml-1 text-xs ${priorityStyles.textClass}`}>{currentPriority || 'No Priority'}</span>
              </div>
            )}
          </div>

          {/* Due Date */}
          <div className="relative">
              {isEditingDueDate && !isProjectCompletedOrCancelled ? (
                  <div className="flex items-center gap-1 text-xs whitespace-nowrap">
                      <input
                          type="date"
                          value={currentDueDate}
                          onChange={(e) => setCurrentDueDate(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleDueDateSubmit() || e.key === 'Escape' && (setCurrentDueDate(project.due_date ? format(new Date(project.due_date), 'yyyy-MM-dd') : ''), setIsEditingDueDate(false))}
                          onBlur={() => handleDueDateSubmit()}
                          className="w-full rounded-xl border border-[#0496c7]/25 bg-white px-2 py-1 text-xs text-[#052a3b] shadow-inner shadow-[#0496c7]/10 focus:border-[#0496c7] focus:outline-none focus:ring-2 focus:ring-[#0496c7]/30"
                          autoFocus
                          onClick={(e) => e.stopPropagation()}
                      />
                      {/* Quick Pick */}
                      <div className="mt-1.5 flex flex-wrap gap-1.5 absolute top-full left-0 bg-white p-2 shadow-lg rounded-xl z-50">
                          {quickPickOptions.map(option => (
                            <button
                              key={option.label}
                              type="button"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={(e) => {
                                e.stopPropagation();
                                const newDate = option.getValue();
                                handleDueDateSubmit(newDate);
                              }}
                              className="px-2 py-0.5 text-[10px] font-medium text-[#036586] rounded-full border border-[#0496c7]/25 hover:border-[#0496c7]/45 hover:bg-[#0496c7]/10 whitespace-nowrap"
                            >
                              {option.label}
                            </button>
                          ))}
                      </div>
                  </div>
              ) : (
                  <button
                    type="button"
                    className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs transition ${
                      isProjectCompletedOrCancelled
                        ? 'cursor-not-allowed border-transparent text-[#2f617a]/60'
                        : 'border-[#0496c7]/25 text-[#036586] hover:border-[#0496c7]/40 hover:bg-[#0496c7]/10'
                    }`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isProjectCompletedOrCancelled) return;
                      setIsEditingDueDate(true);
                      setTargetProjectId(null);
                    }}
                    title={dueDateDisplayStatus.fullDate || 'Set due date'}
                    disabled={isProjectCompletedOrCancelled}
                  >
                    <CalendarDaysIcon className="h-4 w-4" />
                    <span className="whitespace-nowrap">{dueDateDisplayStatus.text}</span>
                  </button>
              )}
          </div>

          {/* Stakeholders */}
          <div className="relative flex items-center gap-1 text-xs text-[#2f617a] whitespace-nowrap">
              <UserGroupIcon className="w-3.5 h-3.5 opacity-70 flex-shrink-0" />
              {isEditingStakeholders && !isProjectCompletedOrCancelled ? (
                  <input
                      type="text"
                      value={currentStakeholdersText}
                      onChange={(e) => setCurrentStakeholdersText(e.target.value)}
                      onBlur={handleStakeholdersSubmit}
                      onKeyDown={(e) => e.key === 'Enter' && handleStakeholdersSubmit() || e.key === 'Escape' && (setCurrentStakeholdersText(project.stakeholders ? project.stakeholders.join(', ') : ''), setIsEditingStakeholders(false))}
                      className="w-full sm:w-32 rounded-xl border border-[#0496c7]/25 bg-white px-3 py-1 text-xs text-[#052a3b] shadow-inner shadow-[#0496c7]/10 focus:border-[#0496c7] focus:outline-none focus:ring-2 focus:ring-[#0496c7]/30"
                      placeholder="e.g., Team A, Client"
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                  />
              ) : (
                  <button
                      type="button"
                      className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 transition ${
                        isProjectCompletedOrCancelled
                          ? 'cursor-not-allowed border-transparent text-[#2f617a]/60'
                          : 'border-[#0496c7]/25 text-[#036586] hover:border-[#0496c7]/45 hover:bg-[#0496c7]/10'
                      }`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (isProjectCompletedOrCancelled) return;
                        setIsEditingStakeholders(true);
                        setTargetProjectId(null);
                      }}
                      title={isProjectCompletedOrCancelled ? currentStakeholdersText || 'Stakeholders not editable' : currentStakeholdersText || 'Add stakeholders'}
                      disabled={isProjectCompletedOrCancelled}
                  >
                      <span className="font-medium">Stakeholders:</span>
                      <span className="truncate max-w-[6.5rem] sm:max-w-none">{currentStakeholdersText || 'None'}</span>
                  </button>
              )}
          </div>

          {/* Actions Toolbar */}
          <div className="relative ml-auto sm:ml-0 flex items-center gap-x-1">
              <button
                onClick={(e) => { e.stopPropagation(); onToggleNotes(); }}
                className="icon-button rounded-full text-slate-400 hover:bg-slate-200 hover:text-indigo-600 flex items-center focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:ring-offset-1"
                disabled={isLoadingNotes}
                title={showNotes ? "Hide project notes" : "Show project notes"}
              >
                <ChatBubbleLeftEllipsisIcon className="h-5 w-5" />
                {notesCount > 0 && (
                  <span className="ml-1 text-xs font-medium text-indigo-600">
                    ({notesCount})
                  </span>
                )}
              </button>

              <button
                onClick={(e) => { e.stopPropagation(); onOpenWorkspace(); }}
                className="icon-button rounded-full text-slate-400 hover:bg-slate-200 hover:text-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:ring-offset-1 disabled:cursor-not-allowed disabled:text-slate-300"
                title="Open notes workspace"
                type="button"
                disabled={isProjectCompletedOrCancelled}
              >
                <PencilSquareIcon className="h-5 w-5" />
              </button>

              <button
                onClick={(e) => { e.stopPropagation(); onCopy(); }}
                className="icon-button rounded-full text-slate-400 hover:bg-slate-200 hover:text-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:ring-offset-1"
                title="Copy project data"
              >
                <ClipboardDocumentIcon className="h-5 w-5" />
              </button>

              <button
                onClick={(e) => { e.stopPropagation(); onDelete(); }}
                className="icon-button rounded-full text-red-500 hover:bg-red-50 focus:outline-none focus:ring-1 focus:ring-red-400 focus:ring-offset-1"
                title="Delete project"
                type="button"
              >
                <TrashIcon className="h-5 w-5" />
              </button>
          </div>
        </div>

        {/* Row 3: Description */}
        <div className={`px-2.5 sm:px-3 pt-0.5 pb-1.5 border-t border-gray-200/50 mt-2`}>
          {isEditingDescription && !isProjectCompletedOrCancelled ? (
            <textarea
              value={currentDescription}
              onChange={(e) => setCurrentDescription(e.target.value)}
              onBlur={handleDescriptionSubmit}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleDescriptionSubmit() || e.key === 'Escape' && (setCurrentDescription(project.description || ''), setIsEditingDescription(false))}
              className={`${commonInputClasses} w-full min-h-[50px] resize-y text-xs`}
              rows="2"
              autoFocus
              onClick={(e) => e.stopPropagation()}
              placeholder="Project description..."
            />
          ) : currentDescription ? (
            <p 
              className={`text-xs text-slate-500 whitespace-pre-wrap break-words ${!isProjectCompletedOrCancelled ? 'cursor-text hover:bg-gray-50 p-0.5 -m-0.5 rounded' : 'text-slate-400'}`}
              onClick={(e) => {
                if (!isProjectCompletedOrCancelled) {
                    e.stopPropagation();
                    setIsEditingDescription(true);
                }
              }}
            >
              {currentDescription}
            </p>
          ) : !isProjectCompletedOrCancelled ? (
            <p 
              className="text-xs text-slate-400 italic cursor-text hover:bg-gray-50 p-0.5 -m-0.5 rounded break-words"
              onClick={(e) => {
                e.stopPropagation();
                setIsEditingDescription(true);
              }}
            >
              Add project description...
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
