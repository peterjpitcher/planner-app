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

// This jsdom has no localStorage, and the panel keeps unsaved notes there, so
// every test gets a fresh in-memory one.
function memoryStorage() {
  const entries = new Map();
  return {
    get length() { return entries.size; },
    key: (index) => [...entries.keys()][index] ?? null,
    getItem: (key) => (entries.has(key) ? entries.get(key) : null),
    setItem: (key, value) => { entries.set(key, String(value)); },
    removeItem: (key) => { entries.delete(key); },
    clear: () => entries.clear(),
  };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
});

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

describe('NotesPanel keeping unsaved notes in this browser', () => {
  const KEY = 'planner.noteDraft.v1:project:project-1';

  const stored = () => JSON.parse(window.localStorage.getItem(KEY))?.text ?? null;

  async function renderPanel(props = {}) {
    render(<NotesPanel projectId="project-1" {...props} />);
    await waitFor(() => expect(api.getNotes).toHaveBeenCalled());
    return screen.getByRole('textbox', { name: 'New note' });
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    api.getNotes.mockResolvedValue({ data: [] });
    api.createNote.mockResolvedValue({});
    api.createTask.mockResolvedValue({ id: 'task-9' });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('keeps the note as it is written', async () => {
    const box = await renderPanel();
    fireEvent.change(box, { target: { value: 'Called Sam' } });
    expect(stored()).toBe(`${STAMP}Called Sam`);
  });

  it('brings the note back when the page is opened again, and says so', async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ text: `${STAMP}Called Sam`, savedAt: '2026-09-17T13:30:00.000Z' }));
    const box = await renderPanel();

    expect(box).toHaveValue(`${STAMP}Called Sam`);
    expect(screen.getByText('Unsaved note from 17 Sept, 14:30 restored.')).toBeInTheDocument();
  });

  it('forgets the kept copy once the note is saved', async () => {
    const box = await renderPanel();
    fireEvent.change(box, { target: { value: 'Called Sam' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
    });

    expect(api.createNote).toHaveBeenCalled();
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('keeps the copy when saving fails', async () => {
    api.createNote.mockRejectedValue(new Error('Network down'));
    const box = await renderPanel();
    fireEvent.change(box, { target: { value: 'Called Sam' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
    });

    expect(stored()).toBe(`${STAMP}Called Sam`);
  });

  it('discards a restored note only after confirming', async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ text: `${STAMP}Called Sam`, savedAt: '2026-09-17T13:30:00.000Z' }));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    const box = await renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(box).toHaveValue(`${STAMP}Called Sam`);
    expect(stored()).toBe(`${STAMP}Called Sam`);

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(box).toHaveValue('');
    expect(window.localStorage.getItem(KEY)).toBeNull();
    confirm.mockRestore();
  });

  it('removes the copy when the text is deleted here', async () => {
    const box = await renderPanel();
    fireEvent.change(box, { target: { value: 'Called Sam' } });
    fireEvent.change(box, { target: { value: '' } });
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('never deletes a note being written in another tab', async () => {
    const box = await renderPanel();

    // The project screen, open in another tab, keeps its draft.
    window.localStorage.setItem(KEY, JSON.stringify({ text: `${STAMP}Written on the screen`, savedAt: null }));
    window.dispatchEvent(new StorageEvent('storage', { key: KEY }));

    // This tab's empty box is clicked into and left.
    act(() => box.focus());
    act(() => box.blur());

    expect(stored()).toBe(`${STAMP}Written on the screen`);
  });

  it('gives up its copy to another tab, then deleting here leaves theirs alone', async () => {
    const box = await renderPanel();
    fireEvent.change(box, { target: { value: 'Mine' } });

    window.localStorage.setItem(KEY, JSON.stringify({ text: `${STAMP}Theirs`, savedAt: null }));
    window.dispatchEvent(new StorageEvent('storage', { key: KEY }));

    fireEvent.change(box, { target: { value: '' } });
    expect(stored()).toBe(`${STAMP}Theirs`);
  });

  it('does not create tasks again from lines finished before the tab closed', async () => {
    window.localStorage.setItem(KEY, JSON.stringify({
      text: `${STAMP}I'll send the menu\n${STAMP}`,
      savedAt: '2026-09-17T13:30:00.000Z',
    }));
    const box = await renderPanel({ autoTasks: true });

    const firstLineEnd = `${STAMP}I'll send the menu`.length;
    box.setSelectionRange(firstLineEnd, firstLineEnd);
    await act(async () => {
      fireEvent.keyDown(box, { key: 'Enter' });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
    });

    expect(api.createNote).toHaveBeenCalled();
    expect(api.createTask).not.toHaveBeenCalled();
  });

  it('says so when the browser will not keep a copy', async () => {
    window.localStorage.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    const box = await renderPanel();
    fireEvent.change(box, { target: { value: 'Called Sam' } });

    expect(screen.getByRole('alert')).toHaveTextContent('This browser is not keeping a copy of this note.');
  });

  it('keeps nothing, and restores nothing, for a read-only panel', async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ text: `${STAMP}Called Sam`, savedAt: null }));
    render(<NotesPanel projectId="project-1" disabled />);
    await waitFor(() => expect(api.getNotes).toHaveBeenCalled());

    expect(screen.queryByRole('textbox', { name: 'New note' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Unsaved note/)).not.toBeInTheDocument();
    expect(window.localStorage.length).toBe(1);
  });
});
