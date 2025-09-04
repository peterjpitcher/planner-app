"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useApiClient } from '@/hooks/useApiClient';
import { handleError } from '@/lib/errorHandler';
import { useSession } from "next-auth/react";
import MobileLayout from "@/components/Mobile/MobileLayout";
import MobileTaskListItem from "@/components/Mobile/MobileTaskListItem"; // Re-use for listing tasks
import { format, parseISO, compareAsc } from "date-fns";
import {
  ArrowLeftIcon,
  PencilIcon,
  PlusCircleIcon,
} from "@heroicons/react/24/outline";

// Helper for displaying priority with icon (similar to MobileProjectListItem)
import {
  ClockIcon,
  FireIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon as SolidCheckIcon,
} from "@heroicons/react/20/solid";

const getPriorityValue = (priority) => {
  switch (priority) {
    case 'High': return 3;
    case 'Medium': return 2;
    case 'Low': return 1;
    default: return 0;
  }
};

const getPriorityStyles = (priority) => {
  switch (priority) {
    case "High":
      return {
        icon: <FireIcon className="h-5 w-5 text-red-500 inline mr-1" />,
        textClass: "text-red-600 font-semibold",
      };
    case "Medium":
      return {
        icon: (
          <ExclamationTriangleIcon className="h-5 w-5 text-yellow-500 inline mr-1" />
        ),
        textClass: "text-yellow-600 font-semibold",
      };
    case "Low":
      return {
        icon: <SolidCheckIcon className="h-5 w-5 text-green-500 inline mr-1" />,
        textClass: "text-green-600",
      };
    default:
      return {
        icon: <ClockIcon className="h-5 w-5 text-gray-400 inline mr-1" />,
        textClass: "text-gray-500",
      };
  }
};

const MobileProjectDetailPage = () => {
  const apiClient = useApiClient();
  const { data: session, status } = useSession();
  const user = session?.user;
  const authLoading = status === 'loading';
  const router = useRouter();
  const params = useParams();
  const projectId = params?.id;

  const [project, setProject] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [projectNotes, setProjectNotes] = useState([]);
  const [isLoadingProjectNotes, setIsLoadingProjectNotes] = useState(false);
  const [newProjectNoteContent, setNewProjectNoteContent] = useState("");
  const [isAddingProjectNote, setIsAddingProjectNote] = useState(false);

  const fetchData = useCallback(async () => {
    if (!user || !projectId) return;
    setIsLoading(true);
    setError(null);
    setIsLoadingProjectNotes(true); // Initialize notes loading

    try {
      // Fetch project details
      const projectData = await apiClient.projects.get(projectId);
      setProject(projectData.data);

      // Fetch project tasks
      const tasksResponse = await apiClient.tasks.list({
        projectId,
        includeCompleted: true,
        limit: 200
      });
      setTasks(tasksResponse.data || []);

      // Fetch project notes
      const notesResponse = await apiClient.notes.list({
        projectId,
        limit: 100
      });
      setProjectNotes(notesResponse.data || []);
    } catch (e) {
      handleError(e, "Failed to load project information");
      setError("Failed to load project information.");
      setProject(null);
      setTasks([]);
      setProjectNotes([]);
    } finally {
      setIsLoading(false);
      setIsLoadingProjectNotes(false);
    }
  }, [user, projectId, apiClient]);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push("/login");
    } else if (status === 'authenticated' && user && projectId) {
      fetchData();
    }
  }, [user, status, projectId, router, fetchData]);

  const handleTaskClick = (taskId) => {
    // For future: navigate to a task detail view or open an edit modal
    router.push(`/m/task/${taskId}`); // Navigate to task detail page
  };

  const handleEditProject = () => {
    // Future: navigate to an edit project page or open modal
    router.push(`/m/project/${projectId}/edit`);
  };

  const handleAddTask = () => {
    router.push(`/m/project/${projectId}/add-task`);
  };

  const handleTaskUpdatedFromSwipe = useCallback((updatedTask) => {
    setTasks((currentTasks) =>
      currentTasks
        .map((t) => (t.id === updatedTask.id ? updatedTask : t))
        .sort((a, b) => {
          if (a.is_completed !== b.is_completed) return a.is_completed ? 1 : -1;
          const dateA = a.due_date ? parseISO(a.due_date) : null;
          const dateB = b.due_date ? parseISO(b.due_date) : null;
          if (dateA && dateB) {
            const dateComparison = compareAsc(dateA, dateB);
            if (dateComparison !== 0) return dateComparison;
          } else if (dateA) return -1;
          else if (dateB) return 1;
          return (
            (getPriorityValue(b.priority) || 0) -
            (getPriorityValue(a.priority) || 0)
          ); // Ensure consistent sorting
        }),
    );
    // Potentially re-fetch project details if open task count needs update from server
    // For now, optimistic count update is in the JSX: tasks.filter(t => !t.is_completed).length
  }, []);

  const handleTaskDeletedFromSwipe = useCallback((deletedTaskId) => {
    setTasks((currentTasks) =>
      currentTasks.filter((t) => t.id !== deletedTaskId),
    );
    // Potentially re-fetch project details if open task count needs update from server
  }, []);

  const handleAddProjectNote = async (e) => {
    e.preventDefault();
    if (!newProjectNoteContent.trim() || !user || !project) return;
    setIsAddingProjectNote(true);

    try {
      const response = await apiClient.notes.create({
        content: newProjectNoteContent.trim(),
        project_id: project.id
      });

      setProjectNotes((prevNotes) => [response.data, ...prevNotes]);
      setNewProjectNoteContent("");
    } catch (err) {
      handleError(err, "Failed to add note");
      alert("Failed to add note. Please try again.");
    } finally {
      setIsAddingProjectNote(false);
    }
  };

  if (authLoading || isLoading) {
    return (
      <MobileLayout title="Loading Project...">
        <div className="text-center py-10">
          <p className="text-gray-500">Loading project details...</p>
        </div>
      </MobileLayout>
    );
  }

  if (error) {
    return (
      <MobileLayout title="Error">
        <div className="text-center py-10">
          <p className="text-red-500">{error}</p>
          <button
            onClick={fetchData}
            className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
          >
            Try Again
          </button>
        </div>
      </MobileLayout>
    );
  }

  if (!project) {
    return (
      <MobileLayout title="Project Not Found">
        <div className="text-center py-10">
          <p className="text-gray-500">Sorry, we couldn't find that project.</p>
          <button
            onClick={() => router.back()}
            className="mt-4 text-indigo-600 hover:underline"
          >
            Go Back
          </button>
        </div>
      </MobileLayout>
    );
  }

  const priorityInfo = getPriorityStyles(project.priority);
  const statusColors = {
    Open: "bg-blue-100 text-blue-700",
    "In Progress": "bg-purple-100 text-purple-700",
    "On Hold": "bg-yellow-100 text-yellow-700",
    Completed: "bg-green-100 text-green-700 line-through",
    Cancelled: "bg-red-100 text-red-700 line-through",
  };
  const statusClass =
    statusColors[project.status] || "bg-gray-100 text-gray-700";

  return (
    <MobileLayout title={project.name || 'Project Details'}>
      <div className="bg-white shadow-md rounded-lg p-4 mb-4">
        <div className="flex justify-between items-center mb-3 space-x-2">
          <button
            onClick={() => router.back()}
            className="p-2 rounded-full hover:bg-gray-100 flex-shrink-0"
            title="Go Back"
          >
            <ArrowLeftIcon className="h-5 w-5 text-gray-700" />
          </button>
          <h1 className="text-xl font-semibold text-gray-800 text-center flex-grow min-w-0 break-words">
            {project.name}
          </h1>
          <button
            onClick={handleEditProject}
            className="p-2 rounded-full hover:bg-gray-100 flex-shrink-0"
            title="Edit Project"
          >
            <PencilIcon className="h-5 w-5 text-indigo-600" />
          </button>
        </div>

        {project.description && (
          <p className="text-sm text-gray-600 mb-3 whitespace-pre-wrap break-words">
            {project.description}
          </p>
        )}

        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm mb-3">
          <div>
            <span className="font-medium text-gray-500">Status:</span>
            <span
              className={`ml-2 px-2 py-0.5 rounded-full text-xs font-medium ${statusClass}`}
            >
              {project.status || "N/A"}
            </span>
          </div>
          <div>
            <span className="font-medium text-gray-500">Priority:</span>
            <span
              className={`ml-2 inline-flex items-center ${priorityInfo.textClass}`}
            >
              {priorityInfo.icon}
              {project.priority || "N/A"}
            </span>
          </div>
          <div>
            <span className="font-medium text-gray-500">Due Date:</span>
            <span className="ml-2 text-gray-700">
              {project.due_date
                ? format(parseISO(project.due_date), "MMM d, yyyy")
                : "N/A"}
            </span>
          </div>
          {project.stakeholders && project.stakeholders.length > 0 && (
            <div className="col-span-2">
              <span className="font-medium text-gray-500">Stakeholders:</span>
              <span className="ml-2 text-gray-700 break-words">
                {project.stakeholders.join(", ")}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white shadow-md rounded-lg p-0">
        <div className="flex justify-between items-center p-3 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-700">
            Tasks ({tasks.filter((t) => !t.is_completed).length} open)
          </h2>
          <button
            onClick={handleAddTask}
            className="p-1.5 rounded-full hover:bg-indigo-50"
            title="Add New Task"
          >
            <PlusCircleIcon className="h-6 w-6 text-indigo-600" />
          </button>
        </div>
        {tasks.length > 0 ? (
          <div className="divide-y divide-gray-100 px-1 py-1">
            {tasks.map((task) => (
              <MobileTaskListItem
                key={task.id}
                task={task}
                onTaskUpdated={handleTaskUpdatedFromSwipe}
                onTaskDeleted={handleTaskDeletedFromSwipe}
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500 p-4 text-center">
            No tasks for this project yet.
          </p>
        )}
      </div>

      {/* Project Notes Section */}
      <div className="mt-4 bg-white shadow-md rounded-lg p-4">
        <h2 className="text-lg font-semibold text-gray-700 mb-2">
          Project Notes
        </h2>
        <form onSubmit={handleAddProjectNote} className="mb-3">
          <textarea
            value={newProjectNoteContent}
            onChange={(e) => setNewProjectNoteContent(e.target.value)}
            placeholder="Add a new note for the project..."
            rows="2"
            className="w-full p-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500 text-sm"
          />
          <button
            type="submit"
            disabled={isAddingProjectNote || !newProjectNoteContent.trim()}
            className="mt-2 px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
          >
            {isAddingProjectNote ? "Adding Note..." : "Add Project Note"}
          </button>
        </form>
        {isLoadingProjectNotes ? (
          <p className="text-sm text-gray-500">Loading notes...</p>
        ) : projectNotes.length > 0 ? (
          <div className="space-y-2">
            {projectNotes.map((note) => (
              <div key={note.id} className="bg-gray-50 p-2 rounded-md text-sm">
                <p className="text-gray-800 whitespace-pre-wrap break-words">
                  {note.content}
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  {format(parseISO(note.created_at), "MMM d, yyyy HH:mm")}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500">
            No notes for this project yet.
          </p>
        )}
      </div>
    </MobileLayout>
  );
};

export default MobileProjectDetailPage;
