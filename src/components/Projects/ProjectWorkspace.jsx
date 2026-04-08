// src/components/Projects/ProjectWorkspace.jsx
'use client';

import { useCallback, useRef, useState, useMemo } from 'react';
import { Menu } from '@headlessui/react';
import { EllipsisVerticalIcon, TrashIcon } from '@heroicons/react/20/solid';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { apiClient } from '@/lib/apiClient';
import { getStatusClasses, cn } from '@/lib/styleUtils';
import { getDueDateStatus, formatDate } from '@/lib/dateUtils';
import { PROJECT_STATUS, STATE } from '@/lib/constants';
import TaskCard from '@/components/shared/TaskCard';
import AddTaskInput from '@/components/shared/AddTaskInput';
import ProjectNotes from './ProjectNotes';

const STATE_GROUPS = [
  { key: 'today', label: 'Today', labelClass: 'text-red-600' },
  { key: 'this_week', label: 'This Week', labelClass: 'text-blue-600' },
  { key: 'backlog', label: 'Backlog', labelClass: 'text-gray-500' },
  { key: 'waiting', label: 'Waiting', labelClass: 'text-amber-600' },
];

function InlineEdit({ value, onSave, as: Tag = 'span', className = '', inputClassName = '', placeholder = '', maxLength, multiline = false, disabled = false }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || '');
  const inputRef = useRef(null);

  function startEdit() {
    if (disabled) return;
    setDraft(value || '');
    setEditing(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function save() {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed !== (value || '').trim()) {
      onSave(trimmed || null);
    }
  }

  function cancel() {
    setEditing(false);
    setDraft(value || '');
  }

  if (editing) {
    const InputTag = multiline ? 'textarea' : 'input';
    return (
      <InputTag
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Escape') cancel();
          if (e.key === 'Enter' && !multiline) save();
        }}
        maxLength={maxLength}
        placeholder={placeholder}
        className={cn('rounded border border-indigo-300 px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-indigo-400', inputClassName)}
        rows={multiline ? 3 : undefined}
      />
    );
  }

  return (
    <Tag
      onClick={startEdit}
      className={cn('cursor-pointer rounded px-1 hover:bg-gray-100', disabled && 'cursor-default hover:bg-transparent', className)}
      tabIndex={disabled ? undefined : 0}
      onKeyDown={(e) => { if (e.key === 'Enter') startEdit(); }}
      role={disabled ? undefined : 'button'}
      aria-label={disabled ? undefined : `Edit ${placeholder || 'field'}`}
    >
      {value || <span className="text-gray-400 italic">{placeholder}</span>}
    </Tag>
  );
}

export default function ProjectWorkspace({
  project,
  tasks,
  onUpdateProject,
  onDeleteProject,
  onTaskAdded,
  onCompleteTask,
  onMoveTask,
  onUpdateTask,
  onDeleteTask,
  onTaskClick,
}) {
  const sensors = useSensors(useSensor(PointerSensor));
  const isReadOnly = project.status === 'Completed' || project.status === 'Cancelled';

  const tasksByState = useMemo(() => {
    const grouped = {};
    for (const task of tasks) {
      const state = task.state || 'backlog';
      if (!grouped[state]) grouped[state] = [];
      grouped[state].push(task);
    }
    return grouped;
  }, [tasks]);

  const statusClasses = getStatusClasses(project.status);
  const dueDateStatus = getDueDateStatus(project.due_date);


  return (
    <div className="space-y-4">
      {/* Read-only banner */}
      {isReadOnly && (
        <div className="rounded-md border border-gray-200 bg-gray-50 px-4 py-2 text-sm text-gray-600">
          This project is {project.status.toLowerCase()}. Reopen to make changes.
        </div>
      )}

      {/* Header */}
      <div>
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <InlineEdit
              value={project.name}
              onSave={(name) => name && onUpdateProject(project.id, { name })}
              as="h1"
              className="text-xl font-bold text-gray-900"
              inputClassName="text-xl font-bold"
              placeholder="Project name"
              maxLength={255}
              disabled={isReadOnly}
            />
            <select
              value={project.status}
              onChange={(e) => onUpdateProject(project.id, { status: e.target.value })}
              disabled={isReadOnly}
              className={cn('rounded-full border px-2.5 py-0.5 text-xs font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500', statusClasses)}
            >
              {Object.values(PROJECT_STATUS).map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          {/* Project actions menu */}
          <Menu as="div" className="relative shrink-0">
            <Menu.Button className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500" aria-label="Project actions">
              <EllipsisVerticalIcon className="h-5 w-5" />
            </Menu.Button>
            <Menu.Items anchor="bottom end" className="z-50 w-48 rounded-md border border-gray-200 bg-white py-1 shadow-lg focus:outline-none">
              <Menu.Item>
                {({ active }) => (
                  <a href="/plan" className={cn('flex w-full items-center gap-2 px-3 py-1.5 text-sm', active ? 'bg-gray-50 text-gray-900' : 'text-gray-700')}>
                    View in Plan board
                  </a>
                )}
              </Menu.Item>
              <div className="my-1 border-t border-gray-100" />
              <Menu.Item>
                {({ active }) => (
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm('Delete this project? Tasks will become unassigned.')) {
                        onDeleteProject(project.id);
                      }
                    }}
                    className={cn('flex w-full items-center gap-2 px-3 py-1.5 text-sm text-red-600', active && 'bg-red-50')}
                  >
                    <TrashIcon className="h-4 w-4" />
                    Delete project
                  </button>
                )}
              </Menu.Item>
            </Menu.Items>
          </Menu>
        </div>

        {/* Metadata row */}
        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-gray-500">
          {/* Due date */}
          <span className="flex items-center gap-1">
            <span className="text-gray-400">Due:</span>
            <label className="relative cursor-pointer">
              <span
                className={cn(
                  'rounded px-1.5 py-0.5 text-xs font-medium',
                  project.due_date ? [dueDateStatus?.styles?.bg, dueDateStatus?.styles?.text] : 'text-gray-400 hover:text-indigo-600',
                  !isReadOnly && 'cursor-pointer hover:ring-1 hover:ring-indigo-300'
                )}
              >
                {project.due_date ? formatDate(project.due_date, 'MMM d, yyyy') : 'Set date'}
              </span>
              {!isReadOnly && (
                <input
                  type="date"
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  tabIndex={-1}
                  value={project.due_date || ''}
                  onChange={(e) => onUpdateProject(project.id, { due_date: e.target.value || null })}
                />
              )}
            </label>
            {project.due_date && !isReadOnly && (
              <button
                type="button"
                onClick={() => onUpdateProject(project.id, { due_date: null })}
                className="text-xs text-gray-400 hover:text-red-500"
                aria-label="Clear due date"
              >
                ×
              </button>
            )}
          </span>

          <span className="text-gray-300">|</span>

          {/* Area */}
          <span className="flex items-center gap-1">
            <span className="text-gray-400">Area:</span>
            <InlineEdit
              value={project.area}
              onSave={(area) => onUpdateProject(project.id, { area })}
              placeholder="Add area"
              maxLength={255}
              disabled={isReadOnly}
            />
          </span>

          <span className="text-gray-300">|</span>

          {/* Stakeholders */}
          <span className="flex items-center gap-1">
            <span className="text-gray-400">Stakeholders:</span>
            <InlineEdit
              value={(project.stakeholders || []).join(', ')}
              onSave={(val) => {
                const parsed = val ? val.split(',').map((s) => s.trim()).filter(Boolean) : [];
                onUpdateProject(project.id, { stakeholders: parsed });
              }}
              placeholder="Add stakeholders"
              disabled={isReadOnly}
            />
          </span>
        </div>

        {/* Description */}
        <div className="mt-3">
          <InlineEdit
            value={project.description}
            onSave={(description) => onUpdateProject(project.id, { description })}
            as="div"
            className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-sm text-gray-600"
            inputClassName="w-full text-sm"
            placeholder="Add a description…"
            maxLength={5000}
            multiline
            disabled={isReadOnly}
          />
        </div>
      </div>

      <div className="border-t border-gray-100" />

      {/* Two-column body */}
      <div className="flex gap-6" style={{ minHeight: '400px' }}>
        {/* Left: Tasks */}
        <div className="flex-[3] min-w-0 overflow-y-auto">
          <h3 className="mb-3 text-sm font-semibold text-gray-700">Tasks ({tasks.length})</h3>

          {!isReadOnly && (
            <div className="mb-3">
              <AddTaskInput projectId={project.id} onTaskAdded={onTaskAdded} />
            </div>
          )}

          {tasks.length === 0 ? (
            <p className="py-4 text-center text-xs text-gray-400 italic">
              {isReadOnly ? 'No active tasks.' : 'No tasks yet. Add one above to get started.'}
            </p>
          ) : (
            <div className="space-y-4">
              {STATE_GROUPS.map(({ key, label, labelClass }) => {
                const groupTasks = tasksByState[key] || [];
                if (groupTasks.length === 0) return null;
                return (
                  <div key={key}>
                    <p className={cn('mb-1.5 text-[10px] font-bold uppercase tracking-wide', labelClass)}>
                      {label}
                    </p>
                    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={() => {}}>
                      <SortableContext items={groupTasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                        <div className="flex flex-col gap-1.5">
                          {groupTasks.map((task) => (
                            <TaskCard
                              key={task.id}
                              task={task}
                              isDragging={false}
                              onComplete={onCompleteTask}
                              onMove={onMoveTask}
                              onUpdate={onUpdateTask}
                              onClick={onTaskClick}
                              onDelete={onDeleteTask}
                            />
                          ))}
                        </div>
                      </SortableContext>
                    </DndContext>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: Notes */}
        <div className="flex-[2] min-w-0 overflow-y-auto">
          <ProjectNotes projectId={project.id} disabled={isReadOnly} />
        </div>
      </div>
    </div>
  );
}
