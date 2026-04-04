'use client';

import React, { useState, useEffect } from 'react';
import { formatDistanceToNowStrict, parseISO, format } from 'date-fns';
import {
  ChevronDownIcon, ChevronRightIcon, UserGroupIcon, ChevronUpIcon,
  BriefcaseIcon, CalendarDaysIcon, ChatBubbleLeftEllipsisIcon, PencilSquareIcon,
  ClipboardDocumentIcon, TrashIcon
} from '@heroicons/react/24/outline';
import { toDateInputValue } from '@/lib/dateUtils';
import { getDueDateStatus, getStatusClasses } from '@/lib/projectHelpers';

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
  // Local editing state
  const [isEditingName, setIsEditingName] = useState(false);
  const [currentName, setCurrentName] = useState(project.name);

  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [currentDescription, setCurrentDescription] = useState(project.description || '');

  const [isEditingDueDate, setIsEditingDueDate] = useState(false);
  const [currentDueDate, setCurrentDueDate] = useState(project.due_date ? toDateInputValue(project.due_date) : '');

  const [isEditingArea, setIsEditingArea] = useState(false);
  const [currentArea, setCurrentArea] = useState(project.area || '');

  const [isEditingStakeholders, setIsEditingStakeholders] = useState(false);
  const [currentStakeholdersText, setCurrentStakeholdersText] = useState(project.stakeholders ? project.stakeholders.join(', ') : '');

  const [showStatusDropdown, setShowStatusDropdown] = useState(false);

  // Sync local state with props when project updates
  useEffect(() => {
    setCurrentName(project.name);
    setCurrentDescription(project.description || '');
    setCurrentDueDate(project.due_date ? toDateInputValue(project.due_date) : '');
    setCurrentArea(project.area || '');
    setCurrentStakeholdersText(project.stakeholders ? project.stakeholders.join(', ') : '');
  }, [project]);

  const isProjectCompletedOrCancelled = project.status === 'Completed' || project.status === 'Cancelled';
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

      if (field === 'area') {
        updateObj[field] = value ? value.trim() : null;
      }

      await onUpdate(updateObj);
      // Local state is updated via the useEffect above when parent prop changes
    } catch (error) {
      console.error(`Failed to update ${field}`, error);
      // Revert local state
      setter(field === 'area' ? (project[field] || '') : project[field]);
    } finally {
      setIsEditing(false);
    }
  };

  // Handlers
  const handleNameSubmit = () => handleUpdate('name', currentName.trim(), setCurrentName, setIsEditingName);
  const handleDescriptionSubmit = () => handleUpdate('description', currentDescription.trim(), setCurrentDescription, setIsEditingDescription);
  const handleDueDateSubmit = (val) => handleUpdate('due_date', val !== undefined ? val : currentDueDate, setCurrentDueDate, setIsEditingDueDate);
  const handleAreaSubmit = () => handleUpdate('area', currentArea, setCurrentArea, setIsEditingArea);
  const handleStakeholdersSubmit = () => handleUpdate('stakeholders', currentStakeholdersText, setCurrentStakeholdersText, setIsEditingStakeholders);
  const handleStatusChange = (status) => {
    setShowStatusDropdown(false);
    onUpdate({ status });
  };



  return (
    <div className="relative z-30">
      <div
        className="relative cursor-pointer px-4 pt-4 pb-2 transition-colors hover:bg-muted/30"
        onClick={() => { onToggleExpand(); }}
        role="button" tabIndex={0}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !isEditingName && !isEditingDueDate && !isEditingArea && !isEditingStakeholders) {
            onToggleExpand();
          }
        }}
      >
        {/* UPPER ROW: Name & Actions */}
        <div className="flex items-start justify-between gap-3 mb-3">
          {/* Left: Chevron & Title */}
          <div className="flex items-start gap-2 flex-grow min-w-0 pt-0.5">
            <div className="flex-shrink-0 mt-1 text-muted-foreground/70">
              {isExpanded ? <ChevronDownIcon className="h-4 w-4" /> : <ChevronRightIcon className="h-4 w-4" />}
            </div>

            <div className="flex-grow min-w-0">
              {isDragOverTarget && (
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-500 mb-1">
                  {dropStatusText}
                </div>
              )}

              {isEditingName ? (
                <input
                  type="text"
                  value={currentName}
                  onChange={(e) => setCurrentName(e.target.value)}
                  onBlur={handleNameSubmit}
                  onKeyDown={(e) => e.key === 'Enter' && handleNameSubmit() || e.key === 'Escape' && (setCurrentName(project.name), setIsEditingName(false))}
                  className={`w-full text-base font-semibold p-0.5 border-b border-primary/50 bg-transparent focus:outline-none focus:ring-1 focus:ring-primary ${isProjectCompletedOrCancelled ? disabledInputClasses : ''}`}
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                  disabled={isProjectCompletedOrCancelled}
                />
              ) : (
                <h3
                  className={`text-base font-semibold text-foreground break-words leading-tight ${!isProjectCompletedOrCancelled ? 'cursor-text hover:text-primary transition-colors' : ''} ${project.status === 'Completed' ? 'line-through text-muted-foreground' : ''}`}
                  onClick={(e) => {
                    if (!isProjectCompletedOrCancelled) {
                      e.stopPropagation();
                      setIsEditingName(true);
                    }
                  }}
                  title={project.name}
                >
                  {currentName || 'Unnamed Project'}
                </h3>
              )}
            </div>
          </div>

          {/* Right: Actions Toolbar (Always visible now for better UX, or hover-only if preferred, but usually always visible is better for mobile) */}
          <div className="flex items-center gap-1 flex-shrink-0 ml-2">
            <button
              onClick={(e) => { e.stopPropagation(); onToggleNotes(); }}
              className="icon-button h-7 w-7 rounded-md text-muted-foreground/70 hover:bg-muted hover:text-primary flex items-center justify-center transition-colors"
              disabled={isLoadingNotes}
              title={showNotes ? "Hide project notes" : "Show project notes"}
            >
              <ChatBubbleLeftEllipsisIcon className="h-4 w-4" />
              {notesCount > 0 && (
                <span className="absolute top-0 right-0 -mt-1 -mr-1 flex h-3 w-3 items-center justify-center rounded-full bg-primary text-[8px] font-bold text-white">
                  {notesCount}
                </span>
              )}
            </button>

            <button
              onClick={(e) => { e.stopPropagation(); onOpenWorkspace(); }}
              className="icon-button h-7 w-7 rounded-md text-muted-foreground/70 hover:bg-muted hover:text-primary flex items-center justify-center transition-colors disabled:opacity-50"
              title="Open notes workspace"
              disabled={isProjectCompletedOrCancelled}
            >
              <PencilSquareIcon className="h-4 w-4" />
            </button>

            <button
              onClick={(e) => { e.stopPropagation(); onCopy(); }}
              className="icon-button h-7 w-7 rounded-md text-muted-foreground/70 hover:bg-muted hover:text-primary flex items-center justify-center transition-colors"
              title="Copy project data"
            >
              <ClipboardDocumentIcon className="h-4 w-4" />
            </button>

            <button
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              className="icon-button h-7 w-7 rounded-md text-muted-foreground/70 hover:bg-red-50 hover:text-red-500 flex items-center justify-center transition-colors"
              title="Delete project"
            >
              <TrashIcon className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* LOWER ROW: Metadata Chips & Description */}
        <div className="pl-6 space-y-3">

          {/* Metadata Chips - Unified Interactive Bar */}
          <div className="flex flex-wrap items-center gap-2 text-xs">

            {/* Status Pill */}
            <div className="relative">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (isProjectCompletedOrCancelled) return;
                  setShowStatusDropdown(!showStatusDropdown);
                }}
                disabled={isProjectCompletedOrCancelled}
                className={`group flex items-center gap-1.5 rounded-md border px-2 py-1 font-medium transition-all ${projectStatusClasses} ${isProjectCompletedOrCancelled ? 'cursor-not-allowed opacity-70' : 'hover:shadow-sm'}`}
              >
                {project.status}
                <ChevronDownIcon className="h-3 w-3 opacity-50 group-hover:opacity-100 transition-opacity" />
              </button>
              {showStatusDropdown && !isProjectCompletedOrCancelled && (
                <div className="absolute left-0 top-full mt-1 w-36 rounded-xl border border-border bg-popover p-1 shadow-lg z-50 animate-in fade-in zoom-in-95 duration-100">
                  {projectStatusOptions.map(option => (
                    <button
                      key={option}
                      onClick={(e) => { e.stopPropagation(); handleStatusChange(option); }}
                      className={`block w-full rounded-lg px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent hover:text-accent-foreground ${option === project.status ? 'bg-accent/50 font-medium' : ''}`}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="h-4 w-px bg-border/60 mx-1 hidden sm:block"></div>

            {/* Date */}
            <div className="relative">
              {isEditingDueDate && !isProjectCompletedOrCancelled ? (
                <div className="absolute top-0 left-0 z-50">
                  <input
                    type="date"
                    value={currentDueDate}
                    onChange={(e) => setCurrentDueDate(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleDueDateSubmit() || e.key === 'Escape' && (setCurrentDueDate(project.due_date ? toDateInputValue(project.due_date) : ''), setIsEditingDueDate(false))}
                    onBlur={() => handleDueDateSubmit()}
                    className="w-auto rounded-md border border-input bg-background px-2 py-1 text-xs shadow-md focus:outline-none focus:ring-1 focus:ring-ring"
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!isProjectCompletedOrCancelled) {
                      setIsEditingDueDate(true);
                    }
                  }}
                  className={`flex items-center gap-1.5 rounded-md px-2 py-1 transition-colors hover:bg-muted ${dueDateDisplayStatus.classes}`}
                  title={dueDateDisplayStatus.fullDate || 'Set due date'}
                  disabled={isProjectCompletedOrCancelled}
                >
                  <CalendarDaysIcon className="h-3.5 w-3.5 opacity-70" />
                  <span className="font-medium">{dueDateDisplayStatus.text}</span>
                </button>
              )}
            </div>

            {/* Area */}
            <div className="relative max-w-[150px]">
              {isEditingArea && !isProjectCompletedOrCancelled ? (
                <input
                  type="text"
                  value={currentArea}
                  onChange={(e) => setCurrentArea(e.target.value)}
                  onBlur={handleAreaSubmit}
                  onKeyDown={(e) => e.key === 'Enter' && handleAreaSubmit() || e.key === 'Escape' && (setCurrentArea(project.area || ''), setIsEditingArea(false))}
                  className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                  placeholder="Area name"
                />
              ) : (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!isProjectCompletedOrCancelled) {
                      setIsEditingArea(true);
                    }
                  }}
                  className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground ${isProjectCompletedOrCancelled ? 'cursor-not-allowed opacity-70' : ''}`}
                  title="Edit area"
                  disabled={isProjectCompletedOrCancelled}
                >
                  <BriefcaseIcon className="h-3.5 w-3.5 opacity-70" />
                  <span className="truncate font-medium">{currentArea || 'No Area'}</span>
                </button>
              )}
            </div>

            {/* Stakeholders */}
            <div className="relative max-w-[200px]">
              {isEditingStakeholders && !isProjectCompletedOrCancelled ? (
                <input
                  type="text"
                  value={currentStakeholdersText}
                  onChange={(e) => setCurrentStakeholdersText(e.target.value)}
                  onBlur={handleStakeholdersSubmit}
                  onKeyDown={(e) => e.key === 'Enter' && handleStakeholdersSubmit() || e.key === 'Escape' && (setCurrentStakeholdersText(project.stakeholders ? project.stakeholders.join(', ') : ''), setIsEditingStakeholders(false))}
                  className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                  placeholder="Comma separated"
                />
              ) : (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!isProjectCompletedOrCancelled) {
                      setIsEditingStakeholders(true);
                    }
                  }}
                  className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground ${isProjectCompletedOrCancelled ? 'cursor-not-allowed opacity-70' : ''}`}
                  title="Edit stakeholders"
                  disabled={isProjectCompletedOrCancelled}
                >
                  <UserGroupIcon className="h-3.5 w-3.5 opacity-70" />
                  <span className="truncate font-medium">{currentStakeholdersText || 'No Team'}</span>
                </button>
              )}
            </div>

            <div className="flex-grow"></div>

            {/* Updated Timestamp */}
            <div className="text-[10px] text-muted-foreground/50 whitespace-nowrap hidden sm:block">
              {updatedAgo}
            </div>
          </div>

          {/* Description Block */}
          <div className="min-h-[22px]">
            {isEditingDescription && !isProjectCompletedOrCancelled ? (
              <textarea
                value={currentDescription}
                onChange={(e) => setCurrentDescription(e.target.value)}
                onBlur={handleDescriptionSubmit}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleDescriptionSubmit() || e.key === 'Escape' && (setCurrentDescription(project.description || ''), setIsEditingDescription(false))}
                className={`${commonInputClasses} w-full min-h-[50px] resize-y text-xs bg-muted/20`}
                rows="2"
                autoFocus
                onClick={(e) => e.stopPropagation()}
                placeholder="Add a description..."
              />
            ) : (
              <p
                className={`text-xs leading-relaxed text-muted-foreground/80 break-words ${!isProjectCompletedOrCancelled ? 'cursor-text hover:text-foreground transition-colors' : ''} ${!currentDescription ? 'italic opacity-60' : ''}`}
                onClick={(e) => {
                  if (!isProjectCompletedOrCancelled) {
                    e.stopPropagation();
                    setIsEditingDescription(true);
                  }
                }}
              >
                {currentDescription || 'No description provided.'}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
