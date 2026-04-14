'use client';

import { useState, useEffect } from 'react';
import { apiClient } from '@/lib/apiClient';

const DEFAULT_SETTINGS = {
  daily_start: '06:00',
  daily_end: '10:00',
  weekly_start: '06:00',
  weekly_end: '10:00',
};

export default function PlanningSettingsClient() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState(null); // { type: 'success' | 'error', message }

  useEffect(() => {
    async function loadSettings() {
      try {
        const data = await apiClient.getPlanningSettings();
        if (data) {
          setSettings({
            daily_start: data.daily_start ?? DEFAULT_SETTINGS.daily_start,
            daily_end: data.daily_end ?? DEFAULT_SETTINGS.daily_end,
            weekly_start: data.weekly_start ?? DEFAULT_SETTINGS.weekly_start,
            weekly_end: data.weekly_end ?? DEFAULT_SETTINGS.weekly_end,
          });
        }
      } catch {
        // Use defaults if settings don't exist yet
      } finally {
        setIsLoading(false);
      }
    }
    loadSettings();
  }, []);

  function handleChange(field, value) {
    setSettings((prev) => ({ ...prev, [field]: value }));
    setFeedback(null);
  }

  async function handleSave(e) {
    e.preventDefault();
    setIsSaving(true);
    setFeedback(null);
    try {
      await apiClient.updatePlanningSettings(settings);
      setFeedback({ type: 'success', message: 'Planning settings saved.' });
    } catch (err) {
      setFeedback({ type: 'error', message: err.message || 'Failed to save settings.' });
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) {
    return (
      <div className="max-w-lg mx-auto">
        <div className="h-6 w-48 animate-pulse rounded bg-gray-200 mb-4" />
        <div className="h-40 animate-pulse rounded bg-gray-200" />
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto">
      <h1 className="text-lg font-semibold text-foreground mb-1">Planning Settings</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Configure when daily and weekly planning prompts appear.
      </p>

      <form onSubmit={handleSave} className="rounded-lg border border-border bg-card p-5 space-y-6">
        {/* Daily window */}
        <fieldset>
          <legend className="text-sm font-medium text-foreground mb-3">Daily Planning Window</legend>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="daily_start" className="block text-xs text-muted-foreground mb-1">
                Start time
              </label>
              <input
                id="daily_start"
                type="time"
                value={settings.daily_start}
                onChange={(e) => handleChange('daily_start', e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div>
              <label htmlFor="daily_end" className="block text-xs text-muted-foreground mb-1">
                End time
              </label>
              <input
                id="daily_end"
                type="time"
                value={settings.daily_end}
                onChange={(e) => handleChange('daily_end', e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>
        </fieldset>

        {/* Weekly window */}
        <fieldset>
          <legend className="text-sm font-medium text-foreground mb-3">Weekly Planning Window</legend>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="weekly_start" className="block text-xs text-muted-foreground mb-1">
                Start time
              </label>
              <input
                id="weekly_start"
                type="time"
                value={settings.weekly_start}
                onChange={(e) => handleChange('weekly_start', e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div>
              <label htmlFor="weekly_end" className="block text-xs text-muted-foreground mb-1">
                End time
              </label>
              <input
                id="weekly_end"
                type="time"
                value={settings.weekly_end}
                onChange={(e) => handleChange('weekly_end', e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>
        </fieldset>

        {/* Feedback */}
        {feedback && (
          <div
            className={`rounded-md px-3 py-2 text-sm ${
              feedback.type === 'success'
                ? 'bg-green-50 text-green-700 border border-green-200'
                : 'bg-red-50 text-red-700 border border-red-200'
            }`}
            role="alert"
          >
            {feedback.message}
          </div>
        )}

        {/* Save button */}
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={isSaving}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </form>
    </div>
  );
}
