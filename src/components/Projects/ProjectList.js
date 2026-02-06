'use client';

import { useEffect, useRef, createRef } from 'react';
import ProjectItem from './ProjectItem';
import { useTargetProject } from '@/contexts/TargetProjectContext';

// Define priority order for rendering groups
// const PRIORITY_ORDER = ['High', 'Medium', 'Low', 'Other']; // No longer needed

export default function ProjectList({
  projects,
  tasksByProject,
  notesByTask,
  projectNotes,
  onTaskNoteAdded,
  onProjectNoteAdded,
  onProjectDataChange,
  onProjectDeleted,
  onProjectUpdated,
  areAllTasksExpanded,
  isTaskDragActive,
  dragSourceProjectId = null,
  onTaskDragStateChange = () => {},
}) {
  const { targetProjectId, setTargetProjectId } = useTargetProject();
  const projectRefs = useRef({});
  const actionedProjectIdRef = useRef(null); // Tracks the ID that caused the last scroll/highlight action

  // Ensure refs are created for each project
  useEffect(() => {
    projects.forEach(project => {
      if (!projectRefs.current[project.id]) {
        projectRefs.current[project.id] = createRef();
      }
    });
    // Optional: Clean up refs for projects that no longer exist, if necessary
  }, [projects]);

  useEffect(() => {
    if (!targetProjectId) {
      actionedProjectIdRef.current = null;
      return; 
    }

    if (targetProjectId !== actionedProjectIdRef.current) {
      const targetElement = projectRefs.current[targetProjectId]?.current;

      if (targetElement) {
        targetElement.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });

        targetElement.classList.add('ring-2', 'ring-blue-500', 'ring-offset-2');
        actionedProjectIdRef.current = targetProjectId;

        const timer = setTimeout(() => {
          const currentActionedElement = projectRefs.current[actionedProjectIdRef.current]?.current;
          if (currentActionedElement) {
            currentActionedElement.classList.remove('ring-2', 'ring-blue-500', 'ring-offset-2');
          }
          
          if (actionedProjectIdRef.current === targetProjectId) {
            setTargetProjectId(null);
          }
        }, 1000); // Highlight for 1 second

        return () => {
          clearTimeout(timer);
          if (targetElement && targetElement.classList.contains('ring-2')) {
            targetElement.classList.remove('ring-2', 'ring-blue-500', 'ring-offset-2');
          }
        };
      } 
    }
  }, [targetProjectId, setTargetProjectId, projects]);

  // Check if there are any projects across all groups
  // const isEmpty = PRIORITY_ORDER.every(groupKey => 
  //   !groupedProjects[groupKey] || groupedProjects[groupKey].length === 0
  // );
  const isEmpty = !projects || projects.length === 0;

  if (isEmpty) {
    // This specific message might be redundant if DashboardPage handles its own "no projects match filters" message comprehensively.
    // DashboardPage already shows a message for "No projects found matching your filters." or "No projects yet."
    // So, this component can simply return null or a fragment if empty, or DashboardPage should not render it.
    // For now, let's keep a minimal message or return null.
    return <p className="text-center text-gray-500 py-10">No projects to display.</p>; // Simplified message
  }

  return (
    // <div className="space-y-4">
    //   {PRIORITY_ORDER.map(priorityKey => {
    //     const projectsInGroup = groupedProjects[priorityKey];
    //     if (projectsInGroup && projectsInGroup.length > 0) {
    //       return (
    //         <div key={priorityKey}>
    //           <h3 className="text-sm font-semibold uppercase text-gray-500 px-1 py-1.5 mb-1.5 tracking-wider border-b border-gray-200">
    //             {priorityKey} Priority
    //           </h3>
    //           <div className="space-y-3">
    //             {projectsInGroup.map(project => (
    //               <ProjectItem 
    //                 key={project.id} 
    //                 project={project} 
    //                 onProjectDataChange={onProjectDataChange} 
    //                 onProjectDeleted={onProjectDeleted} 
    //               />
    //             ))}
    //           </div>
    //         </div>
    //       );
    //     }
    //     return null;
    //   })}
    // </div>
    <div className={isTaskDragActive ? 'space-y-3' : 'space-y-5'}>
      {(() => {
        const unassignedProject = projects.find(project => project?.name?.toLowerCase() === 'unassigned');
        const otherProjects = projects.filter(project => project?.name?.toLowerCase() !== 'unassigned');
        return (
          <>
            {unassignedProject && (
              <ProjectItem
                key={unassignedProject.id}
                ref={projectRefs.current[unassignedProject.id]}
                project={unassignedProject}
                tasks={tasksByProject?.[unassignedProject.id] || []}
                notesByTask={notesByTask}
                notes={projectNotes?.[unassignedProject.id] || []}
                onTaskNoteAdded={onTaskNoteAdded}
                onProjectNoteAdded={onProjectNoteAdded}
                onProjectDataChange={onProjectDataChange}
                onProjectDeleted={onProjectDeleted}
                onProjectUpdated={onProjectUpdated}
                areAllTasksExpanded={areAllTasksExpanded}
                isDropMode={isTaskDragActive}
                dragSourceProjectId={dragSourceProjectId}
                onTaskDragStateChange={onTaskDragStateChange}
              />
            )}
            {otherProjects.map(project => (
              <ProjectItem 
                key={project.id} 
                ref={projectRefs.current[project.id]}
                project={project} 
                tasks={tasksByProject?.[project.id] || []}
                notesByTask={notesByTask}
                notes={projectNotes?.[project.id] || []}
                onTaskNoteAdded={onTaskNoteAdded}
                onProjectNoteAdded={onProjectNoteAdded}
                onProjectDataChange={onProjectDataChange} 
                onProjectDeleted={onProjectDeleted} 
                onProjectUpdated={onProjectUpdated}
                areAllTasksExpanded={areAllTasksExpanded}
                isDropMode={isTaskDragActive}
                dragSourceProjectId={dragSourceProjectId}
                onTaskDragStateChange={onTaskDragStateChange}
                // isTargeted={project.id === targetProjectId} // We can pass this if ProjectItem handles its own highlight
              />
            ))}
          </>
        );
      })()}
    </div>
  );
} 
