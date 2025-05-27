'use client';

import AddProjectForm from './AddProjectForm';

export default function AddProjectModal({ isOpen, onClose, onProjectAdded }) {
  if (!isOpen) return null;

  console.log('[AddProjectModal] Rendering because isOpen is true.');

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto flex flex-col">
        <div className="flex justify-between items-center mb-4 flex-shrink-0">
          <h2 className="text-xl sm:text-2xl font-semibold text-gray-800">Add New Project</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
            aria-label="Close modal"
          >
            &times;
          </button>
        </div>
        <div className="overflow-y-auto flex-grow">
          <AddProjectForm 
            onProjectAdded={(newProject) => {
              onProjectAdded(newProject);
              onClose(); // Close modal after project is added
            }} 
            onClose={onClose} // Pass onClose for the form's cancel button
          />
        </div>
      </div>
    </div>
  );
} 