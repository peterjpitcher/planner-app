import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ signOut: vi.fn(), clearAllNoteDrafts: vi.fn() }));

vi.mock('next/navigation', () => ({ usePathname: () => '/projects' }));
vi.mock('next-auth/react', () => ({ signOut: mocks.signOut }));
vi.mock('@/lib/noteDrafts', () => ({ clearAllNoteDrafts: mocks.clearAllNoteDrafts }));

import { Sidebar } from '../Sidebar';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Sidebar sign out', () => {
  it('removes unsaved notes kept in this browser before signing out', () => {
    render(<Sidebar />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(mocks.clearAllNoteDrafts).toHaveBeenCalledTimes(1);
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
    expect(mocks.clearAllNoteDrafts.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.signOut.mock.invocationCallOrder[0]);
  });
});
