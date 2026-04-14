import { Suspense } from 'react';
import PlanningSettingsClient from './PlanningSettingsClient';

export default function PlanningSettingsPage() {
  return (
    <Suspense fallback={<div className="text-sm text-muted-foreground">Loading...</div>}>
      <PlanningSettingsClient />
    </Suspense>
  );
}
