import { Suspense } from 'react';
import IntegrationsClient from './IntegrationsClient';

export default function IntegrationsPage() {
  return (
    <Suspense fallback={<div className="text-sm text-muted-foreground">Loading…</div>}>
      <IntegrationsClient />
    </Suspense>
  );
}

