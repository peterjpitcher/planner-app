'use client';

import { useState, useEffect } from 'react';
import { apiClient } from '@/lib/apiClient';
import { AUTOPILOT_LEVEL } from '@/lib/constants';

const DEFAULT_SETTINGS = {
  daily_plan_start: '20:05',
  daily_plan_end: '20:00',
  weekly_plan_start: '20:05',
  weekly_plan_end: '20:00',
  autopilot_level: AUTOPILOT_LEVEL.OFF,
};

// Morning autopilot options (A3 / F5-lite). Off is the safe default — the app
// stays fully manual. Review builds tomorrow's plan overnight but waits for a
// morning acknowledgement; Fully automatic builds the day with a lighter touch.
const AUTOPILOT_OPTIONS = [
  {
    value: AUTOPILOT_LEVEL.OFF,
    title: 'Off',
    description: 'You plan each day yourself (default).',
  },
  {
    value: AUTOPILOT_LEVEL.REVIEW,
    title: 'Review each morning',
    description: "I build tomorrow's plan overnight; you review it in the morning.",
  },
  {
    value: AUTOPILOT_LEVEL.AUTO,
    title: 'Fully automatic',
    description: 'I build your day and you just adjust as needed.',
  },
];

export default function PlanningSettingsClient() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState(null); // { type: 'success' | 'error', message }

  useEffect(() => {
    async function loadSettings() {
      try {
        const data = await apiClient.getUserSettings();
        if (data) {
          setSettings({
            daily_plan_start: data.daily_plan_start ?? DEFAULT_SETTINGS.daily_plan_start,
            daily_plan_end: data.daily_plan_end ?? DEFAULT_SETTINGS.daily_plan_end,
            weekly_plan_start: data.weekly_plan_start ?? DEFAULT_SETTINGS.weekly_plan_start,
            weekly_plan_end: data.weekly_plan_end ?? DEFAULT_SETTINGS.weekly_plan_end,
            autopilot_level: data.autopilot_level ?? DEFAULT_SETTINGS.autopilot_level,
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
      await apiClient.updateUserSettings(settings);
      setFeedback({ type: 'success', message: 'Planning settings saved.' });
      // Notify the planning hook to refresh its cached settings
      window.dispatchEvent(new CustomEvent('planning-settings-updated'));
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
        Choose how your day gets planned, and when planning prompts appear.
      </p>

      <form onSubmit={handleSave} className="rounded-lg border border-border bg-card p-5 space-y-6">
        {/* Autopilot level (A3 / F5-lite) */}
        <fieldset>
          <legend className="text-sm font-medium text-foreground mb-1">Autopilot</legend>
          <p className="text-xs text-muted-foreground mb-3">
            Decide how much of your morning plan I build for you.
          </p>
          <div role="radiogroup" aria-label="Morning autopilot level" className="space-y-2">
            {AUTOPILOT_OPTIONS.map((opt) => {
              const isSelected = settings.autopilot_level === opt.value;
              return (
                <label
                  key={opt.value}
                  className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors focus-within:ring-1 focus-within:ring-primary ${
                    isSelected
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/40'
                  }`}
                >
                  <input
                    type="radio"
                    name="autopilot_level"
                    value={opt.value}
                    checked={isSelected}
                    onChange={() => handleChange('autopilot_level', opt.value)}
                    className="mt-0.5 h-4 w-4 shrink-0 border-border text-primary focus:ring-primary focus:ring-offset-0"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-foreground">{opt.title}</span>
                    <span className="block text-xs text-muted-foreground">{opt.description}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        {/* Daily window */}
        <fieldset>
          <legend className="text-sm font-medium text-foreground mb-3">Daily Planning Window</legend>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="daily_plan_start" className="block text-xs text-muted-foreground mb-1">
                Start time
              </label>
              <input
                id="daily_plan_start"
                type="time"
                value={settings.daily_plan_start}
                onChange={(e) => handleChange('daily_plan_start', e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div>
              <label htmlFor="daily_plan_end" className="block text-xs text-muted-foreground mb-1">
                End time
              </label>
              <input
                id="daily_plan_end"
                type="time"
                value={settings.daily_plan_end}
                onChange={(e) => handleChange('daily_plan_end', e.target.value)}
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
              <label htmlFor="weekly_plan_start" className="block text-xs text-muted-foreground mb-1">
                Start time
              </label>
              <input
                id="weekly_plan_start"
                type="time"
                value={settings.weekly_plan_start}
                onChange={(e) => handleChange('weekly_plan_start', e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div>
              <label htmlFor="weekly_plan_end" className="block text-xs text-muted-foreground mb-1">
                End time
              </label>
              <input
                id="weekly_plan_end"
                type="time"
                value={settings.weekly_plan_end}
                onChange={(e) => handleChange('weekly_plan_end', e.target.value)}
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
