'use client';

import { useState, useEffect } from 'react';
import { apiClient } from '@/lib/apiClient';
import { AUTOPILOT_LEVEL } from '@/lib/constants';
import { cn } from '@/lib/utils';
import AutomationsPanel from '@/components/settings/AutomationsPanel';

const DEFAULT_SETTINGS = {
  daily_plan_start: '20:05',
  daily_plan_end: '20:00',
  weekly_plan_start: '20:05',
  weekly_plan_end: '20:00',
  autopilot_level: AUTOPILOT_LEVEL.OFF,
  // Morning digest email on/off (Wave 4). Defaults to true so the owner keeps
  // getting the digest until they explicitly switch it off.
  digest_enabled: true,
  // AI day-planner on/off (A5 / Wave 8). Off by default — opting in is what
  // sends task titles and notes to OpenAI, so it must be a deliberate choice.
  ai_planning_enabled: false,
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
            digest_enabled: data.digest_enabled ?? DEFAULT_SETTINGS.digest_enabled,
            ai_planning_enabled: data.ai_planning_enabled ?? DEFAULT_SETTINGS.ai_planning_enabled,
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

        {/* Morning digest email on/off (Wave 4). Saved through the same
            handleSave / updateUserSettings path as the fields above. */}
        <fieldset>
          <legend className="text-sm font-medium text-foreground mb-1">Morning digest email</legend>
          <p className="text-xs text-muted-foreground mb-3">
            A short email each morning with your plan for the day.
          </p>
          <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
            <span id="digest-toggle-label" className="text-sm text-foreground">
              Send me the morning digest
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={settings.digest_enabled}
              aria-labelledby="digest-toggle-label"
              onClick={() => handleChange('digest_enabled', !settings.digest_enabled)}
              className={cn(
                'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
                settings.digest_enabled ? 'bg-primary' : 'bg-muted'
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
                  settings.digest_enabled ? 'translate-x-5' : 'translate-x-0.5'
                )}
              />
            </button>
          </div>
        </fieldset>

        {/* AI day-planner on/off (A5 / Wave 8). Saved through the same handleSave /
            updateUserSettings path as autopilot_level / digest_enabled. Off by
            default; opting in is what permits sending titles/notes to OpenAI. */}
        <fieldset>
          <legend className="text-sm font-medium text-foreground mb-1">AI day-planner</legend>
          <p className="text-xs text-muted-foreground mb-3">
            Let an AI suggest how to arrange your day from your candidate tasks. You still confirm each
            one — nothing is placed automatically.
          </p>
          <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
            <span id="ai-planning-toggle-label" className="text-sm text-foreground">
              Suggest my day with AI
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={settings.ai_planning_enabled}
              aria-labelledby="ai-planning-toggle-label"
              aria-describedby="ai-planning-toggle-help"
              onClick={() => handleChange('ai_planning_enabled', !settings.ai_planning_enabled)}
              className={cn(
                'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
                settings.ai_planning_enabled ? 'bg-primary' : 'bg-muted'
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
                  settings.ai_planning_enabled ? 'translate-x-5' : 'translate-x-0.5'
                )}
              />
            </button>
          </div>
          <p id="ai-planning-toggle-help" className="mt-2 text-xs text-muted-foreground">
            When on, your task titles and notes are sent to an external AI service (OpenAI) so it can
            suggest how to arrange your day. Off by default.
          </p>
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

      {/* Wave 4 heartbeat: read-only status of every background automation.
          Fetches independently and refreshes on tab focus. */}
      <AutomationsPanel />
    </div>
  );
}
