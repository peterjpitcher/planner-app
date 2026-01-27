'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';

function formatTimestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString();
}

export default function IntegrationsClient() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState({ loading: true, connected: false });
  const [notice, setNotice] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const callbackStatus = searchParams.get('office365');
  useEffect(() => {
    if (!callbackStatus) return;
    if (callbackStatus === 'connected') setNotice('Office 365 connected.');
    else if (callbackStatus === 'error') setNotice('Office 365 connection was cancelled or failed.');
    else if (callbackStatus === 'failed') setNotice('Office 365 connection failed.');
    else setNotice('Office 365 connection did not complete.');
  }, [callbackStatus]);

  const refreshStatus = useCallback(async () => {
    setStatus((prev) => ({ ...prev, loading: true }));
    try {
      const response = await fetch('/api/integrations/office365/status', { cache: 'no-store' });
      if (!response.ok) throw new Error('Failed to fetch status');
      const json = await response.json();
      setStatus({ loading: false, ...json });
    } catch (err) {
      setStatus({ loading: false, connected: false, error: 'Unable to load status' });
    }
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  const connectHref = useMemo(() => {
    const returnTo = '/settings/integrations';
    return `/api/integrations/office365/connect?returnTo=${encodeURIComponent(returnTo)}`;
  }, []);

  const lastSyncedLabel = useMemo(() => formatTimestamp(status?.lastSyncedAt), [status?.lastSyncedAt]);

  const syncNow = async () => {
    setNotice('');
    setSyncing(true);
    try {
      const response = await fetch('/api/integrations/office365/sync', { method: 'POST' });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(json?.error || 'Sync failed');
      }
      setNotice(`Synced. Created lists: ${json.createdLists}, created tasks: ${json.createdTasks}.`);
      await refreshStatus();
    } catch (err) {
      setNotice(String(err?.message || 'Sync failed'));
    } finally {
      setSyncing(false);
    }
  };

  const disconnect = async () => {
    setNotice('');
    setDisconnecting(true);
    try {
      const response = await fetch('/api/integrations/office365/disconnect', { method: 'POST' });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(json?.error || 'Disconnect failed');
      }
      setNotice('Office 365 disconnected.');
      await refreshStatus();
    } catch (err) {
      setNotice(String(err?.message || 'Disconnect failed'));
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Integrations</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect third-party services to keep your Planner projects and tasks in sync.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Office 365 (Microsoft To Do)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm">
            <div>
              <span className="font-medium">Status:</span>{' '}
              {status.loading ? 'Loading…' : (status.connected ? 'Connected' : 'Not connected')}
            </div>
            {lastSyncedLabel && (
              <div className="mt-1">
                <span className="font-medium">Last sync:</span> {lastSyncedLabel}
              </div>
            )}
            {status?.error && (
              <div className="mt-2 text-destructive">{status.error}</div>
            )}
            {notice && (
              <div className="mt-2 text-muted-foreground">{notice}</div>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {!status.connected && (
              <Button href={connectHref}>Connect Office 365</Button>
            )}
            {status.connected && (
              <>
                <Button onClick={syncNow} isLoading={syncing} disabled={syncing}>
                  Sync now
                </Button>
                <Button
                  variant="outline"
                  onClick={disconnect}
                  isLoading={disconnecting}
                  disabled={disconnecting}
                >
                  Disconnect
                </Button>
              </>
            )}
          </div>

          <div className="text-xs text-muted-foreground">
            Projects are synced as task lists; tasks are synced into their project list.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

