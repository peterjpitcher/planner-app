'use client';

import React from 'react';

/**
 * Skeleton loader for project items
 */
export function ProjectSkeleton() {
  return (
    <div className="animate-pulse bg-white p-4 sm:p-6 rounded-lg shadow-sm border border-gray-200">
      <div className="flex justify-between items-start mb-3">
        <div className="flex-1">
          <div className="h-6 bg-gray-200 rounded w-3/4 mb-2"></div>
          <div className="h-4 bg-gray-200 rounded w-1/2"></div>
        </div>
        <div className="h-8 w-20 bg-gray-200 rounded"></div>
      </div>
      <div className="flex gap-2 mt-3">
        <div className="h-6 w-16 bg-gray-200 rounded"></div>
        <div className="h-6 w-24 bg-gray-200 rounded"></div>
      </div>
    </div>
  );
}

/**
 * Skeleton loader for task items
 */
export function TaskSkeleton() {
  return (
    <div className="animate-pulse flex items-center gap-3 p-3 bg-white rounded border border-gray-200">
      <div className="h-5 w-5 bg-gray-200 rounded"></div>
      <div className="flex-1">
        <div className="h-4 bg-gray-200 rounded w-3/4"></div>
      </div>
      <div className="h-6 w-16 bg-gray-200 rounded"></div>
    </div>
  );
}

/**
 * Skeleton loader for project list
 */
export function ProjectListSkeleton({ count = 5 }) {
  return (
    <div className="space-y-4">
      {[...Array(count)].map((_, i) => (
        <ProjectSkeleton key={i} />
      ))}
    </div>
  );
}

/**
 * Skeleton loader for task list
 */
export function TaskListSkeleton({ count = 3 }) {
  return (
    <div className="space-y-2">
      {[...Array(count)].map((_, i) => (
        <TaskSkeleton key={i} />
      ))}
    </div>
  );
}

/**
 * Generic loading spinner
 */
export function LoadingSpinner({ size = 'md', className = '' }) {
  const sizeClasses = {
    sm: 'h-4 w-4',
    md: 'h-8 w-8',
    lg: 'h-12 w-12'
  };

  return (
    <div className={`flex justify-center items-center ${className}`}>
      <div className={`animate-spin rounded-full border-b-2 border-indigo-600 ${sizeClasses[size]}`}></div>
    </div>
  );
}

/**
 * Full page loading state
 */
export function PageLoader({ message = 'Loading...' }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center">
      <LoadingSpinner size="lg" />
      <p className="mt-4 text-gray-600">{message}</p>
    </div>
  );
}

/**
 * Inline loading state for buttons
 */
export function ButtonLoader({ text = 'Loading...' }) {
  return (
    <>
      <LoadingSpinner size="sm" className="mr-2" />
      {text}
    </>
  );
}