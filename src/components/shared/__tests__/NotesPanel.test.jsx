import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({
  getNotes: vi.fn(),
  getCustomerTimeline: vi.fn(),
  createNote: vi.fn(),
  updateNote: vi.fn(),
  deleteNote: vi.fn(),
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
