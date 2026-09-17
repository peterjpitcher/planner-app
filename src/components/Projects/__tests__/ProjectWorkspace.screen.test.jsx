import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/components/shared/QuickTaskInput', () => ({ default: () => null }));
vi.mock('@/components/shared/CustomerPicker', () => ({ default: () => null }));
vi.mock('@/components/shared/AttachmentsPanel', () => ({ default: () => null }));
const notesProps = vi.hoisted(() => ({ current: null }));
vi.mock('@/components/shared/NotesPanel', () => ({
  default: (props) => {
    notesProps.current = props;
    return <button type="button" onClick={props.onFullScreen}>Notes full screen</button>;
  },
}));

vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

import ProjectWorkspace from '../ProjectWorkspace';

const PROJECT = { id: 'p1', name: 'Menu refresh', status: 'In Progress', customer_id: null };

const onTaskAdded = vi.fn();
const onTaskRemoved = vi.fn();

function renderWorkspace() {
  render(
    <ProjectWorkspace
      project={PROJECT}
      tasks={[]}
      onUpdateProject={vi.fn()}
      onChangeStatus={vi.fn()}
      onDeleteProject={vi.fn()}
      onTaskAdded={onTaskAdded}
      onTaskRemoved={onTaskRemoved}
      onCompleteTask={vi.fn()}
      onMoveTask={vi.fn()}
      onUpdateTask={vi.fn()}
      onDeleteTask={vi.fn()}
      onTaskClick={vi.fn()}
    />
  );
}

describe('Opening the project screen from the project page', () => {
  let open;
  let screenTab;

  beforeEach(() => {
    screenTab = { opener: 'the planner tab' };
    open = vi.spyOn(window, 'open').mockReturnValue(screenTab);
  });

  afterEach(() => {
    cleanup();
    open.mockRestore();
  });

  it('opens the screen for this project in its own tab from the header', () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole('button', { name: 'Full screen' }));

    expect(open).toHaveBeenCalledWith('/focus/project/p1', '_blank');
    // The shared tab keeps no handle back to the planner tab.
    expect(screenTab.opener).toBeNull();
  });

  it('opens the same screen from the notes full-screen icon', () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole('button', { name: 'Notes full screen' }));

    expect(open).toHaveBeenCalledWith('/focus/project/p1', '_blank');
  });
});

describe('Tasks picked up from project notes', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('switches pick-up on and keeps the project task list in step', () => {
    renderWorkspace();
    expect(notesProps.current.autoTasks).toBe(true);

    const task = { id: 't9', name: 'Send the tasting menu' };
    notesProps.current.onTaskPickedUp(task);
    expect(onTaskAdded).toHaveBeenCalledWith(task, 'p1');

    notesProps.current.onTaskUndone('t9');
    expect(onTaskRemoved).toHaveBeenCalledWith('t9');
  });
});
