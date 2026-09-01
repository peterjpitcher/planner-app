import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import QuickTaskInput from '../QuickTaskInput';

const { createTask } = vi.hoisted(() => ({ createTask: vi.fn() }));

vi.mock('@/lib/apiClient', () => ({
  apiClient: { createTask },
}));

// Tuesday 18 August 2026. Fixing it here is also the timezone assertion: the
// component must take its base date from getLondonDateKey, not from a
// machine-local `new Date()`. If it ever goes back to the latter, every default
// due date below stops matching.
vi.mock('@/lib/timezone', () => ({
  getLondonDateKey: () => '2026-08-18',
}));

function typeTask(text) {
  fireEvent.change(screen.getByLabelText('New task'), { target: { value: text } });
}

describe('QuickTaskInput, single mode', () => {
  beforeEach(() => {
    createTask.mockReset();
    createTask.mockResolvedValue({ id: 'task-1' });
  });

  it('parses a trailing date phrase, which the project page could not do before', async () => {
    // This is the whole point of the merge. AddTaskInput hardcoded the due date
    // to today, so a task added on a project could never be given one.
    render(<QuickTaskInput mode="single" projectId="project-1" />);

    typeTask('Send the proposal next Friday');
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(1));
    // From Tuesday 18 August, "next Friday" is the Friday of next week (28th),
    // not the one three days away. That reading is the existing parser's and is
    // shared with /today, which is the point of having one implementation.
    expect(createTask).toHaveBeenCalledWith({
      name: 'Send the proposal',
      projectId: 'project-1',
      dueDate: '2026-08-28',
      state: 'backlog',
    });
  });

  it('defaults to the London date when there is no date phrase', async () => {
    render(<QuickTaskInput mode="single" projectId="project-1" />);

    typeTask('Call the supplier');
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(1));
    expect(createTask.mock.calls[0][0].dueDate).toBe('2026-08-18');
    expect(createTask.mock.calls[0][0].name).toBe('Call the supplier');
  });

  it('does not strip ordinary words that happen to be day names', async () => {
    render(<QuickTaskInput mode="single" />);

    typeTask('Discuss Friday trading');
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(1));
    expect(createTask.mock.calls[0][0].name).toBe('Discuss Friday trading');
    expect(createTask.mock.calls[0][0].dueDate).toBe('2026-08-18');
  });

  it('sends an explicit null project rather than omitting the field', async () => {
    render(<QuickTaskInput mode="single" projectId={null} />);

    typeTask('Unassigned task');
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(1));
    expect(createTask.mock.calls[0][0].projectId).toBeNull();
  });

  it('previews what it understood before you commit', async () => {
    render(<QuickTaskInput mode="single" />);

    typeTask('Book the room tomorrow');

    await waitFor(() => {
      expect(screen.getByText('Book the room')).toBeTruthy();
    });
    // 19 August 2026 is a Wednesday.
    expect(screen.getByText(/Wed 19 Aug/)).toBeTruthy();
  });

  it('shows no preview for a plain task, so there is no redundant noise', () => {
    render(<QuickTaskInput mode="single" />);
    typeTask('Call the supplier');
    expect(screen.queryByText(/due/)).toBeNull();
  });

  it('keeps the typed text when the save fails', async () => {
    createTask.mockRejectedValue(new Error('nope'));
    render(<QuickTaskInput mode="single" />);

    typeTask('Something important');
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
    });
    expect(screen.getByLabelText('New task').value).toBe('Something important');
  });

  it('clears the box on success so the next task can be typed straight away', async () => {
    render(<QuickTaskInput mode="single" />);

    typeTask('First task');
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(screen.getByLabelText('New task').value).toBe(''));
  });

  it('reports the created task back to the parent', async () => {
    const onTaskAdded = vi.fn();
    render(<QuickTaskInput mode="single" projectId="project-1" onTaskAdded={onTaskAdded} />);

    typeTask('Call the supplier');
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(onTaskAdded).toHaveBeenCalledWith({ id: 'task-1' }, 'project-1'));
  });

  it('will not submit an empty or whitespace-only task', () => {
    render(<QuickTaskInput mode="single" />);

    typeTask('   ');
    expect(screen.getByRole('button', { name: 'Add' }).disabled).toBe(true);
    expect(createTask).not.toHaveBeenCalled();
  });

  it('rejects a name over the column limit rather than letting the API 500', async () => {
    render(<QuickTaskInput mode="single" />);

    typeTask('x'.repeat(256));
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(createTask).not.toHaveBeenCalled();
  });

  it('honours disabled, so a closed project cannot take new tasks', () => {
    render(<QuickTaskInput mode="single" projectId="project-1" disabled />);

    expect(screen.getByLabelText('New task').disabled).toBe(true);
  });
});

describe('QuickTaskInput, multi mode', () => {
  beforeEach(() => {
    createTask.mockReset();
    createTask.mockResolvedValue({ id: 'task-1' });
  });

  it('creates one task per line', async () => {
    render(<QuickTaskInput mode="multi" />);

    fireEvent.change(screen.getByLabelText('Tasks, one per line'), {
      target: { value: 'First task\nSecond task tomorrow' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Add 2 tasks/ }));

    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(2));
    expect(createTask.mock.calls[0][0].dueDate).toBe('2026-08-18');
    expect(createTask.mock.calls[1][0]).toMatchObject({
      name: 'Second task',
      dueDate: '2026-08-19',
    });
  });

  it('refuses more than 25 at a time', async () => {
    render(<QuickTaskInput mode="multi" />);

    fireEvent.change(screen.getByLabelText('Tasks, one per line'), {
      target: { value: Array.from({ length: 26 }, (_, i) => `Task ${i}`).join('\n') },
    });
    fireEvent.click(screen.getByRole('button', { name: /Add 26 tasks/ }));

    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
    expect(createTask).not.toHaveBeenCalled();
  });
});
