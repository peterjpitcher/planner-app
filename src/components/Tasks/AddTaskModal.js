'use client';

import AddTaskForm from './AddTaskForm';

export default function AddTaskModal({ isOpen, onClose, onTaskAdded, projects, projectId, defaultPriority }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto flex flex-col">
        <div className="flex justify-between items-center mb-4 flex-shrink-0">
          <h2 className="text-xl sm:text-2xl font-semibold text-gray-800">Add New Task</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
            aria-label="Close modal"
          >
            &times;
          </button>
        </div>
        <div className="overflow-y-auto flex-grow">
          <AddTaskForm 
            projectId={projectId}
            projects={projects}
            defaultPriority={defaultPriority}
            onTaskAdded={(newTask) => {
              if (onTaskAdded) {
                onTaskAdded(newTask);
              }
              onClose();
            }} 
            onClose={onClose}
          />
        </div>
      </div>
    </div>
  );
} 