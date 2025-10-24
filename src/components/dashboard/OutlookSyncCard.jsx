'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

function formatDateTime(value) {
  if (!value) {
    return '—';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  return date.toLocaleString();
}

export default function OutlookSyncCard() {
  const [status, setStatus] = useState({ connected: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  const refreshStatus = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch('/api/integrations/outlook/status');
      if (!response.ok) {
        throw new Error('Unable to load Outlook status');
      }
      const data = await response.json();
      setStatus(data);
    } catch (err) {
      setError(err.message || 'Failed to load status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  const handleConnect = useCallback(() => {
    window.location.href = '/api/integrations/outlook/authorize';
  }, []);

  const handleDisconnect = useCallback(async () => {
    setIsDisconnecting(true);
    setError(null);
    try {
      const response = await fetch('/api/integrations/outlook/disconnect', {
        method: 'POST'
      });
      if (!response.ok) {
        throw new Error('Failed to disconnect');
      }
      setStatus({ connected: false });
    } catch (err) {
      setError(err.message || 'Unable to disconnect');
    } finally {
      setIsDisconnecting(false);
    }
  }, []);

  const handleSyncNow = useCallback(async () => {
    setIsSyncing(true);
    setError(null);
    try {
      const response = await fetch('/api/integrations/outlook/sync', {
        method: 'PUT'
      });
      if (!response.ok) {
        throw new Error('Failed to queue sync');
      }
    } catch (err) {
      setError(err.message || 'Unable to start sync');
    } finally {
      setIsSyncing(false);
    }
  }, []);

  const statusBadge = useMemo(() => {
    if (loading) {
      return (
        <span className="flex items-center gap-2 rounded-full border border-[#0496c7]/25 bg-white/80 px-3 py-1 text-xs text-[#036586]">
          <span className="h-2 w-2 animate-pulse rounded-full bg-[#fbbf24]" />
          Checking connection…
        </span>
      );
    }

    if (status.connected) {
      return (
        <span className="flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-50 px-3 py-1 text-xs text-emerald-700">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          Connected to Outlook
        </span>
      );
    }

    return (
      <span className="flex items-center gap-2 rounded-full border border-[#0496c7]/25 bg-[#0496c7]/10 px-3 py-1 text-xs text-[#036586]">
        <span className="h-2 w-2 rounded-full bg-[#f87171]" />
        Not connected
      </span>
    );
  }, [loading, status.connected]);

  return (
    <div className="glass-panel flex flex-col gap-4 rounded-3xl border border-[#0496c7]/25 p-5 text-[#052a3b]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-[#036586]/75">Outlook Sync</p>
          <h3 className="mt-2 text-xl font-semibold text-[#052a3b]">Microsoft To Do</h3>
          <p className="mt-1 text-sm text-[#2f617a]">
            Planner projects are mirrored as individual Outlook lists so you can work natively in either app.
          </p>
        </div>
        {statusBadge}
      </div>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {status.connected && (
        <dl className="grid grid-cols-1 gap-3 rounded-2xl border border-[#0496c7]/15 bg-white/70 px-4 py-3 text-xs text-[#2f617a] sm:grid-cols-2">
          <div>
            <dt className="uppercase tracking-[0.2em] text-[#036586]/60">Planner list</dt>
            <dd className="mt-1 font-semibold text-[#052a3b] break-all">{status.plannerListId || 'Planner'}</dd>
          </div>
          <div>
            <dt className="uppercase tracking-[0.2em] text-[#036586]/60">Last updated</dt>
            <dd className="mt-1 font-semibold text-[#052a3b]">{formatDateTime(status.updatedAt)}</dd>
          </div>
          <div>
            <dt className="uppercase tracking-[0.2em] text-[#036586]/60">Access token</dt>
            <dd className="mt-1 font-semibold text-[#052a3b]">{formatDateTime(status.accessTokenExpiresAt)}</dd>
          </div>
          <div>
            <dt className="uppercase tracking-[0.2em] text-[#036586]/60">Webhook expiry</dt>
            <dd className="mt-1 font-semibold text-[#052a3b]">{formatDateTime(status.subscriptionExpiresAt)}</dd>
          </div>
        </dl>
      )}
      {status.connected && (
        <p className="rounded-xl border border-[#0496c7]/10 bg-[#0496c7]/8 px-4 py-3 text-xs text-[#036586]">
          Each Planner project now has its own Outlook list. Create or move tasks between lists in Microsoft To Do and they&apos;ll sync back here automatically.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {status.connected ? (
          <>
            <button
              type="button"
              onClick={handleSyncNow}
              disabled={isSyncing}
              className="inline-flex items-center rounded-full border border-[#0496c7]/35 bg-[#0496c7]/12 px-4 py-2 text-xs font-semibold text-[#036586] transition hover:border-[#0496c7]/50 hover:bg-[#0496c7]/18 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSyncing ? 'Queuing…' : 'Sync now'}
            </button>
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={isDisconnecting}
              className="inline-flex items-center rounded-full border border-red-400/35 bg-red-50 px-4 py-2 text-xs font-semibold text-red-600 transition hover:border-red-400 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isDisconnecting ? 'Disconnecting…' : 'Disconnect'}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={handleConnect}
            className="inline-flex items-center rounded-full border border-[#0496c7]/30 bg-[#0496c7] px-5 py-2 text-xs font-semibold text-white shadow-lg shadow-[#0496c7]/30 transition hover:bg-[#036586]"
          >
            Connect Outlook
          </button>
        )}

        <button
          type="button"
          onClick={refreshStatus}
          className="inline-flex items-center rounded-full border border-[#0496c7]/25 px-4 py-2 text-xs font-semibold text-[#036586] transition hover:border-[#0496c7]/45 hover:text-[#0496c7]"
        >
          Refresh
        </button>
      </div>
    </div>
  );
}
