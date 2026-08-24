import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import QuickTaskList, { parseQuickTasks } from '../QuickTaskList';

const { createTask } = vi.hoisted(() => ({ createTask: vi.fn() }));

vi.mock('@/lib/apiClient', () => ({
  apiClient: { createTask },
}));

vi.mock('@/lib/timezone', () => ({
  getLondonDateKey: () => '2026-08-18',
}));

describe('parseQuickTasks', () => {
  it('turns non-empty trimmed lines into task names', () => {
    expect(parseQuickTasks(' First task \n\nSecond task\r\n  Third task  ')).toEqual([
      'First task',
      'Second task',
      'Third task',
    ]);
  });
});

describe('QuickTaskList', () => {
  beforeEach(() => {
    createTask.mockReset();
    createTask.mockResolvedValue({ id: 'task-id' });
  });

  it('uses trailing date phrases and defaults other lines to today', async () => {
    render(<QuickTaskList />);

    fireEvent.change(screen.getByLabelText('Tasks, one per line'), {
      target: {
        value: [
          'Rennovate the recipes for Kim/MJ and send them the results on Monday',
          'Chase Billy for x next Friday',
          'Chase Billy for y in a week',
          'Chase Billy for z on September 1',
          'Reply to Alex',
        ].join('\n'),
      },
    });
    const datePreview = screen.getByLabelText('Recognised due dates');
    expect(datePreview).toHaveTextContent('Rennovate the recipes for Kim/MJ and send them the results');
    expect(datePreview).toHaveTextContent('Mon, 24 Aug 2026');

    fireEvent.click(screen.getByRole('button', { name: 'Add 5 tasks' }));

    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(5));
    expect(createTask).toHaveBeenNthCalledWith(1, {
      name: 'Rennovate the recipes for Kim/MJ and send them the results',
      projectId: null,
      dueDate: '2026-08-24',
      state: 'backlog',
    });
    expect(createTask).toHaveBeenNthCalledWith(2, {
      name: 'Chase Billy for x',
      projectId: null,
      dueDate: '2026-08-28',
      state: 'backlog',
    });
    expect(createTask).toHaveBeenNthCalledWith(3, {
      name: 'Chase Billy for y',
      projectId: null,
      dueDate: '2026-08-25',
      state: 'backlog',
    });
    expect(createTask).toHaveBeenNthCalledWith(4, {
      name: 'Chase Billy for z',
      projectId: null,
      dueDate: '2026-09-01',
      state: 'backlog',
    });
    expect(createTask).toHaveBeenNthCalledWith(5, {
      name: 'Reply to Alex',
      projectId: null,
      dueDate: '2026-08-18',
      state: 'backlog',
    });

    expect(await screen.findByText('5 tasks added.')).toBeInTheDocument();
    expect(screen.getByLabelText('Tasks, one per line')).toHaveValue('');
  });

  it('keeps only failed tasks in the list for retry', async () => {
    createTask
      .mockResolvedValueOnce({ id: 'created' })
      .mockRejectedValueOnce(new Error('Request failed'));

    render(<QuickTaskList />);
    const textarea = screen.getByLabelText('Tasks, one per line');

    fireEvent.change(textarea, { target: { value: 'Created task\nFailed task' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add 2 tasks' }));

    expect(await screen.findByText('1 added. 1 failed and remains in the list.')).toBeInTheDocument();
    expect(textarea).toHaveValue('Failed task');
  });
});
