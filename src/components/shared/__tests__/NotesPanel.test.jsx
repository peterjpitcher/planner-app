import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({
  getNotes: vi.fn(),
  getCustomerTimeline: vi.fn(),
  createNote: vi.fn(),
  updateNote: vi.fn(),
  deleteNote: vi.fn(),
  createTask: vi.fn(),
  deleteTask: vi.fn(),
}));

vi.mock('@/lib/apiClient', () => ({ apiClient: api }));

import NotesPanel from '../NotesPanel';

// 13:32 UTC is 14:32 in London (British Summer Time).
const NOW = new Date('2026-09-17T13:32:00Z');
const STAMP = '[17 Sep 2026 14:32] ';

async function renderPanel() {
  render(<NotesPanel projectId="project-1" />);
  await waitFor(() => expect(api.getNotes).toHaveBeenCalled());
  return screen.getByRole('textbox', { name: 'New note' });
}

describe('NotesPanel composer', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    api.getNotes.mockResolvedValue({ data: [] });
    api.createNote.mockResolvedValue({});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('shows the first stamp as soon as the empty box is focused, without Enter', async () => {
    const box = await renderPanel();
    act(() => box.focus());
    expect(box).toHaveValue(STAMP);
    expect(box.selectionStart).toBe(STAMP.length);
  });

  it('renews that stamp when typing starts, so it shows when the line was written', async () => {
    const box = await renderPanel();
    act(() => box.focus());

    vi.setSystemTime(new Date('2026-09-17T13:35:00Z'));
    fireEvent.change(box, { target: { value: `${STAMP}C` } });

    expect(box).toHaveValue('[17 Sep 2026 14:35] C');
  });

  it('empties a box holding only a stamp when it loses focus', async () => {
    const box = await renderPanel();
    act(() => box.focus());
    act(() => box.blur());
    expect(box).toHaveValue('');
  });

  it('keeps real text when the box loses focus', async () => {
    const box = await renderPanel();
    act(() => box.focus());
    fireEvent.change(box, { target: { value: `${STAMP}Called Sam` } });
    act(() => box.blur());
    expect(box).toHaveValue(`${STAMP}Called Sam`);
  });

  it('stamps the first line as soon as it gets text', async () => {
    const box = await renderPanel();
    fireEvent.change(box, { target: { value: 'C' } });
    expect(box).toHaveValue(`${STAMP}C`);
  });

  it('starts every new line with a London date and time stamp', async () => {
    const box = await renderPanel();
    fireEvent.change(box, { target: { value: 'Called Sam' } });

    vi.setSystemTime(new Date('2026-09-17T13:40:00Z'));
    box.setSelectionRange(box.value.length, box.value.length);
    const notPrevented = fireEvent.keyDown(box, { key: 'Enter' });

    expect(notPrevented).toBe(false);
    expect(box).toHaveValue(`${STAMP}Called Sam\n[17 Sep 2026 14:40] `);
  });

  it('leaves Shift plus Enter as a plain line break', async () => {
    const box = await renderPanel();
    fireEvent.change(box, { target: { value: 'Called Sam' } });
    const notPrevented = fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });

    expect(notPrevented).toBe(true);
    expect(box).toHaveValue(`${STAMP}Called Sam`);
  });

  it('saves without the empty stamp Enter leaves at the end', async () => {
    const box = await renderPanel();
    fireEvent.change(box, { target: { value: 'Called Sam' } });
    box.setSelectionRange(box.value.length, box.value.length);
    fireEvent.keyDown(box, { key: 'Enter' });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
    });

    expect(api.createNote).toHaveBeenCalledWith(
      expect.objectContaining({ content: `${STAMP}Called Sam`, project_id: 'project-1' })
    );
  });

  it('will not save a stamp on its own', async () => {
    const box = await renderPanel();
    fireEvent.change(box, { target: { value: 'x' } });
    fireEvent.change(box, { target: { value: STAMP } });

    expect(screen.getByRole('button', { name: 'Add note' })).toBeDisabled();
  });

  it('keeps the draft and shows the error when saving fails', async () => {
    api.createNote.mockRejectedValue(new Error('Network down'));
    const box = await renderPanel();
    fireEvent.change(box, { target: { value: 'Called Sam' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
    });

    expect(screen.getByRole('alert')).toHaveTextContent('Network down');
    expect(screen.getByRole('textbox', { name: 'New note' })).toHaveValue(`${STAMP}Called Sam`);
  });

  it('opens full screen with the same draft and returns to the page with it', async () => {
    const box = await renderPanel();
    fireEvent.change(box, { target: { value: 'Called Sam' } });

    fireEvent.click(screen.getByRole('button', { name: 'Write full screen' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('New note');
    expect(screen.getAllByRole('textbox', { name: 'New note' })).toHaveLength(1);
    expect(screen.getByRole('textbox', { name: 'New note' })).toHaveValue(`${STAMP}Called Sam`);

    fireEvent.click(screen.getByRole('button', { name: 'Exit full screen' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const pageBox = screen.getByRole('textbox', { name: 'New note' });
    expect(pageBox).toHaveValue(`${STAMP}Called Sam`);
    // Writing carries on without clicking back into the box.
    await waitFor(() => expect(pageBox).toHaveFocus());
  });

  it('offers no full screen on a read-only panel', async () => {
    render(<NotesPanel projectId="project-1" disabled />);
    await waitFor(() => expect(api.getNotes).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Write full screen' })).not.toBeInTheDocument();
  });
});

describe('NotesPanel picking up tasks as notes are written', () => {
  const onTaskPickedUp = vi.fn();
  const onTaskUndone = vi.fn();

  async function renderWithPickup(props = {}) {
    render(
      <NotesPanel
        projectId="project-1"
        autoTasks
        onTaskPickedUp={onTaskPickedUp}
        onTaskUndone={onTaskUndone}
        {...props}
      />
    );
    await waitFor(() => expect(api.getNotes).toHaveBeenCalled());
    return screen.getByRole('textbox', { name: 'New note' });
  }

  async function finishLine(box, text) {
    fireEvent.change(box, { target: { value: text } });
    box.setSelectionRange(box.value.length, box.value.length);
    await act(async () => {
      fireEvent.keyDown(box, { key: 'Enter' });
    });
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    api.getNotes.mockResolvedValue({ data: [] });
    api.createNote.mockResolvedValue({});
    api.createTask.mockResolvedValue({ id: 'task-9', name: 'Send the menu' });
    api.deleteTask.mockResolvedValue({});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('creates a task when a finished line reads like one', async () => {
    const box = await renderWithPickup();
    await finishLine(box, "I'll send the menu");

    expect(api.createTask).toHaveBeenCalledWith({
      name: 'Send the menu',
      projectId: 'project-1',
      dueDate: '2026-09-17',
      state: 'backlog',
    });
    await waitFor(() => expect(onTaskPickedUp).toHaveBeenCalledWith({ id: 'task-9', name: 'Send the menu' }));
    expect(screen.getByText('Tasks picked up from this note')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo task Send the menu' })).toBeInTheDocument();
  });

  it('leaves ordinary lines alone', async () => {
    const box = await renderWithPickup();
    await finishLine(box, 'Called Sam about the menu');
    expect(api.createTask).not.toHaveBeenCalled();
  });

  it('does nothing unless the page asks for it', async () => {
    render(<NotesPanel projectId="project-1" />);
    await waitFor(() => expect(api.getNotes).toHaveBeenCalled());
    const box = screen.getByRole('textbox', { name: 'New note' });

    await finishLine(box, "I'll send the menu");
    expect(api.createTask).not.toHaveBeenCalled();
  });

  it('does not read half a line when Enter splits it', async () => {
    const box = await renderWithPickup();
    fireEvent.change(box, { target: { value: "I'll send the menu to Sam" } });
    box.setSelectionRange(STAMP.length + 10, STAMP.length + 10);
    await act(async () => {
      fireEvent.keyDown(box, { key: 'Enter' });
    });
    expect(api.createTask).not.toHaveBeenCalled();
  });

  it('makes one task however often the same line is finished', async () => {
    const box = await renderWithPickup();
    await finishLine(box, "I'll send the menu");

    const firstLineEnd = `${STAMP}I'll send the menu`.length;
    box.setSelectionRange(firstLineEnd, firstLineEnd);
    await act(async () => {
      fireEvent.keyDown(box, { key: 'Enter' });
    });

    expect(api.createTask).toHaveBeenCalledTimes(1);
  });

  it('reads the last line when the note is saved, without a second copy', async () => {
    const box = await renderWithPickup();
    fireEvent.change(box, { target: { value: 'Need to book the photographer' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
    });

    expect(api.createTask).toHaveBeenCalledTimes(1);
    expect(api.createTask).toHaveBeenCalledWith(expect.objectContaining({ name: 'Book the photographer' }));
    expect(api.createNote).toHaveBeenCalled();
  });

  it('undoes a picked-up task', async () => {
    const box = await renderWithPickup();
    await finishLine(box, "I'll send the menu");
    const undo = await screen.findByRole('button', { name: 'Undo task Send the menu' });

    await act(async () => {
      fireEvent.click(undo);
    });

    expect(api.deleteTask).toHaveBeenCalledWith('task-9');
    expect(onTaskUndone).toHaveBeenCalledWith('task-9');
    expect(screen.queryByText('Send the menu')).not.toBeInTheDocument();
  });

  it('shows a task that could not be added, and adds it on retry', async () => {
    api.createTask.mockRejectedValueOnce(new Error('Network down'));
    const box = await renderWithPickup();
    await finishLine(box, "I'll send the menu");

    expect(await screen.findByRole('alert')).toHaveTextContent('Not added: Network down');
    expect(onTaskPickedUp).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry task Send the menu' }));
    });

    expect(api.createTask).toHaveBeenCalledTimes(2);
    expect(onTaskPickedUp).toHaveBeenCalledWith({ id: 'task-9', name: 'Send the menu' });
    expect(screen.getByRole('button', { name: 'Undo task Send the menu' })).toBeInTheDocument();
  });

  it('keeps the task when undo fails, and says so', async () => {
    api.deleteTask.mockRejectedValueOnce(new Error('Network down'));
    const box = await renderWithPickup();
    await finishLine(box, "I'll send the menu");

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Undo task Send the menu' }));
    });

    expect(screen.getByRole('alert')).toHaveTextContent('Network down');
    expect(onTaskUndone).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Undo task Send the menu' })).toBeInTheDocument();
  });
});
