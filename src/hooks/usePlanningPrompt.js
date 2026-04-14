'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { apiClient } from '@/lib/apiClient';
import { getActivePlanningWindow, getMondayOfWeek } from '@/lib/planningWindow';
import { getTimeZoneParts, LONDON_TIME_ZONE } from '@/lib/timezone';

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
  const [tasks, setTasks] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [hasNewTasks, setHasNewTasks] = useState(false);

  const settingsRef = useRef(null);
  const lastCheckRef = useRef(null);
  const sessionCandidateCountRef = useRef(null);

  const checkPlanningState = useCallback(async () => {
    try {
      // 1. Fetch settings (cache in ref)
      if (!settingsRef.current) {
        settingsRef.current = await apiClient.getUserSettings();
      }

      // 2. Determine active window
      const planningWindow = getActivePlanningWindow(settingsRef.current);

      setWindowState({ ...planningWindow, isManual: false });

      if (!planningWindow.isActive) {
        setIsLoading(false);
        setIsPlanned(false);
        setTasks(null);
        setHasNewTasks(false);
        sessionCandidateCountRef.current = null;
        return;
      }

      // 3. Check if already planned
      const session = await apiClient.getPlanningSession(planningWindow.windowType, planningWindow.windowDate);
      const planned = !!session;
      setIsPlanned(planned);

      // 4. Fetch candidates
      const candidates = await apiClient.getPlanningCandidates(planningWindow.windowType, planningWindow.windowDate);
      setTasks(candidates);

      // 5. Detect new tasks after planning — only flag if count increased since session
      const currentCount = Object.values(candidates).reduce((sum, arr) => sum + (arr?.length || 0), 0);
      if (planned) {
        setHasNewTasks(currentCount > (sessionCandidateCountRef.current ?? 0));
      } else {
        setHasNewTasks(false);
      }

      // 6. Show modal on first visit if not planned and there are tasks
      const hasTasks = Object.values(candidates).some((arr) => arr && arr.length > 0);
      const checkKey = `${planningWindow.windowType}-${planningWindow.windowDate}`;
      if (!planned && hasTasks && lastCheckRef.current !== checkKey) {
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
  const closeModal = useCallback(() => setShowModal(false), []);

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
        // Monday of the current week
        computedDate = getMondayOfWeek(today);
      } else {
        // Today — manual daily planning targets the current day
        computedDate = today;
      }

      const candidates = await apiClient.getPlanningCandidates(type, computedDate);
      setTasks(candidates);
      setWindowState({ isActive: true, windowType: type, windowDate: computedDate, isManual: true });

      // Check if already planned for this window
      const session = await apiClient.getPlanningSession(type, computedDate);
      setIsPlanned(!!session);

      setShowModal(true);
    } catch (err) {
      console.error('Manual planning trigger failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const onPlanningComplete = useCallback(async () => {
    setShowModal(false);
    setIsPlanned(true);
    setHasNewTasks(false);
    // Store current candidate count so re-checks only flag truly new tasks
    sessionCandidateCountRef.current = tasks
      ? Object.values(tasks).reduce((sum, arr) => sum + (arr?.length || 0), 0)
      : 0;
    // Emit event for views to refetch their data
    window.dispatchEvent(new CustomEvent('planning-complete'));
    // Re-check candidates (some may have moved, new ones may exist)
    await checkPlanningState();
  }, [checkPlanningState, tasks]);

  const totalCandidates = tasks
    ? Object.values(tasks).reduce((sum, arr) => sum + (arr?.length || 0), 0)
    : 0;

  return {
    isLoading,
    isActive: windowState.isActive,
    isManual: windowState.isManual,
    windowType: windowState.windowType,
    windowDate: windowState.windowDate,
    isPlanned,
    hasNewTasks,
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
