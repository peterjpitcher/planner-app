import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import TodayView from '../TodayView';

const { getTasks, updateTask } = vi.hoisted(() => ({
  getTasks: vi.fn(),
  updateTask: vi.fn(),
}));

vi.mock('@/lib/apiClient', () => ({
  apiClient: { getTasks, updateTask },
}));

vi.mock('@/lib/timezone', () => ({
  getLondonDateKey: () => '2026-08-18',
}));

vi.mock('@/lib/dateUtils', () => ({
  getStartOfTodayLondon: () => new Date('2026-08-17T23:00:00Z'),
}));

vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }) => children,
  PointerSensor: function PointerSensor() {},
  KeyboardSensor: function KeyboardSensor() {},
  closestCenter: vi.fn(),
  useSensor: vi.fn(() => ({})),
  useSensors: vi.fn(() => []),
}));

vi.mock('../AutopilotBanner', () => ({ default: () => null }));
vi.mock('../QuickTaskList', () => ({ default: () => null }));
vi.mock('@/components/ui/LoadingStates', () => ({ TaskListSkeleton: () => null }));
vi.mock('@/components/shared/TaskDetailDrawer', () => ({ default: () => null }));
vi.mock('@/components/shared/TaskCard', () => ({ default: () => null }));

vi.mock('../TodaySection', () => ({
  default: ({ sectionKey, tasks, onUpdate }) => (
    <div data-testid={`section-${sectionKey}`}>
      {tasks.map((task) => (
        <div key={task.id}>
          <span>{task.name}</span>
          <button
            type="button"
            onClick={() => onUpdate(task.id, { due_date: '2026-08-21' })}
          >
            Move to Friday
          </button>
          <button
            type="button"
            onClick={() => onUpdate(task.id, { due_date: '2026-08-28' })}
          >
            Move to next Friday
          </button>
        </div>
      ))}
    </div>
  ),
}));

const TODAY_TASK = {
  id: 'task-1',
  name: 'Reschedule me',
  state: 'today',
  today_section: 'must_do',
  due_date: '2026-08-18',
  sort_order: 100,
};

const storage = new Map();
const localStorageMock = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
};
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: localStorageMock,
});

describe('TodayView due-date changes', () => {
  beforeEach(() => {
    localStorage.setItem('planner_first_run_triage_shown', '1');
    getTasks.mockReset();
    updateTask.mockReset();
    updateTask.mockResolvedValue({});
    getTasks.mockImplementation((_, options) => (
      Promise.resolve(options?.state === 'today' ? [TODAY_TASK] : [])
    ));
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('moves a task due later this week out of Today and into This Week', async () => {
    render(<TodayView />);
    expect(await screen.findByText('Reschedule me')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Move to Friday' }));

    await waitFor(() => {
      expect(updateTask).toHaveBeenCalledWith('task-1', {
        due_date: '2026-08-21',
        state: 'this_week',
      });
    });
    expect(screen.queryByText('Reschedule me')).not.toBeInTheDocument();
  });

  it('moves a task due after this week out of Today and into Backlog', async () => {
    render(<TodayView />);
    expect(await screen.findByText('Reschedule me')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Move to next Friday' }));

    await waitFor(() => {
      expect(updateTask).toHaveBeenCalledWith('task-1', {
        due_date: '2026-08-28',
        state: 'backlog',
      });
    });
    expect(screen.queryByText('Reschedule me')).not.toBeInTheDocument();
  });
});
