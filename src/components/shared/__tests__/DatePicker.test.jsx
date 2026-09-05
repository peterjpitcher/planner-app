import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import DatePicker from '../DatePicker';
import TaskCard from '../TaskCard';

vi.stubGlobal('React', React);
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

describe('confirmed date selection', () => {
  it('does not save intermediate dates or a cancelled selection', () => {
    const save = vi.fn();
    render(<DatePicker value="2026-09-03" title="Change date" onSave={save} />);
    fireEvent.click(screen.getByRole('button', { name: 'Change date' }));
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-10-03' } });
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-11-03' } });
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Change date' }));
    expect(screen.getByLabelText('Date')).toHaveValue('2026-09-03');
  });

  it('saves the chosen date once and supports explicit clearing', () => {
    const save = vi.fn();
    render(<DatePicker value="2026-09-03" title="Change date" onSave={save} />);
    fireEvent.click(screen.getByRole('button', { name: 'Change date' }));
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-10-19' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save date' }));
    expect(save).toHaveBeenCalledExactlyOnceWith('2026-10-19');
    fireEvent.click(screen.getByRole('button', { name: 'Change date' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear date' }));
    expect(save).toHaveBeenLastCalledWith(null);
  });

  it('does not write unchanged dates and honours the minimum date', () => {
    const save = vi.fn();
    render(<DatePicker value="2026-09-08" min="2026-09-05" title="Snooze" onSave={save} />);
    fireEvent.click(screen.getByRole('button', { name: 'Snooze' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save date' }));
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Snooze' }));
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-09-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save date' }));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('cancels with Escape without saving the draft', () => {
    const save = vi.fn();
    render(<DatePicker value="2026-09-03" title="Change date" onSave={save} />);
    fireEvent.click(screen.getByRole('button', { name: 'Change date' }));
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-10-19' } });
    fireEvent.keyDown(screen.getByLabelText('Date'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });

  it('keeps the snooze editor open after its menu closes and waits for Save', async () => {
    const snooze = vi.fn();
    render(<TaskCard task={{ id: 'task-1', name: 'Example task', state: 'backlog' }} onSnooze={snooze} />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Task actions' }), { key: 'ArrowDown' });
    fireEvent.click(await screen.findByText('Pick a snooze date'));
    await screen.findByRole('dialog', { name: 'Snooze task until' });
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2099-10-03' } });
    expect(snooze).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save date' }));
    await waitFor(() => expect(snooze).toHaveBeenCalledExactlyOnceWith('task-1', '2099-10-03'));
  });
});
