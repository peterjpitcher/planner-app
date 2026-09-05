import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { test, vi, expect, afterEach } from 'vitest';
import TodayView from '../TodayView';
import { apiClient } from '@/lib/apiClient';

vi.stubGlobal('React', React);
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
vi.stubGlobal('localStorage', { getItem: () => '1', setItem: vi.fn(), removeItem: vi.fn() });
vi.mock('@/lib/apiClient', () => ({ apiClient: {
  getTasks: vi.fn(), updateTask: vi.fn().mockResolvedValue({}), getAllTasks: vi.fn().mockResolvedValue([]),
  getUserSettings: vi.fn().mockResolvedValue({ autopilot_level: 'off' }), getPlanningSession: vi.fn().mockResolvedValue(null), getProjects: vi.fn().mockResolvedValue([]),
} }));
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { id: 'fixture-user' } }, status: 'authenticated' }) }));
afterEach(() => { cleanup(); vi.useRealTimers(); });

test('Today keeps the actual task card while browsing dates, then moves it only after Save', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-05T12:00:00Z'));
  const task = { id: 't1', name: 'Calendar navigation fixture', state: 'today', today_section: 'must_do', due_date: '2026-09-03', sort_order: 100 };
  apiClient.getTasks.mockImplementation((_, options) => Promise.resolve(options?.state === 'today' ? [task] : []));
  render(<TodayView />);
  await screen.findByText('Calendar navigation fixture');
  fireEvent.click(screen.getByRole('button', { name: 'Change task due date' }));
  fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-10-03' } });
  expect(apiClient.updateTask).not.toHaveBeenCalled();
  expect(screen.getByText('Calendar navigation fixture')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-10-19' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save date' }));
  await waitFor(() => expect(apiClient.updateTask).toHaveBeenCalledExactlyOnceWith('t1', { due_date: '2026-10-19', state: 'backlog' }));
  expect(screen.queryByText('Calendar navigation fixture')).not.toBeInTheDocument();
});
