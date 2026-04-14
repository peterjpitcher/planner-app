'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { apiClient } from '@/lib/apiClient';
import { getActivePlanningWindow } from '@/lib/planningWindow';

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
  });
  const [isPlanned, setIsPlanned] = useState(false);
  const [tasks, setTasks] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [hasNewTasks, setHasNewTasks] = useState(false);

  const settingsRef = useRef(null);
  const lastCheckRef = useRef(null);

  const checkPlanningState = useCallback(async () => {
    try {
      // 1. Fetch settings (cache in ref)
      if (!settingsRef.current) {
        settingsRef.current = await apiClient.getUserSettings();
      }

      // 2. Determine active window
      const planningWindow = getActivePlanningWindow(settingsRef.current);

      setWindowState(planningWindow);

      if (!planningWindow.isActive) {
        setIsLoading(false);
        setIsPlanned(false);
        setTasks(null);
        setHasNewTasks(false);
        return;
      }

      // 3. Check if already planned
      const session = await apiClient.getPlanningSession(planningWindow.windowType, planningWindow.windowDate);
      const planned = !!session;
      setIsPlanned(planned);

      // 4. Fetch candidates
      const candidates = await apiClient.getPlanningCandidates(planningWindow.windowType, planningWindow.windowDate);
      setTasks(candidates);

      // 5. Detect new tasks after planning
      if (planned) {
        const hasCandidates = Object.values(candidates).some((arr) => arr && arr.length > 0);
        setHasNewTasks(hasCandidates);
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

  const openModal = useCallback(() => setShowModal(true), []);
  const closeModal = useCallback(() => setShowModal(false), []);

  const refreshSettings = useCallback(() => {
    settingsRef.current = null;
  }, []);

  const onPlanningComplete = useCallback(async () => {
    setShowModal(false);
    setIsPlanned(true);
    setHasNewTasks(false);
    // Emit event for views to refetch their data
    window.dispatchEvent(new CustomEvent('planning-complete'));
    // Re-check candidates (some may have moved, new ones may exist)
    await checkPlanningState();
  }, [checkPlanningState]);

  const totalCandidates = tasks
    ? Object.values(tasks).reduce((sum, arr) => sum + (arr?.length || 0), 0)
    : 0;

  return {
    isLoading,
    isActive: windowState.isActive,
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
  };
}
