import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import CustomerWorkspace from '../CustomerWorkspace';

vi.stubGlobal(
  'ResizeObserver',
  class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

vi.mock('@/components/shared/QuickTaskInput', () => ({
  default: ({ customerId }) => (
    <div data-testid="quick-task-input" data-customer-id={customerId} />
  ),
}));

vi.mock('@/components/shared/NotesPanel', () => ({ default: () => null }));
vi.mock('@/components/shared/AttachmentsPanel', () => ({ default: () => null }));
vi.mock('../CustomerFacts', () => ({ default: () => null }));
vi.mock('../CustomerContacts', () => ({ default: () => null }));

describe('CustomerWorkspace', () => {
  it('files a quick-added task against the customer being viewed', () => {
    render(
      <CustomerWorkspace
        customer={{
          id: 'customer-1',
          name: 'Edmunds',
          status: 'Active',
          summary: null,
          website: null,
          area: null,
          archived_at: null,
        }}
        openProjects={[]}
        closedProjects={[]}
        tasks={[]}
        onUpdateCustomer={vi.fn()}
        onArchive={vi.fn()}
        onDelete={vi.fn()}
        onTaskAdded={vi.fn()}
        onCompleteTask={vi.fn()}
        onUpdateTask={vi.fn()}
        onDeleteTask={vi.fn()}
        onTaskClick={vi.fn()}
      />
    );

    expect(screen.getByTestId('quick-task-input')).toHaveAttribute(
      'data-customer-id',
      'customer-1'
    );
  });
});
