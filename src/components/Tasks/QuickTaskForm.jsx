'use client';

import { useState, useMemo, useRef } from 'react';
import { PlusIcon } from '@heroicons/react/24/outline';

const defaultSelectOptions = [
  { value: 'Low', label: 'Low' },
  { value: 'Medium', label: 'Medium' },
  { value: 'High', label: 'High' },
];

const todayISO = () => {
  const today = new Date();
  const month = `${today.getMonth() + 1}`.padStart(2, '0');
  const day = `${today.getDate()}`.padStart(2, '0');
  return `${today.getFullYear()}-${month}-${day}`;
};

export default function QuickTaskForm({
  onSubmit,
  namePlaceholder = 'What needs doing?',
  buttonLabel = 'Add',
  buttonIcon: ButtonIcon = PlusIcon,
  className = '',
  defaultDueDate,
  defaultPriority = 'Medium',
  priorityType = 'pills',
  priorityOptions,
  resetDateOnSubmit = false,
  autoFocus = false,
}) {
  const initialDueDate = defaultDueDate || todayISO();
  const [name, setName] = useState('');
  const [dueDate, setDueDate] = useState(initialDueDate);
  const [priority, setPriority] = useState(defaultPriority);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef(null);

  const pillOptions = useMemo(() => {
    if (priorityType !== 'pills') return [];
    return (priorityOptions || []).map(option => ({
      value: option.value,
      icon: option.icon,
      label: option.label || option.value,
      tooltip: option.tooltip || option.label || option.value,
    }));
  }, [priorityOptions, priorityType]);

  const selectOptions = useMemo(() => {
    if (priorityType !== 'select') return defaultSelectOptions;
    return priorityOptions && priorityOptions.length > 0 ? priorityOptions : defaultSelectOptions;
  }, [priorityOptions, priorityType]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Give this task a name first.');
      return;
    }
    if (!dueDate) {
      setError('Pick a due date.');
      return;
    }
    if (!onSubmit) return;

    setSubmitting(true);
    setError('');
    try {
      await onSubmit({
        name: trimmedName,
        dueDate,
        priority,
      });
      setName('');
      if (resetDateOnSubmit) {
        setDueDate(defaultDueDate || todayISO());
      }
      requestAnimationFrame(() => {
        if (inputRef.current) {
          inputRef.current.focus();
        }
      });
    } catch (err) {
      setError(err?.message || 'Something went wrong while creating that task.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className={`space-y-3 ${className}`}>
      <div>
        <label htmlFor="quick-task-name" className="sr-only">
          Task name
        </label>
        <input
        id="quick-task-name"
        type="text"
        placeholder={namePlaceholder}
        value={name}
        onChange={(event) => {
          setName(event.target.value);
          if (error) setError('');
        }}
        className="w-full rounded-xl border border-[#0496c7]/25 bg-white px-4 py-2 text-sm text-[#052a3b] shadow-inner shadow-[#0496c7]/10 placeholder:text-[#2f617a]/70 focus:border-[#0496c7] focus:outline-none focus:ring-2 focus:ring-[#0496c7]/30"
        disabled={submitting}
        autoFocus={autoFocus}
        ref={inputRef}
      />
      </div>

      <div className={`flex flex-col gap-2 ${priorityType === 'select' ? 'sm:flex-row sm:items-center sm:gap-3' : 'sm:flex-row sm:items-center sm:gap-3'}`}>
        <label htmlFor="quick-task-date" className="sr-only">
          Due date
        </label>
        <input
          id="quick-task-date"
          type="date"
          value={dueDate}
          onChange={(event) => {
            setDueDate(event.target.value);
            if (error) setError('');
          }}
          className="w-full rounded-xl border border-[#0496c7]/25 bg-white px-3 py-2 text-sm text-[#052a3b] shadow-inner shadow-[#0496c7]/10 focus:border-[#0496c7] focus:outline-none focus:ring-2 focus:ring-[#0496c7]/30 sm:w-auto sm:min-w-[160px]"
          disabled={submitting}
        />

        {priorityType === 'select' && (
          <select
            value={priority}
            onChange={(event) => setPriority(event.target.value)}
            className="w-full rounded-xl border border-[#0496c7]/25 bg-white px-3 py-2 text-sm text-[#052a3b] shadow-inner shadow-[#0496c7]/10 focus:border-[#0496c7] focus:outline-none focus:ring-2 focus:ring-[#0496c7]/30 sm:w-auto"
            disabled={submitting}
          >
            {selectOptions.map(option => (
              <option key={option.value} value={option.value}>
                {option.label || option.value}
              </option>
            ))}
          </select>
        )}

        <button
          type="submit"
          className="inline-flex items-center justify-center rounded-xl bg-[#0496c7] px-4 py-2 text-sm font-semibold text-white shadow-md shadow-[#0496c7]/25 transition hover:bg-[#0382ac] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0496c7]/40 disabled:pointer-events-none disabled:opacity-60"
          disabled={submitting}
        >
          {ButtonIcon && <ButtonIcon className="mr-1.5 h-4 w-4" />}
          {submitting ? 'Adding…' : buttonLabel}
        </button>
      </div>

      {priorityType === 'pills' && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2">
            {pillOptions.map(({ value, icon: Icon, label, tooltip }) => {
              const active = priority === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    setPriority(value);
                    if (error) setError('');
                  }}
                  className={`inline-flex h-9 min-w-[2.5rem] items-center justify-center gap-2 rounded-xl border px-3 text-xs transition ${
                    active
                      ? 'border-[#0496c7] bg-[#0496c7]/15 text-[#036586] shadow-inner shadow-[#0496c7]/25'
                      : 'border-transparent bg-white text-[#2f617a]/70 hover:border-[#0496c7]/30 hover:bg-[#0496c7]/10 hover:text-[#036586]'
                  }`}
                  title={tooltip}
                  aria-pressed={active}
                  disabled={submitting}
                >
                  {Icon && <Icon className="h-4 w-4" />}
                  <span className="hidden sm:inline">{label}</span>
                </button>
              );
            })}
          </div>
          {error && <p className="text-xs font-medium text-rose-500">{error}</p>}
        </div>
      )}

      {priorityType === 'select' && error && (
        <p className="text-xs font-medium text-rose-500">{error}</p>
      )}
    </form>
  );
}

export { todayISO };
