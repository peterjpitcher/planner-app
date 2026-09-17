import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/components/shared/QuickTaskInput', () => ({ default: () => null }));
vi.mock('@/components/shared/CustomerPicker', () => ({ default: () => null }));
vi.mock('@/components/shared/AttachmentsPanel', () => ({ default: () => null }));
vi.mock('@/components/shared/NotesPanel', () => ({
  default: ({ onFullScreen }) => (
    <button type="button" onClick={onFullScreen}>Notes full screen</button>
  ),
}));

vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

import ProjectWorkspace from '../ProjectWorkspace';

const PROJECT = { id: 'p1', name: 'Menu refresh', status: 'In Progress', customer_id: null };

function renderWorkspace() {
  render(
    <ProjectWorkspace
      project={PROJECT}
      tasks={[]}
      onUpdateProject={vi.fn()}
      onChangeStatus={vi.fn()}
      onDeleteProject={vi.fn()}
      onTaskAdded={vi.fn()}
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
