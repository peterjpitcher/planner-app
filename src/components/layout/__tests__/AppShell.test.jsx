import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const navigation = vi.hoisted(() => ({ pathname: '/projects' }));

vi.mock('next/navigation', () => ({ usePathname: () => navigation.pathname }));
vi.mock('../Sidebar', () => ({ Sidebar: () => <nav>Sidebar</nav> }));
vi.mock('../Header', () => ({ Header: () => <header>Header</header> }));
vi.mock('../TabBar', () => ({ TabBar: () => <div>TabBar</div> }));
vi.mock('@/components/shared/QuickCapture', () => ({ default: () => <div>QuickCapture</div> }));
vi.mock('@/components/planning/PlanningModal', () => ({ default: () => <div>PlanningModal</div> }));
vi.mock('@/components/planning/PlanningBanner', () => ({ default: () => <div>PlanningBanner</div> }));
const planningPrompt = vi.hoisted(() => ({ options: [] }));
vi.mock('@/hooks/usePlanningPrompt', () => ({
  usePlanningPrompt: (options) => {
    planningPrompt.options.push(options);
    return { isActive: true, isLoading: false, showModal: true };
  },
}));

import AppShell from '../AppShell';

afterEach(() => {
  cleanup();
  planningPrompt.options = [];
});

describe('AppShell', () => {
  it('renders the project screen with no navigation or anything naming other work', () => {
    navigation.pathname = '/focus/project/p1';
    render(<AppShell><p>Project screen</p></AppShell>);

    expect(screen.getByText('Project screen')).toBeInTheDocument();
    for (const chrome of ['Sidebar', 'Header', 'TabBar', 'QuickCapture', 'PlanningModal', 'PlanningBanner']) {
      expect(screen.queryByText(chrome)).not.toBeInTheDocument();
    }
    // Not just hidden: the planning check, which loads tasks from every
    // project, does not run there at all.
    expect(planningPrompt.options.length).toBeGreaterThan(0);
    expect(planningPrompt.options.every((options) => options.enabled === false)).toBe(true);
  });

  it('keeps the normal chrome on the projects page', () => {
    navigation.pathname = '/projects';
    render(<AppShell><p>Projects</p></AppShell>);

    expect(screen.getByText('Sidebar')).toBeInTheDocument();
    expect(screen.getByText('Header')).toBeInTheDocument();
    expect(planningPrompt.options.length).toBeGreaterThan(0);
    expect(planningPrompt.options.every((options) => options.enabled === true)).toBe(true);
  });
});
