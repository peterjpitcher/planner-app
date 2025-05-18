'use client';

import AddTaskForm from './AddTaskForm';

export default function AddTaskModal({ projectId, onClose, onTaskAdded }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-gray-900 bg-opacity-10 backdrop-blur-sm p-4">
      {/* Increased z-index to ensure it's above ProjectItem potentially higher z-index elements */}
      <div className="bg-white p-5 rounded-lg shadow-xl w-full max-w-md max-h-[80vh] sm:max-h-[90vh] overflow-y-auto flex flex-col">
        <div className="flex justify-between items-center mb-4 flex-shrink-0">
          <h2 className="text-lg font-semibold text-gray-800">Add New Task</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
            aria-label="Close modal"
          >
            &times;
          </button>
        </div>
        <div className="overflow-y-auto flex-grow">
          <AddTaskForm projectId={projectId} onTaskAdded={onTaskAdded} onClose={onClose} />
        </div>
      </div>
    </div>
  );
} 