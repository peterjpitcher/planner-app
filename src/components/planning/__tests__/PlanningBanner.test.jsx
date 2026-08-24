import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import PlanningBanner from '../PlanningBanner';

const BASE = {
  totalCandidates: 12,
  newTaskCount: 0,
  windowType: 'daily',
  windowDate: '2026-08-24',
  onPlanNow: vi.fn(),
};

describe('PlanningBanner', () => {
  it('asks you to plan an unplanned day, naming the right day', () => {
    render(<PlanningBanner {...BASE} windowLabel="today" isPlanned={false} hasNewTasks={false} />);
    expect(screen.getByText('You have 12 tasks to plan for today')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Plan now' })).toBeTruthy();
  });

  it('does not ask you to plan a day that is already planned', () => {
    // The regression: leftover candidates made an already-planned day claim it
    // had a pile of unplanned work, so the banner nagged on every page load.
    render(<PlanningBanner {...BASE} windowLabel="today" isPlanned hasNewTasks={false} />);
    expect(screen.getByText("Today's planned")).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Plan now' })).toBeNull();
  });

  it('counts only genuinely new tasks when some arrive after planning', () => {
    render(
      <PlanningBanner {...BASE} windowLabel="today" isPlanned hasNewTasks newTaskCount={2} />
    );
    // 2 new, not the 12 candidates still sitting in the pool.
    expect(screen.getByText('2 new tasks since you planned today')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Review' })).toBeTruthy();
  });

  it('uses the singular for a single new task', () => {
    render(
      <PlanningBanner {...BASE} windowLabel="today" isPlanned hasNewTasks newTaskCount={1} />
    );
    expect(screen.getByText('1 new task since you planned today')).toBeTruthy();
  });

  it('says tomorrow while you are planning the evening window', () => {
    render(
      <PlanningBanner {...BASE} windowLabel="tomorrow" windowDate="2026-08-25" isPlanned={false} hasNewTasks={false} />
    );
    expect(screen.getByText('You have 12 tasks to plan for tomorrow')).toBeTruthy();
  });

  it('says the day is planned when only the week is outstanding', () => {
    // Monday: the autopilot built the day at 05:00, the weekly step never
    // happened. Claiming there are tasks "to plan for this week" without saying
    // the day is done reads as being asked to plan an already-planned day.
    render(
      <PlanningBanner
        {...BASE}
        windowType="weekly"
        windowLabel="this week"
        isPlanned={false}
        isDayPlanned
        hasNewTasks={false}
      />
    );
    expect(screen.getByText("Today's planned. You haven't planned this week yet")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Plan week' })).toBeTruthy();
  });

  it('labels a planned week correctly', () => {
    render(
      <PlanningBanner {...BASE} windowType="weekly" windowLabel="this week" isPlanned hasNewTasks={false} />
    );
    expect(screen.getByText("This week's planned")).toBeTruthy();
  });

  it('falls back to the date when the window is not a relative day', () => {
    render(
      <PlanningBanner {...BASE} windowLabel={null} windowDate="2026-08-28" isPlanned={false} hasNewTasks={false} />
    );
    expect(screen.getByText(/Friday 28 Aug/)).toBeTruthy();
  });

  it('can be dismissed once planned', () => {
    const { container } = render(
      <PlanningBanner {...BASE} windowLabel="today" isPlanned hasNewTasks={false} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(container.textContent).toBe('');
  });
});
