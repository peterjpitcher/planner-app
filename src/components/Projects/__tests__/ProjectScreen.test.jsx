import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({
  getProject: vi.fn(),
  getAllTasks: vi.fn(),
  getProjects: vi.fn(),
  getAllProjects: vi.fn(),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
}));

const notesProps = vi.hoisted(() => ({ current: null }));

vi.mock('@/lib/apiClient', () => ({ apiClient: api }));
vi.mock('@/components/shared/NotesPanel', () => ({
  default: (props) => {
    notesProps.current = props;
    return <div>Notes for {props.projectId}</div>;
  },
}));
vi.mock('@/components/shared/AttachmentsPanel', () => ({
  default: ({ parentId }) => <div>Files for {parentId}</div>,
}));
vi.mock('@/components/shared/QuickTaskInput', () => ({
  default: ({ projectId }) => <input aria-label="Add task" data-project={projectId} />,
}));

vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
  x: 0, y: 0, top: 0, left: 0, bottom: 30, right: 100, width: 100, height: 30, toJSON() {},
});
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

import ProjectScreen from '../ProjectScreen';

const PROJECT = {
  id: 'p1',
  name: 'Menu refresh',
  status: 'In Progress',
  customer_id: 'c1',
  customer_name: 'The Anchor',
};

const TASKS = [
  { id: 't1', name: 'Price the new menu', state: 'this_week', project_id: 'p1', project_name: 'Menu refresh' },
  { id: 't2', name: 'Book the photographer', state: 'backlog', project_id: 'p1', project_name: 'Menu refresh' },
];

async function renderScreen() {
  const view = render(<ProjectScreen projectId="p1" />);
  await screen.findByRole('heading', { name: 'Menu refresh' });
  return view;
}

describe('ProjectScreen', () => {
  beforeEach(() => {
    api.getProject.mockResolvedValue(PROJECT);
    api.getAllTasks.mockResolvedValue(TASKS);
    api.updateTask.mockResolvedValue({});
    api.deleteTask.mockResolvedValue({});
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows this project, its customer, notes, open tasks and files', async () => {
    await renderScreen();

    expect(screen.getByText('The Anchor')).toBeInTheDocument();
    expect(screen.getByText('Notes for p1')).toBeInTheDocument();
    expect(screen.getByText('Files for p1')).toBeInTheDocument();
    expect(screen.getByText('Price the new menu')).toBeInTheDocument();
    expect(screen.getByText('Book the photographer')).toBeInTheDocument();
    expect(screen.getByLabelText('Add task')).toHaveAttribute('data-project', 'p1');
    expect(api.getAllTasks).toHaveBeenCalledWith('p1', { states: 'today,this_week,backlog,waiting' });
  });

  it('never loads the project list', async () => {
    await renderScreen();
    expect(api.getProject).toHaveBeenCalledWith('p1');
    expect(api.getProjects).not.toHaveBeenCalled();
    expect(api.getAllProjects).not.toHaveBeenCalled();
  });

  it('has no links anywhere, so nothing leads into the rest of the planner', async () => {
    const { container } = await renderScreen();
    expect(container.querySelectorAll('a')).toHaveLength(0);
  });

  it('writes notes at full size with no second full-screen button', async () => {
    await renderScreen();
    expect(notesProps.current).toMatchObject({ projectId: 'p1', allowFullScreen: false, disabled: false });
    expect(notesProps.current.composerRows).toBeGreaterThan(3);
  });

  it('completes a task straight away', async () => {
    await renderScreen();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Mark "Price the new menu" complete' }));

    await waitFor(() => expect(screen.queryByText('Price the new menu')).not.toBeInTheDocument());
    expect(api.updateTask).toHaveBeenCalledWith('t1', { state: 'done' });
  });

  it('shows the failure and reloads when a task change cannot be saved', async () => {
    api.updateTask.mockRejectedValue(new Error('Network down'));
    await renderScreen();
    await act(async () => {
      fireEvent.click(screen.getByRole('checkbox', { name: 'Mark "Price the new menu" complete' }));
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('Network down');
    await waitFor(() => expect(api.getAllTasks).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Price the new menu')).toBeInTheDocument();
  });

  it('shows a plain error, and nothing else, when the project cannot be loaded', async () => {
    api.getProject.mockRejectedValue(new Error('Project not found'));
    render(<ProjectScreen projectId="p1" />);

    expect(await screen.findByRole('alert')).toHaveTextContent('This project could not be loaded.');
    expect(screen.queryByText(/not found/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('is read-only for a closed project', async () => {
    api.getProject.mockResolvedValue({ ...PROJECT, status: 'Completed' });
    await renderScreen();

    expect(screen.queryByLabelText('Add task')).not.toBeInTheDocument();
    expect(notesProps.current.disabled).toBe(true);
  });

  it('closes the tab instead of navigating into the planner', async () => {
    const close = vi.spyOn(window, 'close').mockImplementation(() => {});
    await renderScreen();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(close).toHaveBeenCalled();
    expect(screen.getByText('Close this tab to finish')).toBeInTheDocument();
    close.mockRestore();
  });
});
