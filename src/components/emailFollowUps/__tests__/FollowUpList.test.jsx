import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';

const api = vi.hoisted(() => ({
  getFollowUps: vi.fn(),
  updateFollowUp: vi.fn(),
}));

vi.mock('@/lib/apiClient', () => ({ apiClient: api }));

import FollowUpList from '../FollowUpList';

const MESSAGE_ID = 'AAMkAD_x-y=';
const OUTLOOK_LINK =
  'https://outlook.office365.com/owa/?ItemID=AAMkAD%2Bx%2Fy%3D&exvsurl=1&viewmodel=ReadMessageItem';

const NO_DRAFT = {
  id: 'f1',
  mailbox: 'orangejelly',
  counterpart_name: 'Sam',
  subject: 'Menu prices',
  state: 'awaiting_me',
  draft_status: 'none',
  proposed_draft: null,
  message_id: MESSAGE_ID,
  last_message_at: '2026-09-15T09:00:00Z',
};

const WAITING_ON_THEM = {
  ...NO_DRAFT,
  id: 'f2',
  counterpart_name: 'Brewery',
  subject: 'Delivery slot',
  state: 'awaiting_them',
  message_id: null,
};

const DRAFT_READY = {
  ...NO_DRAFT,
  id: 'f3',
  counterpart_name: 'Katie',
  subject: 'Christmas menu',
  draft_status: 'ready',
  proposed_draft: 'Hi Katie, thanks.',
};

function row(subject) {
  return screen.getByText(subject).closest('tr');
}

async function renderList(items = [NO_DRAFT, WAITING_ON_THEM, DRAFT_READY]) {
  api.getFollowUps.mockResolvedValue(items);
  render(<FollowUpList />);
  await screen.findByText(items[0].subject);
}

describe('FollowUpList', () => {
  beforeEach(() => {
    api.updateFollowUp.mockImplementation(async (id, updates) => ({ id, ...updates }));
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('links each email to the message in Outlook, in a new tab', async () => {
    await renderList();
    const link = within(row('Menu prices')).getByRole('link', { name: 'Open the email "Menu prices" in Outlook' });

    expect(link).toHaveAttribute('href', OUTLOOK_LINK);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('shows no link when the row has no message id', async () => {
    await renderList();
    expect(within(row('Delivery slot')).queryByRole('link')).not.toBeInTheDocument();
  });

  it('asks Jordan for a draft from the row, and shows it as requested', async () => {
    await renderList();
    const menuRow = row('Menu prices');

    await act(async () => {
      fireEvent.click(within(menuRow).getByRole('button', { name: 'Request draft' }));
    });

    expect(api.updateFollowUp).toHaveBeenCalledWith('f1', { draft_status: 'edit_requested' });
    expect(within(row('Menu prices')).getByText('Draft requested')).toBeInTheDocument();
    expect(within(row('Menu prices')).queryByRole('button', { name: 'Request draft' })).not.toBeInTheDocument();
  });

  it('offers a chase for a thread waiting on them', async () => {
    await renderList();
    expect(within(row('Delivery slot')).getByRole('button', { name: 'Request chase' })).toBeInTheDocument();
  });

  it('offers no request where a draft already exists', async () => {
    await renderList();
    const christmasRow = row('Christmas menu');
    expect(within(christmasRow).queryByRole('button', { name: /Request/ })).not.toBeInTheDocument();
    expect(within(christmasRow).getByText('Draft ready')).toBeInTheDocument();
  });

  it('shows the failure and leaves the row as it was when the request fails', async () => {
    api.updateFollowUp.mockRejectedValue(new Error('Network down'));
    await renderList();

    await act(async () => {
      fireEvent.click(within(row('Menu prices')).getByRole('button', { name: 'Request draft' }));
    });

    expect(screen.getByText('Network down')).toBeInTheDocument();
    expect(within(row('Menu prices')).getByText('No draft')).toBeInTheDocument();
    expect(within(row('Menu prices')).getByRole('button', { name: 'Request draft' })).toBeInTheDocument();
  });

  it('names the request plainly in the review panel and links the email there too', async () => {
    await renderList();
    fireEvent.click(within(row('Menu prices')).getByRole('button', { name: 'Review' }));

    const decision = screen.getByRole('combobox', { name: 'Decision' });
    expect(within(decision).getByRole('option', { name: 'Ask Jordan to write a draft' })).toBeInTheDocument();

    fireEvent.change(decision, { target: { value: 'edit_requested' } });
    expect(screen.getByText(/Jordan writes it on its next run/)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Open the email "Menu prices" in Outlook' })).toHaveLength(2);
  });

  it('calls a redraft a redraft when there is already a draft', async () => {
    await renderList();
    fireEvent.click(within(row('Christmas menu')).getByRole('button', { name: 'Review' }));

    const decision = screen.getByRole('combobox', { name: 'Decision' });
    expect(within(decision).getByRole('option', { name: 'Ask Jordan to redraft with my feedback' })).toBeInTheDocument();
  });
});
