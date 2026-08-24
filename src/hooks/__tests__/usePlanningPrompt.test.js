import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({ usePathname: () => '/today' }));

const getUserSettings = vi.fn();
const getPlanningSession = vi.fn();
const getPlanningCandidates = vi.fn();

vi.mock('@/lib/apiClient', () => ({
  apiClient: {
    getUserSettings: (...args) => getUserSettings(...args),
    getPlanningSession: (...args) => getPlanningSession(...args),
    getPlanningCandidates: (...args) => getPlanningCandidates(...args),
  },
}));

const { usePlanningPrompt } = await import('../usePlanningPrompt');

// Tuesday 25 August 2026, 10:00 London. Inside the daily window, which by then
// targets the current day: the plan made last night.
const TUESDAY_MORNING = new Date('2026-08-25T09:00:00.000Z');
const PLANNED_AT = '2026-08-24T20:31:00.000Z';

function candidates({ leftovers = 0, fresh = 0 } = {}) {
  return {
    carriedFromToday: [],
    inbox: Array.from({ length: fresh }, (_, i) => ({
      id: `fresh-${i}`,
      created_at: '2026-08-25T08:00:00.000Z',
    })),
    dueTomorrow: [],
    overdue: Array.from({ length: leftovers }, (_, i) => ({
      id: `old-${i}`,
      created_at: '2026-07-02T09:00:00.000Z',
    })),
    undatedThisWeek: [],
    reviewBacklog: [],
    reviewBacklogTotal: 0,
    chaseDue: [],
  };
}

describe('usePlanningPrompt', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(TUESDAY_MORNING);
    getUserSettings.mockResolvedValue({});
    getPlanningSession.mockReset();
    getPlanningCandidates.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('targets the current day once the evening window has rolled over', async () => {
    getPlanningSession.mockResolvedValue(null);
    getPlanningCandidates.mockResolvedValue(candidates({ leftovers: 3 }));

    const { result } = renderHook(() => usePlanningPrompt());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isActive).toBe(true);
    expect(result.current.windowType).toBe('daily');
    expect(result.current.windowDate).toBe('2026-08-25');
    expect(result.current.windowLabel).toBe('today');
  });

  it('does not report new work when a planned day still has leftover candidates', async () => {
    // The reported bug. Twelve tasks the user deliberately left out of last
    // night's plan are not new work, and flagging them made the app ask for the
    // day to be planned again on every reload and on every other device.
    getPlanningSession.mockResolvedValue({ id: 's1', completed_at: PLANNED_AT, auto_planned: false });
    getPlanningCandidates.mockResolvedValue(candidates({ leftovers: 12 }));

    const { result } = renderHook(() => usePlanningPrompt());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isPlanned).toBe(true);
    expect(result.current.hasNewTasks).toBe(false);
    expect(result.current.newTaskCount).toBe(0);
    expect(result.current.showModal).toBe(false);
  });

  it('treats an autopilot-built day as planned', async () => {
    getPlanningSession.mockResolvedValue({ id: 's1', completed_at: '2026-08-25T05:00:00.000Z', auto_planned: true });
    getPlanningCandidates.mockResolvedValue(candidates({ leftovers: 9 }));

    const { result } = renderHook(() => usePlanningPrompt());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isPlanned).toBe(true);
    expect(result.current.hasNewTasks).toBe(false);
    expect(result.current.showModal).toBe(false);
  });

  it('reports only the tasks captured since the plan was made', async () => {
    getPlanningSession.mockResolvedValue({ id: 's1', completed_at: PLANNED_AT });
    getPlanningCandidates.mockResolvedValue(candidates({ leftovers: 12, fresh: 2 }));

    const { result } = renderHook(() => usePlanningPrompt());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.hasNewTasks).toBe(true);
    expect(result.current.newTaskCount).toBe(2);
    expect(result.current.totalCandidates).toBe(14);
    // New work is surfaced in the banner, never by reopening the modal.
    expect(result.current.showModal).toBe(false);
  });

  it('still prompts when the day has genuinely not been planned', async () => {
    getPlanningSession.mockResolvedValue(null);
    getPlanningCandidates.mockResolvedValue(candidates({ leftovers: 5 }));

    const { result } = renderHook(() => usePlanningPrompt());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isPlanned).toBe(false);
    expect(result.current.showModal).toBe(true);
    expect(result.current.totalCandidates).toBe(5);
  });

  it('does not open the modal for an unplanned day with nothing to plan', async () => {
    getPlanningSession.mockResolvedValue(null);
    getPlanningCandidates.mockResolvedValue(candidates());

    const { result } = renderHook(() => usePlanningPrompt());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.showModal).toBe(false);
  });

  it('needs both the weekly and the daily step before a Monday counts as planned', async () => {
    vi.setSystemTime(new Date('2026-08-24T09:00:00.000Z')); // Monday, weekly window
    getPlanningSession.mockImplementation(async (type) => (type === 'weekly' ? { id: 'w1', completed_at: PLANNED_AT } : null));
    getPlanningCandidates.mockResolvedValue(candidates({ leftovers: 4 }));

    const { result } = renderHook(() => usePlanningPrompt());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.windowType).toBe('weekly');
    expect(result.current.isPlanned).toBe(false);
    expect(result.current.isDayPlanned).toBe(false);
    expect(result.current.showModal).toBe(true);
  });

  it('does not pop the modal on a Monday whose day the autopilot already built', async () => {
    // The reported bug. The weekly window stays active all Monday, so an
    // outstanding weekly step made an already-built Monday look unplanned and
    // opened the planning modal every Monday morning.
    vi.setSystemTime(new Date('2026-08-24T09:00:00.000Z')); // Monday, weekly window
    getUserSettings.mockResolvedValue({ autopilot_level: 'off' });
    getPlanningSession.mockImplementation(async (type) =>
      type === 'daily' ? { id: 'd1', completed_at: '2026-08-24T04:00:30.000Z', auto_planned: true } : null
    );
    getPlanningCandidates.mockResolvedValue(candidates({ leftovers: 6 }));

    const { result } = renderHook(() => usePlanningPrompt());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isPlanned).toBe(false); // the week is still unplanned
    expect(result.current.isDayPlanned).toBe(true); // but the day is not
    expect(result.current.showModal).toBe(false);
  });

  it('does not interrupt at all when the user has delegated planning to autopilot', async () => {
    // "Fully automatic: I build your day and you just adjust as needed." Popping
    // a modal demanding a plan contradicts the setting the user chose.
    getUserSettings.mockResolvedValue({ autopilot_level: 'auto' });
    getPlanningSession.mockResolvedValue(null);
    getPlanningCandidates.mockResolvedValue(candidates({ leftovers: 30 }));

    const { result } = renderHook(() => usePlanningPrompt());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isPlanned).toBe(false);
    expect(result.current.showModal).toBe(false);
    // The banner still offers it, so planning stays one click away.
    expect(result.current.totalCandidates).toBe(30);
  });

  it('still interrupts at autopilot level off, which is the default', async () => {
    getUserSettings.mockResolvedValue({ autopilot_level: 'off' });
    getPlanningSession.mockResolvedValue(null);
    getPlanningCandidates.mockResolvedValue(candidates({ leftovers: 4 }));

    const { result } = renderHook(() => usePlanningPrompt());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.showModal).toBe(true);
  });

  it('counts a fully planned Monday from the daily step that closed it', async () => {
    vi.setSystemTime(new Date('2026-08-24T09:00:00.000Z')); // Monday, weekly window
    getPlanningSession.mockImplementation(async (type) =>
      type === 'weekly'
        ? { id: 'w1', completed_at: '2026-08-23T20:10:00.000Z' }
        : { id: 'd1', completed_at: '2026-08-23T20:31:00.000Z' }
    );
    getPlanningCandidates.mockResolvedValue(candidates({ leftovers: 7 }));

    const { result } = renderHook(() => usePlanningPrompt());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isPlanned).toBe(true);
    expect(result.current.hasNewTasks).toBe(false);
    expect(result.current.windowLabel).toBe('this week');
    expect(result.current.showModal).toBe(false);
  });
});
