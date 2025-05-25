'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { 
  startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, 
  addDays, subDays, addWeeks, subWeeks, addMonths, subMonths, format, isEqual,
  eachDayOfInterval, getWeekOfMonth, parseISO
} from 'date-fns';
import { ChevronLeftIcon, ChevronRightIcon, CalendarDaysIcon, ClipboardDocumentIcon, FunnelIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';
import NoteList from '@/components/Notes/NoteList'; // Assuming this can be reused

const CompletedReportPage = () => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewType, setViewType] = useState('day'); // 'day', 'week', 'month'
  const [dateRange, setDateRange] = useState({ startDate: startOfDay(new Date()), endDate: endOfDay(new Date()) });
  
  const [completedTasksData, setCompletedTasksData] = useState([]);
  const [completedProjectsData, setCompletedProjectsData] = useState([]);
  const [allUserNotes, setAllUserNotes] = useState([]);
  
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const [projectVisibility, setProjectVisibility] = useState({});
  const [projectsInPeriod, setProjectsInPeriod] = useState([]);
  const [copyStatusMessage, setCopyStatusMessage] = useState('Copy Report');
  const [hideBillStakeholder, setHideBillStakeholder] = useState(false);

  // Calculate date range based on viewType and currentDate
  useEffect(() => {
    let startDate, endDate;
    const today = startOfDay(currentDate); // Ensure currentDate is used

    switch (viewType) {
      case 'week':
        startDate = startOfWeek(today, { weekStartsOn: 1 }); // Assuming Monday start
        endDate = endOfWeek(today, { weekStartsOn: 1 });
        break;
      case 'month':
        startDate = startOfMonth(today);
        endDate = endOfMonth(today);
        break;
      case 'day':
      default:
        startDate = startOfDay(today);
        endDate = endOfDay(today);
        break;
    }
    setDateRange({ startDate, endDate });
  }, [currentDate, viewType]);

  // Fetch completed items and all notes
  const fetchCompletedItems = useCallback(async () => {
    if (!dateRange.startDate || !dateRange.endDate) return;

    setIsLoading(true);
    setError(null);
    setCopyStatusMessage('Copy Report');

    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !sessionData.session) {
        throw new Error(sessionError?.message || 'User not authenticated');
      }
      const userId = sessionData.session.user.id;

      // Fetch completed tasks within date range
      const { data: tasks, error: tasksError } = await supabase
        .from('tasks')
        .select('*, project_id (id, name, stakeholders), notes(*)')
        .eq('user_id', userId)
        .eq('is_completed', true)
        .gte('completed_at', dateRange.startDate.toISOString())
        .lte('completed_at', dateRange.endDate.toISOString())
        .order('completed_at', { ascending: true });
      if (tasksError) throw tasksError;
      setCompletedTasksData(tasks || []);

      // Fetch completed projects within date range
      const { data: projects, error: projectsError } = await supabase
        .from('projects')
        .select('*, notes(*), stakeholders') // Ensure stakeholders are fetched
        .eq('user_id', userId)
        .eq('status', 'Completed')
        .gte('updated_at', dateRange.startDate.toISOString()) // Assuming updated_at reflects completion date for projects
        .lte('updated_at', dateRange.endDate.toISOString())
        .order('updated_at', { ascending: true });
      if (projectsError) throw projectsError;
      setCompletedProjectsData(projects || []);

      // Fetch all user notes (not just within period initially, for "Other notes" calculation)
      const { data: notes, error: notesError } = await supabase
        .from('notes')
        .select('*, tasks(name, project_id (id, name, stakeholders)), projects(id, name, stakeholders)')
        .eq('user_id', userId)
        .order('created_at', { ascending: true });
      if (notesError) throw notesError;
      setAllUserNotes(notes || []);

    } catch (err) {
      console.error('Error fetching completed items:', err);
      setError(err.message || 'Failed to fetch data.');
      setCompletedTasksData([]);
      setCompletedProjectsData([]);
      setAllUserNotes([]);
    } finally {
      setIsLoading(false);
    }
  }, [dateRange]);

  useEffect(() => {
    fetchCompletedItems();
  }, [fetchCompletedItems]);
  
  // Derive projectsInPeriod for the filter panel from fetched data
  useEffect(() => {
    const projectsMap = new Map();
    
    // Process all potential project sources to populate the map for the filter panel
    // Stakeholder data will be directly on tasks/notes for filtering later

    completedProjectsData.forEach(project => {
      if (!projectsMap.has(project.id)) {
        projectsMap.set(project.id, { 
          id: project.id, 
          name: project.name, 
          // type: 'project', // Type isn't strictly needed for projectsInPeriod anymore if just for display/filtering
          stakeholders: project.stakeholders // Keep for consistency if used elsewhere, but primary use is now direct from task/note
        });
      }
    });

    completedTasksData.forEach(task => {
      if (task.project_id && !projectsMap.has(task.project_id.id)) {
        projectsMap.set(task.project_id.id, { 
          id: task.project_id.id, 
          name: task.project_id.name,
          stakeholders: task.project_id.stakeholders || [] // Will be populated by the new query
        });
      }
    });
    
    const currentNotesInPeriod = allUserNotes.filter(note => {
        const createdAt = parseISO(note.created_at);
        return createdAt >= dateRange.startDate && createdAt <= dateRange.endDate;
    });

    currentNotesInPeriod.forEach(note => {
        let projectRef = null;
        if (note.tasks && note.tasks.project_id) {
            projectRef = note.tasks.project_id;
        } else if (note.projects) {
            projectRef = note.projects;
        }

        if (projectRef && !projectsMap.has(projectRef.id)) {
            projectsMap.set(projectRef.id, { 
                id: projectRef.id, 
                name: projectRef.name,
                stakeholders: projectRef.stakeholders || [] // Will be populated by the new query
            });
        }
    });

    const uniqueProjects = Array.from(projectsMap.values()).sort((a, b) => a.name.localeCompare(b.name));
    setProjectsInPeriod(uniqueProjects);
    
    // Initialize visibility: all true by default, or maintain existing if already set
    setProjectVisibility(prev => {
      const newVisibility = { ...prev };
      uniqueProjects.forEach(p => {
        if (newVisibility[p.id] === undefined) {
          newVisibility[p.id] = true;
        }
      });
      return newVisibility;
    });

  }, [completedTasksData, completedProjectsData, allUserNotes, dateRange]);


  const notesInPeriod = useMemo(() => {
    return allUserNotes.filter(note => {
      const createdAt = parseISO(note.created_at);
      // Filter out notes already associated with tasks/projects completed in THIS period (they are shown with their parent)
      const isAttachedToCompletedTaskInPeriod = completedTasksData.some(task => task.notes && task.notes.some(n => n.id === note.id));
      const isAttachedToCompletedProjectInPeriod = completedProjectsData.some(proj => proj.notes && proj.notes.some(n => n.id === note.id));
      
      return createdAt >= dateRange.startDate && createdAt <= dateRange.endDate &&
             !isAttachedToCompletedTaskInPeriod && !isAttachedToCompletedProjectInPeriod &&
             ( (note.tasks && projectVisibility[note.tasks.project_id?.id]) || (note.projects && projectVisibility[note.projects.id]) || (!note.tasks && !note.projects) ); // last part handles notes not linked to any project (if possible)
    });
  }, [allUserNotes, dateRange, completedTasksData, completedProjectsData, projectVisibility]);

  const groupItems = useMemo(() => {
    const grouped = {};
    const itemsToGroup = [
      ...completedTasksData
          .filter(task => {
            // const project = projectsInPeriod.find(p => p.id === task.project_id?.id); // No longer need to find in projectsInPeriod for stakeholders
            const isVisible = !!(task.project_id && projectVisibility[task.project_id.id]); // Ensure boolean
            
            let taskIsBillHidden = false;
            if (hideBillStakeholder && task.project_id && Array.isArray(task.project_id.stakeholders)) {
              taskIsBillHidden = task.project_id.stakeholders.includes('Bill');
            }
            
            console.log('[Debug Task Filter]', { 
              taskId: task.id, 
              taskName: task.name, 
              hideBillFlag: hideBillStakeholder, 
              parentProjectId: task.project_id?.id, 
              parentProjectName: task.project_id?.name, 
              parentProjectStakeholders: task.project_id?.stakeholders, 
              taskIsBillHiddenLogic: taskIsBillHidden, 
              taskIsVisibleLogic: isVisible, 
              isPassingThroughFilter: isVisible && !taskIsBillHidden 
            });
            return isVisible && !taskIsBillHidden;
          })
          .map(task => ({ ...task, type: 'task', date: parseISO(task.completed_at) })),
      ...completedProjectsData
          .filter(project => {
            const isVisible = projectVisibility[project.id];
            // Bill filtering for directly completed projects remains the same (uses project.stakeholders)
            const isBillHidden = hideBillStakeholder && project.stakeholders?.includes('Bill');
            // console.log('[Debug Project Filter]', { projectId: project.id, name: project.name, hideBillFlag: hideBillStakeholder, stakeholders: project.stakeholders, isBillHidden, isVisible, isPassing: isVisible && !isBillHidden });
            return isVisible && !isBillHidden;
          })
          .map(project => ({ ...project, type: 'project', date: parseISO(project.updated_at) })), // Assuming updated_at is completion
      ...notesInPeriod
          .filter(note => {
            let noteIsBillHidden = false;
            let parentProjectForNoteStakeholders = [];
            let parentProjectForNoteInfo = null; // For logging

            if (note.tasks && note.tasks.project_id) {
              parentProjectForNoteStakeholders = note.tasks.project_id.stakeholders || [];
              parentProjectForNoteInfo = note.tasks.project_id;
            } else if (note.projects) {
              parentProjectForNoteStakeholders = note.projects.stakeholders || [];
              parentProjectForNoteInfo = note.projects;
            }

            const isNoteVisibleByProjectParent = 
                (note.tasks && note.tasks.project_id && projectVisibility[note.tasks.project_id.id]) || 
                (note.projects && projectVisibility[note.projects.id]) || 
                (!note.tasks && !note.projects); // Standalone notes are visible if not filtered by Bill

            if (!note.tasks && !note.projects) { // Note not linked to any project
              console.log('[Debug Note Filter - Standalone]', { noteId: note.id, content: note.content?.substring(0,20), hideBillFlag: hideBillStakeholder, isVisible: isNoteVisibleByProjectParent, isPassing: isNoteVisibleByProjectParent });
              return isNoteVisibleByProjectParent; 
            }
            
            if (hideBillStakeholder && Array.isArray(parentProjectForNoteStakeholders)) {
              noteIsBillHidden = parentProjectForNoteStakeholders.includes('Bill');
            }
            
            console.log('[Debug Note Filter - Project-Linked]', { 
              noteId: note.id, 
              content: note.content?.substring(0,20), 
              hideBillFlag: hideBillStakeholder, 
              parentInfo: parentProjectForNoteInfo ? {id: parentProjectForNoteInfo.id, name: parentProjectForNoteInfo.name, stakeholders: parentProjectForNoteInfo.stakeholders} : null,
              // projectStakeholders: parentProjectForNoteStakeholders, // Redundant, covered by parentInfo
              noteIsBillHiddenLogic: noteIsBillHidden, 
              noteIsVisibleByParentLogic: isNoteVisibleByProjectParent, 
              isPassingThroughFilter: isNoteVisibleByProjectParent && !noteIsBillHidden 
            });
            return isNoteVisibleByProjectParent && !noteIsBillHidden;
          })
          .map(note => ({ ...note, type: 'note', date: parseISO(note.created_at) }))
    ];

    itemsToGroup.sort((a, b) => a.date - b.date); // Sort all items together by date ascending

    itemsToGroup.forEach(item => {
      const dayKey = format(item.date, 'yyyy-MM-dd');
      if (!grouped[dayKey]) {
        grouped[dayKey] = [];
      }
      grouped[dayKey].push(item);
    });
    return grouped;
  }, [completedTasksData, completedProjectsData, notesInPeriod, projectVisibility, hideBillStakeholder]);
  
  const handleViewChange = (newViewType) => {
    setViewType(newViewType);
    // CurrentDate remains the same, useEffect for dateRange will recalculate
  };

  const handlePrevious = () => {
    switch (viewType) {
      case 'day': setCurrentDate(prev => subDays(prev, 1)); break;
      case 'week': setCurrentDate(prev => subWeeks(prev, 1)); break;
      case 'month': setCurrentDate(prev => subMonths(prev, 1)); break;
    }
  };

  const handleNext = () => {
    switch (viewType) {
      case 'day': setCurrentDate(prev => addDays(prev, 1)); break;
      case 'week': setCurrentDate(prev => addWeeks(prev, 1)); break;
      case 'month': setCurrentDate(prev => addMonths(prev, 1)); break;
    }
  };

  const handleProjectVisibilityChange = (projectId) => {
    setProjectVisibility(prev => ({ ...prev, [projectId]: !prev[projectId] }));
  };

  const handleSelectAllProjects = () => {
    const newVisibility = {};
    projectsInPeriod.forEach(p => newVisibility[p.id] = true);
    setProjectVisibility(newVisibility);
  };

  const handleDeselectAllProjects = () => {
    const newVisibility = {};
    projectsInPeriod.forEach(p => newVisibility[p.id] = false);
    setProjectVisibility(newVisibility);
  };

  const formatReportText = () => {
    let report = `Completed Items Report\n`;
    report += `Period: ${format(dateRange.startDate, 'EEEE, MMM do, yyyy')} - ${format(dateRange.endDate, 'EEEE, MMM do, yyyy')}\n`;
    report += `View: ${viewType.charAt(0).toUpperCase() + viewType.slice(1)}\n\n`;

    const sortedGroupKeys = Object.keys(groupItems).sort((a,b) => new Date(b) - new Date(a));

    if (sortedGroupKeys.length === 0) { // Simplified condition
      report += "No tasks, projects, or notes found for this period.\n";
    } else {
      report += "--- Completed Tasks, Projects & Notes ---\n"; // Updated title
      sortedGroupKeys.forEach(dateKey => {
        const items = groupItems[dateKey];
        report += `\nDate: ${format(parseISO(dateKey), 'EEEE, MMM do, yyyy')}\n`;
        items.forEach(item => {
          if (item.type === 'task') {
            report += `  Task: ${item.name} (Project: ${item.project_id?.name || 'N/A'})\n`;
            report += `    Completed: ${format(item.date, 'EEEE, MMM do, h:mm a')}\n`;
            if (item.description) report += `    Description: ${item.description}\n`;
            if (item.notes && item.notes.length > 0) {
                report += `    Notes (attached to task):\n`;
                item.notes.forEach(n => report += `      - ${format(parseISO(n.created_at), 'EEEE, MMM do, h:mm a')}: ${n.content}\n`);
            }
          } else if (item.type === 'project') {
            report += `  Project: ${item.name}\n`;
            report += `    Completed: ${format(item.date, 'EEEE, MMM do, h:mm a')}\n`;
            if (item.description) report += `    Description: ${item.description}\n`;
             if (item.notes && item.notes.length > 0) {
                report += `    Notes (attached to project):\n`;
                item.notes.forEach(n => report += `      - ${format(parseISO(n.created_at), 'EEEE, MMM do, h:mm a')}: ${n.content}\n`);
            }
          } else if (item.type === 'note') { 
            let parentContext = 'General Note';
            if (item.tasks && item.tasks.project_id) {
              parentContext = `Task: ${item.tasks.name || 'Unnamed Task'} (Project: ${item.tasks.project_id.name || 'Unnamed Project'})`;
            } else if (item.tasks) {
              parentContext = `Task: ${item.tasks.name || 'Unnamed Task'}`;
            } else if (item.projects) {
              parentContext = `Project: ${item.projects.name || 'Unnamed Project'}`;
            }
            report += `  Note (Created): ${item.content.substring(0,100)}${item.content.length > 100 ? '...' : ''}\n`;
            report += `    Parent: ${parentContext}\n`;
            report += `    Created At: ${format(item.date, 'EEEE, MMM do, h:mm a')}\n`;
          }
        });
      });
      // Removed separate loop for groupedOtherNotes
    }
    return report;
  };

  const handleCopyReport = async () => {
    const reportText = formatReportText();
    try {
      await navigator.clipboard.writeText(reportText);
      setCopyStatusMessage('Copied!');
    } catch (err) {
      console.error('Failed to copy report:', err);
      setCopyStatusMessage('Error copying!');
    }
    setTimeout(() => setCopyStatusMessage('Copy Report'), 2000);
  };


  const renderItem = (item) => {
    const itemDate = item.type === 'note' ? parseISO(item.created_at) : item.date; // item.date is already parsed for task/project

    return (
      <div key={item.id || item.note_id} className="p-3 mb-3 bg-white shadow rounded-md border border-gray-200">
        <div className="flex justify-between items-start">
          <div>
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${item.type === 'task' ? 'bg-blue-100 text-blue-700' : item.type === 'project' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
              {item.type.charAt(0).toUpperCase() + item.type.slice(1)}
            </span>
            <h3 className="text-md font-semibold mt-1.5 text-gray-800">
              {item.name || item.content.substring(0, 50) + (item.content.length > 50 ? '...' : '')}
            </h3>
            {item.type === 'task' && item.project_id && (
              <p className="text-xs text-gray-500">Project: {item.project_id.name}</p>
            )}
             {item.type === 'note' && (
              <p className="text-xs text-gray-500">
                Parent: {
                  item.tasks && item.tasks.project_id ? `Task - ${item.tasks.name || 'Unnamed Task'} (Project: ${item.tasks.project_id.name || 'Unnamed Project'})` :
                  item.tasks ? `Task - ${item.tasks.name || 'Unnamed Task'}` :
                  item.projects ? `Project - ${item.projects.name || 'Unnamed Project'}` :
                  'N/A'
                }
              </p>
            )}
          </div>
          <span className="text-xs text-gray-500 whitespace-nowrap">
            {item.type === 'note' ? 'Created' : 'Completed'}: {format(itemDate, 'EEEE, MMM do, h:mm a')}
          </span>
        </div>
        {item.description && <p className="text-sm text-gray-600 mt-1 whitespace-pre-wrap break-words">{item.description}</p>}
        
        {/* Display notes for tasks and projects */}
        {(item.type === 'task' || item.type === 'project') && item.notes && item.notes.length > 0 && (
          <div className="mt-2 pt-2 border-t border-gray-200">
            <h4 className="text-xs font-medium text-gray-600 mb-1">Notes for this {item.type}:</h4>
            <NoteList notes={item.notes.map(n => ({...n, parentType: item.type}))} />
          </div>
        )}
      </div>
    );
  };
  
  const renderGroupedItems = (itemsMap) => {
    const sortedDateKeys = Object.keys(itemsMap).sort((a, b) => new Date(a) - new Date(b)); // Sort date groups ascending
    
    if (sortedDateKeys.length === 0) return null;

    return sortedDateKeys.map(dateKey => {
      const itemsOnDate = itemsMap[dateKey];
      let sectionHeader = format(parseISO(dateKey), 'EEEE, MMM do, yyyy');

      if (viewType === 'week') {
        // No change, EEEE, MMM do, yyyy is fine for a specific day header within a week view.
      } else if (viewType === 'month') {
        const weekNum = getWeekOfMonth(parseISO(dateKey), { weekStartsOn: 1 });
        const weekStartDate = startOfWeek(parseISO(dateKey), { weekStartsOn: 1 });
        const weekEndDate = endOfWeek(parseISO(dateKey), { weekStartsOn: 1 });
        sectionHeader = `Week ${weekNum} (${format(weekStartDate, 'EEEE, MMM do')} - ${format(weekEndDate, 'EEEE, MMM do, yyyy')})`;
        // This logic isn't quite right for monthly sub-grouping. It should group BY WEEK first, then day.
        // For now, just showing items by day within the month.
      }

      return (
        <div key={dateKey} className="mb-6">
          <h2 className="text-lg font-semibold text-gray-700 mb-2 pb-1 border-b border-gray-300">
            {sectionHeader}
          </h2>
          {itemsOnDate.map(item => renderItem(item))}
        </div>
      );
    });
  };


  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      <header className="bg-white shadow-sm sticky top-0 z-10">
        <div className="px-4 sm:px-6 lg:px-8 py-3 flex justify-between items-center">
          <h1 className="text-xl font-semibold text-gray-900">Completed Items Report</h1>
          <Link href="/dashboard" className="text-sm text-indigo-600 hover:text-indigo-800">
            &larr; Back to Dashboard
          </Link>
        </div>
      </header>

      <div className="flex-grow flex max-w-full mx-auto w-full">
        {/* Left Sidebar: Filters */}
        <aside className="w-64 lg:w-72 bg-white p-4 border-r border-gray-200 flex-shrink-0 sticky top-[61px] h-[calc(100vh-61px)] overflow-y-auto">
          <div className="mb-4 flex items-center justify-between">
             <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wider flex-grow break-words mr-1">
                {format(dateRange.startDate, 'EEEE, MMM do')} - {format(dateRange.endDate, 'EEEE, MMM do, yyyy')}
             </h2>
             <div className="flex-shrink-0">
                <button onClick={handlePrevious} className="p-1 text-gray-500 hover:text-indigo-600 rounded-full hover:bg-gray-100"><ChevronLeftIcon className="h-5 w-5" /></button>
                <button onClick={handleNext} className="p-1 text-gray-500 hover:text-indigo-600 rounded-full hover:bg-gray-100"><ChevronRightIcon className="h-5 w-5" /></button>
             </div>
          </div>

          <div className="space-y-1 mb-4">
            {[ 'day', 'week', 'month'].map(v => (
              <button
                key={v}
                onClick={() => handleViewChange(v)}
                className={`w-full text-left text-sm px-3 py-1.5 rounded-md ${viewType === v ? 'bg-indigo-100 text-indigo-700 font-semibold' : 'text-gray-600 hover:bg-gray-50'}`}
              >
                {v.charAt(0).toUpperCase() + v.slice(1)} View
              </button>
            ))}
          </div>
          
          <div className="mb-4">
            <button
                onClick={handleCopyReport}
                disabled={isLoading}
                className="w-full flex items-center justify-center text-sm px-3 py-1.5 rounded-md bg-indigo-500 text-white hover:bg-indigo-600 disabled:bg-indigo-300"
            >
                <ClipboardDocumentIcon className="h-4 w-4 mr-2"/> {copyStatusMessage}
            </button>
          </div>

          {projectsInPeriod.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Filter by Project</h3>
              <div className="space-y-1 mb-2">
                <button 
                    onClick={handleSelectAllProjects}
                    className="px-2 py-1 text-xs bg-indigo-100 text-indigo-700 rounded hover:bg-indigo-200 transition-colors"
                >
                    Select All
                </button>
                <button 
                    onClick={handleDeselectAllProjects}
                    className="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition-colors"
                >
                    Deselect All
                </button>
                <button
                    onClick={() => setHideBillStakeholder(prev => !prev)}
                    className={`flex items-center text-xs px-2 py-1 rounded transition-colors ${hideBillStakeholder ? 'bg-red-100 text-red-700 hover:bg-red-200' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                    title={hideBillStakeholder ? "Show items with Bill as stakeholder" : "Hide items with Bill as stakeholder"}>
                    <FunnelIcon className="h-3.5 w-3.5 mr-1" />
                    {hideBillStakeholder ? 'Unhide Bill' : 'Hide Bill'}
                </button>
              </div>
              <div className="space-y-1 max-h-[calc(100vh-350px)] overflow-y-auto pr-1"> {/* Adjust max-h as needed */}
                {projectsInPeriod.map(p => (
                  <label key={p.id} className="flex items-center space-x-2 p-1.5 rounded-md hover:bg-gray-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={projectVisibility[p.id] !== false} // Default to true if undefined
                      onChange={() => handleProjectVisibilityChange(p.id)}
                      className="form-checkbox h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
                    />
                    <span className="text-sm text-gray-700 break-words w-full">{p.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </aside>

        {/* Main Content Area */}
        <main className="flex-grow p-4 sm:p-6 bg-gray-50 overflow-y-auto h-[calc(100vh-61px)]">
          {isLoading && <p className="text-center text-gray-500 py-10">Loading completed items...</p>}
          {error && <p className="text-center text-red-500 py-10">Error: {error}</p>}
          
          {!isLoading && !error && (
            <>
              {Object.keys(groupItems).length > 0 ? ( // Check if groupItems has any keys
                <section className="mb-8">
                  <h2 className="text-xl font-bold text-gray-800 mb-3">Completed Tasks, Projects & Notes</h2> {/* Updated Title */}
                  {renderGroupedItems(groupItems)}
                </section>
              ) : (
                // This empty state will now show if groupItems is empty after combining all types
                <div className="text-center py-10">
                  <CalendarDaysIcon className="h-12 w-12 text-gray-400 mx-auto mb-2" />
                  <p className="text-gray-500">No tasks, projects, or notes found for this period.</p>
                  <p className="text-xs text-gray-400 mt-1">Try adjusting the date range or view.</p>
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
};

export default CompletedReportPage;