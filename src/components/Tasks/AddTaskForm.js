'use client';

import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useSession } from 'next-auth/react';
import { quickPickOptions } from '@/lib/dateUtils';

// Reusable form for adding a task. 
// If `projectId` is provided, it's for adding a task to a specific project.
// If `projects` array is provided, it's for adding a task from a general page, requiring project selection.
export default function AddTaskForm({ projectId, projects, onTaskAdded, onClose, defaultPriority = 'Medium' }) {
  const { data: session } = useSession();
  const user = session?.user;
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState(defaultPriority);
  const [selectedProjectId, setSelectedProjectId] = useState(projectId || '');
  
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [addAnother, setAddAnother] = useState(false);

  // Recurrence State
  const [isRepeating, setIsRepeating] = useState(false);
  const [recurrence, setRecurrence] = useState({
    frequency: 'Weekly', // Daily, Weekly, Monthly, Yearly
    interval: 1,
    daysOfWeek: [], // For Weekly: 0 for Sun, 1 for Mon, ..., 6 for Sat
    dayOfMonth: '', // For Monthly on a specific day e.g., 15
    monthlyMode: 'onDay', // 'onDay' or 'onThe'
    monthlyOnTheOrder: 'First', // First, Second, Third, Fourth, Last
    monthlyOnTheDay: 'Monday', // Monday, Tuesday, ..., Sunday, Day
    endDate: '',
    endAfterOccurrences: '',
    endsOnMode: 'onDate' // 'onDate' or 'afterOccurrences'
  });

  const nameInputRef = useRef(null);

  const priorityOptions = ['Low', 'Medium', 'High'];
  const recurrenceFrequencies = ['Daily', 'Weekly', 'Monthly', 'Yearly'];
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const monthlyOrders = ['First', 'Second', 'Third', 'Fourth', 'Last'];
  const monthlyDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'Day'];

  useEffect(() => {
    if (nameInputRef.current) {
      nameInputRef.current.focus();
    }
  }, []);

  useEffect(() => {
    if (projectId) {
      setSelectedProjectId(projectId);
    } else if (projects && projects.length > 0) {
      if (!selectedProjectId || !projects.find(p => p.id === selectedProjectId)) {
        // setSelectedProjectId(projects[0].id); // Example: auto-select first
        // Or leave it empty to force user selection if that's the desired UX
        // For the context of ProjectItem, projectId will always be there, so this branch is less critical.
      }
    } else if (!projectId) {
        // No projectId and no projects list, clear selectedProjectId if it was somehow set.
        // This scenario should ideally not happen if the form is used correctly.
        setSelectedProjectId('');
    }
  }, [projectId, projects, selectedProjectId]);

  useEffect(() => {
    // Set initial priority passed as prop (e.g. from parent project)
    setPriority(defaultPriority);
  }, [defaultPriority]);

  const handleRecurrenceChange = (field, value) => {
    setRecurrence(prev => ({ ...prev, [field]: value }));
  };

  const handleDayOfWeekChange = (dayIndex) => {
    setRecurrence(prev => {
      const newDaysOfWeek = prev.daysOfWeek.includes(dayIndex)
        ? prev.daysOfWeek.filter(d => d !== dayIndex)
        : [...prev.daysOfWeek, dayIndex];
      return { ...prev, daysOfWeek: newDaysOfWeek.sort((a,b) => a-b) };
    });
  };

  const handleSubmit = async (e, shouldAddAnother = false) => {
    if (e && typeof e.preventDefault === 'function') {
      e.preventDefault();
    }
    
    const addingAnother = shouldAddAnother || addAnother;

    if (!user) {
      setError('You must be logged in.');
      return;
    }
    if (!name.trim()) {
      setError('Task name is required.');
      return;
    }
    if (!selectedProjectId) {
      setError('A project must be selected for the task.');
      return;
    }
    // Basic validation for recurrence if active
    if (isRepeating) {
      if (!dueDate) {
        setError('A start date (Due Date) is required for repeating tasks.');
        return;
      }
      if (recurrence.endsOnMode === 'onDate' && !recurrence.endDate) {
        setError('An end date is required for repeating tasks ending on a specific date.');
        return;
      }
      if (recurrence.endsOnMode === 'afterOccurrences' && (!recurrence.endAfterOccurrences || parseInt(recurrence.endAfterOccurrences) <= 0)) {
        setError('A valid number of occurrences is required if task repetition ends after occurrences.');
        return;
      }
      if (recurrence.frequency === 'Weekly' && recurrence.daysOfWeek.length === 0) {
        setError('Please select at least one day for weekly repetition.');
        return;
      }
      if (recurrence.frequency === 'Monthly' && recurrence.monthlyMode === 'onDay' && !recurrence.dayOfMonth) {
        setError('Please specify a day of the month for monthly repetition.');
        return;
      }
    }

    setError(null);
    setLoading(true);

    // TODO: Task generation logic if isRepeating is true.
    // For now, just creates one task.
    const taskData = {
      user_id: user.id,
      project_id: selectedProjectId,
      name: name.trim(),
      description: description.trim() || null,
      due_date: dueDate || null,
      priority: priority,
      is_completed: false,
      // Potentially add recurrence_rule_if_needed to taskData if saving the rule itself
    };

    try {
      // If isRepeating, here you would generate multiple tasks based on recurrence rules
      // and insert them. For now, it just inserts one.
      const { data: newTask, error: insertError } = await supabase
        .from('tasks')
        .insert(taskData) // This would become an array insert if repeating
        .select('*, projects(id, name)') 
        .single(); // Adjust if inserting multiple

      if (insertError) throw insertError;

      // Update parent project's updated_at timestamp
      await supabase
        .from('projects')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', selectedProjectId);

      if (onTaskAdded) {
        onTaskAdded(newTask); 
      }
      
      if (addingAnother) {
        setName('');
        setDescription('');
        setDueDate('');
        // Potentially reset recurrence fields or keep them for next task
        setError(null);
        setAddAnother(false);
        if (nameInputRef.current) {
          nameInputRef.current.focus();
        }
      } else {
        onClose();
      }
    } catch (err) {
      console.error('Error adding task:', err);
      setError(err.message || 'Failed to add task.');
    } finally {
      setLoading(false);
    }
  };

  const frequencyLabel = recurrence.frequency.toLowerCase().slice(0, -2);

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="taskName" className="block text-sm font-medium text-gray-700">
          Task Name <span className="text-red-500">*</span>
        </label>
        <input
          id="taskName"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
          required
          ref={nameInputRef}
        />
      </div>

      {/* Project Selector: Only show if no specific projectId is passed and projects list is available */}
      {!projectId && projects && projects.length > 0 && (
        <div>
          <label htmlFor="project" className="block text-sm font-medium text-gray-700">
            Project <span className="text-red-500">*</span>
          </label>
          <select
            id="project"
            value={selectedProjectId}
            onChange={(e) => setSelectedProjectId(e.target.value)}
            className="mt-1 block w-full px-3 py-2 border border-gray-300 bg-white rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            required
          >
            <option value="" disabled>Select a project</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      )}
      {/* If projectId is provided, could show a disabled input or just text of project name */}
      {projectId && !projects && (
          <div>
            {/* <p className="text-sm text-gray-600">Adding task to a specific project.</p> */}
          </div>
      )}

      <div>
        <label htmlFor="taskDescription" className="block text-sm font-medium text-gray-700">
          Description
        </label>
        <textarea
          id="taskDescription"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label htmlFor="taskDueDate" className="block text-sm font-medium text-gray-700">
            Due Date {isRepeating && <span className="text-xs text-gray-500">(Start Date)</span>}
          </label>
          <input
            id="taskDueDate"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
          />
        </div>
        <div>
          <label htmlFor="taskPriority" className="block text-sm font-medium text-gray-700">
            Priority
          </label>
          <select
            id="taskPriority"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            className="mt-1 block w-full px-3 py-2 border border-gray-300 bg-white rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
          >
            {priorityOptions.map(opt => (<option key={opt} value={opt}>{opt}</option>))}
          </select>
        </div>
      </div>

      {/* Recurrence Section */}
      <div className="pt-2 space-y-3">
        <div className="flex items-center">
          <input 
            id="isRepeatingTask"
            type="checkbox"
            checked={isRepeating}
            onChange={(e) => setIsRepeating(e.target.checked)}
            className="h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
          />
          <label htmlFor="isRepeatingTask" className="ml-2 block text-sm font-medium text-gray-700">
            Make this a repeating task?
          </label>
        </div>

        {isRepeating && (
          <div className="p-3 border border-gray-200 rounded-md bg-gray-50/50 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="recurrenceFrequency" className="block text-xs font-medium text-gray-600">Repeats</label>
                <select 
                  id="recurrenceFrequency"
                  value={recurrence.frequency}
                  onChange={(e) => handleRecurrenceChange('frequency', e.target.value)}
                  className="mt-1 block w-full text-sm px-3 py-1.5 border border-gray-300 bg-white rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
                >
                  {recurrenceFrequencies.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="recurrenceInterval" className="block text-xs font-medium text-gray-600">Every</label>
                <div className="flex items-center mt-1">
                  <input 
                    type="number"
                    id="recurrenceInterval"
                    value={recurrence.interval}
                    min="1"
                    onChange={(e) => handleRecurrenceChange('interval', parseInt(e.target.value) || 1)}
                    className="block w-16 text-sm px-3 py-1.5 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
                  />
                  <span className="ml-2 text-sm text-gray-700">
                    {recurrence.frequency === 'Daily' ? 'day(s)' : recurrence.frequency === 'Weekly' ? 'week(s)' : recurrence.frequency === 'Monthly' ? 'month(s)' : 'year(s)'}
                  </span>
                </div>
              </div>
            </div>

            {recurrence.frequency === 'Weekly' && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">On days</label>
                <div className="flex flex-wrap gap-2">
                  {days.map((day, index) => (
                    <button 
                      type="button"
                      key={day}
                      onClick={() => handleDayOfWeekChange(index)} // Using 0 for Mon, 6 for Sun based on typical Date obj
                      className={`px-2.5 py-1 text-xs rounded-md border ${recurrence.daysOfWeek.includes(index) ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
                    >
                      {day}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {recurrence.frequency === 'Monthly' && (
              <div className="space-y-3">
                <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">On</label>
                    <div className="flex items-center mt-1">
                        <input 
                            type="radio" 
                            id="monthlyOnDay" 
                            name="monthlyRepeatMode"
                            value="onDay"
                            checked={recurrence.monthlyMode === 'onDay'}
                            onChange={() => handleRecurrenceChange('monthlyMode', 'onDay')}
                            className="h-4 w-4 text-indigo-600 border-gray-300 focus:ring-indigo-500"
                        />
                        <label htmlFor="monthlyOnDay" className="ml-2 text-sm text-gray-700 mr-2">Day</label>
                        <input 
                            type="number" 
                            id="monthlyDayOfMonth"
                            value={recurrence.dayOfMonth}
                            min="1" max="31"
                            onChange={(e) => handleRecurrenceChange('dayOfMonth', e.target.value)}
                            disabled={recurrence.monthlyMode !== 'onDay'}
                            className="block w-16 text-sm px-3 py-1.5 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 disabled:bg-gray-100"
                        />
                         <span className="ml-2 text-sm text-gray-700">of the month</span>
                    </div>
                </div>
                <div className="flex items-center">
                    <input 
                        type="radio" 
                        id="monthlyOnThe"
                        name="monthlyRepeatMode" 
                        value="onThe"
                        checked={recurrence.monthlyMode === 'onThe'}
                        onChange={() => handleRecurrenceChange('monthlyMode', 'onThe')}
                        className="h-4 w-4 text-indigo-600 border-gray-300 focus:ring-indigo-500"
                    />
                    <label htmlFor="monthlyOnThe" className="ml-2 text-sm text-gray-700 mr-2">The</label>
                    <select 
                        id="monthlyOnTheOrder" 
                        value={recurrence.monthlyOnTheOrder}
                        onChange={(e) => handleRecurrenceChange('monthlyOnTheOrder', e.target.value)}
                        disabled={recurrence.monthlyMode !== 'onThe'}
                        className="mr-2 text-sm px-3 py-1.5 border border-gray-300 bg-white rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 disabled:bg-gray-100"
                    >
                        {monthlyOrders.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                    <select 
                        id="monthlyOnTheDay" 
                        value={recurrence.monthlyOnTheDay}
                        onChange={(e) => handleRecurrenceChange('monthlyOnTheDay', e.target.value)}
                        disabled={recurrence.monthlyMode !== 'onThe'}
                        className="text-sm px-3 py-1.5 border border-gray-300 bg-white rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 disabled:bg-gray-100"
                    >
                        {monthlyDays.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                </div>
              </div>
            )}

            {/* End Condition */}
            <div className="pt-2">
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Ends</label>
              <div className="space-y-2">
                <div className="flex items-center">
                  <input 
                    type="radio" 
                    id="endsOnDate"
                    name="endsOnMode"
                    value="onDate"
                    checked={recurrence.endsOnMode === 'onDate'}
                    onChange={() => handleRecurrenceChange('endsOnMode', 'onDate')}
                    className="h-4 w-4 text-indigo-600 border-gray-300 focus:ring-indigo-500"
                  />
                  <label htmlFor="endsOnDate" className="ml-2 text-sm text-gray-700 mr-2">On</label>
                  <input 
                    type="date" 
                    id="recurrenceEndDate"
                    value={recurrence.endDate}
                    onChange={(e) => handleRecurrenceChange('endDate', e.target.value)}
                    disabled={recurrence.endsOnMode !== 'onDate'}
                    className="block w-full sm:w-auto text-sm px-3 py-1.5 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 disabled:bg-gray-100"
                  />
                </div>
                <div className="flex items-center">
                  <input 
                    type="radio" 
                    id="endsAfterOccurrences"
                    name="endsOnMode"
                    value="afterOccurrences"
                    checked={recurrence.endsOnMode === 'afterOccurrences'}
                    onChange={() => handleRecurrenceChange('endsOnMode', 'afterOccurrences')}
                    className="h-4 w-4 text-indigo-600 border-gray-300 focus:ring-indigo-500"
                  />
                  <label htmlFor="endsAfterOccurrences" className="ml-2 text-sm text-gray-700 mr-2">After</label>
                  <input 
                    type="number" 
                    id="recurrenceEndAfterOccurrences"
                    value={recurrence.endAfterOccurrences}
                    min="1"
                    onChange={(e) => handleRecurrenceChange('endAfterOccurrences', e.target.value ? parseInt(e.target.value) : '')}
                    disabled={recurrence.endsOnMode !== 'afterOccurrences'}
                    className="block w-20 text-sm px-3 py-1.5 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 disabled:bg-gray-100"
                  />
                  <span className="ml-2 text-sm text-gray-700">occurrence(s)</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="mt-2 flex flex-wrap gap-2 w-full">
        {quickPickOptions.map(option => (
          <span
            key={option.label}
            role="button"
            tabIndex={0}
            onClick={() => setDueDate(option.getValue())}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') setDueDate(option.getValue());
            }}
            className="px-2 py-1 rounded-full bg-gray-200 text-xs font-medium text-gray-700 cursor-pointer hover:bg-indigo-100 focus:outline-none focus:ring-2 focus:ring-indigo-400 select-none"
            style={{ minWidth: 60, textAlign: 'center' }}
          >
            {option.label}
          </span>
        ))}
      </div>

      {error && <p className="text-sm text-red-600">Error: {error}</p>}

      <div className="flex flex-col sm:flex-row justify-end gap-3 pt-2">
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            setAddAnother(true);
            handleSubmit(null, true);
          }}
          disabled={loading}
          className="px-4 py-2 text-sm font-medium text-white bg-green-600 border border-transparent rounded-md shadow-sm hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50"
        >
          Save & Add Another
        </button>
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
        >
          {loading ? 'Saving Task(s)..' : isRepeating ? 'Save Repeating Tasks' : 'Save Task'}
        </button>
      </div>
    </form>
  );
} 