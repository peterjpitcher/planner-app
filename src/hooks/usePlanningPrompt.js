'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { apiClient } from '@/lib/apiClient';
import { getActivePlanningWindow, getPlanningWeekStart, getWindowLabel } from '@/lib/planningWindow';
import { countCandidates, countNewCandidates, hasCandidates } from '@/lib/planningCandidates';
import { getLondonDateKey, getTimeZoneParts, LONDON_TIME_ZONE } from '@/lib/timezone';
import { AUTOPILOT_LEVEL, WINDOW_TYPE } from '@/lib/constants';

/**
 * Central orchestrator for planning prompts.
 * Mounted in AppShell — checks London time, fetches candidates, manages modal/banner state.
 */
export function usePlanningPrompt() {
  const pathname = usePathname();
  const [isLoading, setIsLoading] = useState(true);
  const [windowState, setWindowState] = useState({
    isActive: false,
    windowType: null,
    windowDate: null,
    isManual: false,
  });
  const [isPlanned, setIsPlanned] = useState(false);
  const [isDayPlanned, setIsDayPlanned] = useState(false);
  const [tasks, setTasks] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [newTaskCount, setNewTaskCount] = useState(0);

  const settingsRef = useRef(null);
  const lastCheckRef = useRef(null);
  const manualOverrideRef = useRef(false);

  const checkPlanningState = useCallback(async () => {
    try {
      // Skip auto-check while a manual planning session is active
      if (manualOverrideRef.current) {
        return;
      }

      // 1. Fetch settings (cache in ref)
      if (!settingsRef.current) {
        settingsRef.current = await apiClient.getUserSettings();
      }

      // 2. Determine active window
      const planningWindow = getActivePlanningWindow(settingsRef.current);

      setWindowState({ ...planningWindow, isManual: false, pendingType: planningWindow.windowType });

      if (!planningWindow.isActive) {
        setIsLoading(false);
        setIsPlanned(false);
        setIsDayPlanned(false);
        setTasks(null);
        setNewTaskCount(0);
        return;
      }

      // 3. Check if already planned.
      // The Sunday auto weekly window is a two-step combined flow (weekly → daily
      // for Monday). It is only fully planned once BOTH the weekly and the daily
      // session exist for the window date. If just the weekly session exists the
      // user abandoned after step 1, so the daily (Monday) step is still pending
      // and must be re-prompted rather than shown as planned (FF-019 / FF-023).
      const isCombinedFlow = planningWindow.windowType === WINDOW_TYPE.WEEKLY;
      let planned;
      let plannedSession = null;
      let weeklyStepComplete = false;
      // Whether the DAY the window covers has a plan, which is not the same as
      // the window being finished: on a Monday the weekly step can still be
      // outstanding while the day itself was built hours ago by the autopilot.
      let dayPlanned;
      if (isCombinedFlow) {
        const [weeklySession, dailySession] = await Promise.all([
          apiClient.getPlanningSession(WINDOW_TYPE.WEEKLY, planningWindow.windowDate),
          apiClient.getPlanningSession(WINDOW_TYPE.DAILY, planningWindow.windowDate),
        ]);
        planned = !!weeklySession && !!dailySession;
        weeklyStepComplete = !!weeklySession && !dailySession;
        dayPlanned = !!dailySession;
        // The daily step finishes the combined flow, so its completed_at is the
        // moment the window was actually planned.
        plannedSession = planned ? dailySession : null;
      } else {
        const session = await apiClient.getPlanningSession(planningWindow.windowType, planningWindow.windowDate);
        planned = !!session;
        dayPlanned = planned;
        plannedSession = session || null;
      }
      setIsPlanned(planned);
      setIsDayPlanned(dayPlanned);

      // 4. Fetch candidates. Once the weekly step is done the pending work is the
      // daily (Monday) step, so surface the daily candidates instead (FF-023).
      const candidateType = weeklyStepComplete ? WINDOW_TYPE.DAILY : planningWindow.windowType;
      // Label the outstanding step, not the window: once the weekly step is done
      // the pending work is Monday's day plan, so calling it "next week" misnames it.
      if (weeklyStepComplete) {
        setWindowState({ ...planningWindow, isManual: false, pendingType: WINDOW_TYPE.DAILY });
      }
      const candidates = await apiClient.getPlanningCandidates(candidateType, planningWindow.windowDate);
      setTasks(candidates);

      // 5. Detect new tasks after planning. "New" means captured after the plan
      // was made, derived from the session's completed_at and each task's
      // created_at. This used to compare against a count held in a ref, which
      // was empty on every fresh load and on any other device, so a planned day
      // permanently claimed it had unplanned work and nagged the user to plan it
      // again. Leftover candidates the user consciously left out of the plan are
      // not new work and must not re-prompt.
      setNewTaskCount(planned ? countNewCandidates(candidates, plannedSession?.completed_at) : 0);

      // 6. Decide whether to interrupt with the modal. Two rules, both of which
      // exist because the app was opening it on days that were already planned:
      //
      //  - The day must actually be unplanned. The weekly window stays active all
      //    of Monday, so an outstanding weekly step made an autopilot-built Monday
      //    look unplanned and popped the modal every Monday morning. The weekly
      //    step is still offered, in the banner, where it belongs.
      //  - Planning must still be the user's job. At autopilot level 'review' or
      //    'auto' the app has promised to build the day itself ("I build your day
      //    and you just adjust as needed"), so interrupting to demand a plan
      //    contradicts the setting the user chose.
      //
      // In both cases the banner and the Plan menu remain, so planning is always
      // one click away. A resumed daily step uses a distinct key so abandoning the
      // Sunday flow after the weekly step re-prompts the pending Monday plan
      // exactly once.
      const hasTasks = hasCandidates(candidates);
      const autopilotLevel = settingsRef.current?.autopilot_level || AUTOPILOT_LEVEL.OFF;
      const planningIsUserJob = autopilotLevel === AUTOPILOT_LEVEL.OFF;
      const checkKey = weeklyStepComplete
        ? `${planningWindow.windowType}-${planningWindow.windowDate}-daily`
        : `${planningWindow.windowType}-${planningWindow.windowDate}`;
      if (planningIsUserJob && !planned && !dayPlanned && hasTasks && lastCheckRef.current !== checkKey) {
        setShowModal(true);
      }
      lastCheckRef.current = checkKey;
    } catch (err) {
      console.error('Planning prompt check failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Run on mount and pathname changes
  useEffect(() => {
    checkPlanningState();
  }, [pathname, checkPlanningState]);

  // Recheck on tab focus (cross-device, time passing)
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        // Invalidate settings cache on refocus
        settingsRef.current = null;
        checkPlanningState();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [checkPlanningState]);

  // Refresh when planning settings are saved from the settings page
  useEffect(() => {
    const handleSettingsUpdate = () => {
      settingsRef.current = null;
      checkPlanningState();
    };
    window.addEventListener('planning-settings-updated', handleSettingsUpdate);
    return () => window.removeEventListener('planning-settings-updated', handleSettingsUpdate);
  }, [checkPlanningState]);

  const openModal = useCallback(() => setShowModal(true), []);
  const closeModal = useCallback(() => {
    setShowModal(false);
    manualOverrideRef.current = false;
    // Manual planning overwrites the shared window state the banner reads, so
    // without this re-check closing a manually opened modal leaves an already
    // planned day showing a "you have N tasks to plan" prompt until the next
    // navigation or tab switch.
    checkPlanningState();
  }, [checkPlanningState]);

  const refreshSettings = useCallback(() => {
    settingsRef.current = null;
  }, []);

  /**
   * Manually trigger the planning modal for a given mode, regardless of the time window.
   * @param {'daily' | 'weekly'} type
   */
  const triggerManualPlanning = useCallback(async (type) => {
    try {
      setIsLoading(true);
      const londonParts = getTimeZoneParts(new Date(), LONDON_TIME_ZONE);
      const today = londonParts.dateKey;

      let computedDate;
      if (type === 'weekly') {
        // The Monday weekly planning targets, which on a Sunday is tomorrow's,
        // matching the automatic Sunday window. Using the ISO Monday here aimed
        // manual weekly planning at the week that was ending.
        computedDate = getPlanningWeekStart(today);
      } else {
        // Today — manual daily planning targets the current day
        computedDate = today;
      }

      const candidates = await apiClient.getPlanningCandidates(type, computedDate);
      setTasks(candidates);
      setWindowState({ isActive: true, windowType: type, windowDate: computedDate, isManual: true, pendingType: type });

      // Check if already planned for this window
      const session = await apiClient.getPlanningSession(type, computedDate);
      setIsPlanned(!!session);
      setIsDayPlanned(!!session);
      setNewTaskCount(session ? countNewCandidates(candidates, session.completed_at) : 0);

      manualOverrideRef.current = true;
      setShowModal(true);
    } catch (err) {
      console.error('Manual planning trigger failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const onPlanningComplete = useCallback(async () => {
    setShowModal(false);
    manualOverrideRef.current = false;
    setIsPlanned(true);
    setIsDayPlanned(true);
    setNewTaskCount(0);
    // Emit event for views to refetch their data
    window.dispatchEvent(new CustomEvent('planning-complete'));
    // Re-check candidates (some may have moved, new ones may exist). The new-task
    // count it recomputes comes from the freshly stamped session, so it agrees
    // with what any other device would show.
    await checkPlanningState();
  }, [checkPlanningState]);

  const totalCandidates = countCandidates(tasks);
  const windowLabel = getWindowLabel(
    windowState.pendingType || windowState.windowType,
    windowState.windowDate,
    getLondonDateKey()
  );

  return {
    isLoading,
    isActive: windowState.isActive,
    isManual: windowState.isManual,
    windowType: windowState.windowType,
    windowDate: windowState.windowDate,
    windowLabel,
    isPlanned,
    isDayPlanned,
    hasNewTasks: newTaskCount > 0,
    newTaskCount,
    tasks,
    totalCandidates,
    showModal,
    openModal,
    closeModal,
    onPlanningComplete,
    refreshSettings,
    triggerManualPlanning,
  };
}
