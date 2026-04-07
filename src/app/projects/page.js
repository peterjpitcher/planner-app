import { Suspense } from 'react';
import ProjectsView from '@/components/Projects/ProjectsView';

export default function ProjectsPage() {
  return (
    <Suspense fallback={
      <div className="flex h-[calc(100vh-4rem)] animate-pulse">
        <div className="w-[280px] shrink-0 border-r border-gray-200 bg-gray-50/50 p-3 space-y-3">
          <div className="h-9 rounded-md bg-gray-200" />
          <div className="space-y-2 pt-2">{[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-12 rounded-lg bg-gray-200" />)}</div>
        </div>
        <div className="flex-1 p-6 space-y-4">
          <div className="h-64 rounded-lg bg-gray-100" />
        </div>
      </div>
    }>
      <ProjectsView />
    </Suspense>
  );
}
