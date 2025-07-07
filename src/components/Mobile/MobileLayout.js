'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useSupabase } from '@/contexts/SupabaseContext';
import { signOut } from 'next-auth/react';
import {
  PlusCircleIcon, ArrowUturnLeftIcon, ArrowLeftOnRectangleIcon, 
  RectangleStackIcon, ClipboardDocumentListIcon, MagnifyingGlassIcon
} from '@heroicons/react/24/outline';
import AddProjectModal from '@/components/Projects/AddProjectModal'; // Assuming this can be reused
import { PlusIcon } from '@heroicons/react/20/solid'; // Added for FAB

const MobileLayout = ({ children, title = 'Planner App', onProjectAdded }) => {
  const supabase = useSupabase();
  const [showAddProjectModal, setShowAddProjectModal] = useState(false);
  const [showSearchInput, setShowSearchInput] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const router = useRouter();
  const pathname = usePathname();

  const handleLogout = async () => {
    await signOut({ callbackUrl: '/login' });
  };

  const handleProjectSuccessfullyAdded = (newProject) => {
    setShowAddProjectModal(false);
    if (onProjectAdded) {
      onProjectAdded(newProject); // Callback to refresh data on the page using this layout
    }
  };

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    if (searchTerm.trim()) {
      router.push(`/m/search?query=${encodeURIComponent(searchTerm.trim())}`);
      setShowSearchInput(false); // Optionally close search input after submit
      setSearchTerm(''); // Clear search term
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col text-gray-900">
      <header className="bg-indigo-600 text-white shadow-md sticky top-0 z-50">
        <div className="container mx-auto px-2 sm:px-4 py-3">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-semibold truncate flex-shrink-0 mr-2">{title}</h1>
            <div className="flex items-center space-x-1 sm:space-x-2 flex-grow justify-end">
              {showSearchInput ? (
                <form onSubmit={handleSearchSubmit} className="flex-grow max-w-xs sm:max-w-sm md:max-w-md">
                  <input 
                    type="search" 
                    value={searchTerm} 
                    onChange={(e) => setSearchTerm(e.target.value)} 
                    placeholder="Search projects & tasks..." 
                    className="w-full px-2 py-1.5 text-sm text-gray-900 bg-indigo-100 border border-transparent rounded-md focus:ring-2 focus:ring-indigo-300 focus:bg-white focus:border-indigo-400 placeholder-gray-500"
                    autoFocus
                  />
                </form>
              ) : null}
              <button 
                onClick={() => setShowSearchInput(!showSearchInput)} 
                className="icon-button rounded-full hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                title={showSearchInput ? "Close Search" : "Search"}
              >
                <MagnifyingGlassIcon className="h-5 w-5" />
              </button>
              <Link 
                href="/dashboard" 
                className="icon-button rounded-full hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-300 hidden sm:inline-flex" 
                title="Desktop View"
              >
                <ArrowUturnLeftIcon className="h-5 w-5" />
              </Link>
              <button
                onClick={handleLogout}
                className="icon-button rounded-full hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                title="Logout"
              >
                <ArrowLeftOnRectangleIcon className="h-5 w-5" />
              </button>
            </div>
          </div>
          {/* Alternative search bar placement - full width below title if shown */}
          {/* {showSearchInput && (
            <form onSubmit={handleSearchSubmit} className="mt-2">
              <input type="search" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Search projects & tasks..." className="w-full px-3 py-1.5 text-sm text-gray-900 bg-indigo-100 rounded-md focus:ring-2 focus:ring-indigo-300 focus:bg-white" autoFocus />
            </form>
          )} */}
        </div>
      </header>
      <main className="flex-grow container mx-auto px-2 py-3 sm:px-4">
        {children}
      </main>
      <footer className="bg-white border-t border-gray-200 p-3 sticky bottom-0 z-50 shadow-t-md">
        <nav className="flex justify-around items-center">
          <Link 
            href="/m/dashboard" 
            className={`touch-target flex flex-col items-center justify-center text-xs ${pathname === '/m/dashboard' ? 'text-indigo-600' : 'text-gray-600'} hover:text-indigo-700 transition-colors`}
          >
            <RectangleStackIcon className="h-5 w-5 mb-0.5" />
            Projects
          </Link>
          <Link 
            href="/m/tasks" 
            className={`touch-target flex flex-col items-center justify-center text-xs ${pathname === '/m/tasks' ? 'text-indigo-600' : 'text-gray-600'} hover:text-indigo-700 transition-colors`}
          >
            <ClipboardDocumentListIcon className="h-5 w-5 mb-0.5" />
            Tasks
          </Link>
        </nav>
      </footer>
      {/* Floating Action Button for Add Project */}
      {pathname === '/m/dashboard' && onProjectAdded && ( // Only show on dashboard and if onProjectAdded is provided
        <button
          onClick={() => {
            setShowAddProjectModal(true);
          }}
          className="touch-target fixed bottom-20 right-4 sm:bottom-24 sm:right-6 bg-indigo-600 hover:bg-indigo-700 text-white p-3 rounded-full shadow-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 z-[60]"
          title="Add New Project"
        >
          <PlusIcon className="h-6 w-6" />
        </button>
      )}
      {/* Render AddProjectModal last to ensure it's on top of other page content if z-index issues occur */}
      {showAddProjectModal && (
        <AddProjectModal
          isOpen={showAddProjectModal} /* Retaining isOpen for clarity, though outer conditional is primary */
          onClose={() => setShowAddProjectModal(false)}
          onProjectAdded={handleProjectSuccessfullyAdded}
        />
      )}
    </div>
  );
};

export default MobileLayout; 