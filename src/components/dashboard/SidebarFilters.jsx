'use client';

import { EyeIcon, EyeSlashIcon, ArrowsPointingInIcon, ArrowsPointingOutIcon, CalendarDaysIcon, ClockIcon, ExclamationTriangleIcon, InboxIcon } from '@heroicons/react/24/outline';
import { Switch } from '@headlessui/react';

const filterOrder = ['overdue', 'noTasks', 'untouched', 'noDueDate'];

const filterMeta = {
  overdue: {
    label: 'Overdue work',
    description: 'Projects past their due date and still open.',
    icon: ExclamationTriangleIcon,
  },
  noTasks: {
    label: 'Projects without tasks',
    description: 'Projects needing next steps.',
    icon: InboxIcon,
  },
  untouched: {
    label: 'Inactives (14d)',
    description: 'No updates in the last two weeks.',
    icon: ClockIcon,
  },
  noDueDate: {
    label: 'Missing due date',
    description: 'Projects or tasks with no deadline.',
    icon: CalendarDaysIcon,
  },
};

function ToggleRow({ label, helper, icon: Icon, enabled, onChange }) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-[#0496c7]/20 bg-white/85 px-4 py-3 transition shadow-sm shadow-[#0496c7]/10">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0496c7]/15 text-[#036586]">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-[#052a3b]">{label}</p>
          {helper && <p className="text-xs text-[#2f617a]/80">{helper}</p>}
        </div>
      </div>
      <Switch
        checked={enabled}
        onChange={onChange}
        className={`relative inline-flex h-7 w-14 shrink-0 items-center rounded-full border border-[#0496c7]/30 transition ${enabled ? 'bg-[#0496c7]' : 'bg-white'}`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition ${enabled ? 'translate-x-7' : 'translate-x-1'}`}
        />
      </Switch>
    </div>
  );
}

function FilterCard({ id, isActive, count, onToggle }) {
  const meta = filterMeta[id];
  if (!meta) return null;
  const Icon = meta.icon;
  return (
    <button
      type="button"
      onClick={() => onToggle(id)}
      className={`group relative overflow-hidden rounded-2xl border px-4 py-4 text-left transition ${
        isActive ? 'border-[#0496c7] bg-[#0496c7]/12 shadow-[0_18px_40px_-28px_rgba(4,150,199,0.45)]' : 'border-[#0496c7]/15 bg-white/85 hover:border-[#0496c7]/35 hover:bg-white'
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className={`flex h-10 w-10 items-center justify-center rounded-xl transition ${isActive ? 'bg-[#0496c7]/20 text-[#036586]' : 'bg-[#0496c7]/12 text-[#2f617a]/80'}`}>
            <Icon className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-semibold tracking-tight text-[#052a3b]">{meta.label}</p>
            <p className="mt-1 text-xs text-[#2f617a]/80">{meta.description}</p>
          </div>
        </div>
        <span
          className={`flex h-8 min-w-[2.5rem] items-center justify-center rounded-full border text-xs font-semibold transition ${
            isActive ? 'border-[#0496c7] bg-[#0496c7]/15 text-[#036586]' : 'border-[#0496c7]/15 bg-white text-[#2f617a]/80'
          }`}
        >
          {count}
        </span>
      </div>
      <span
        className={`absolute inset-0 -z-10 bg-gradient-to-r from-[#0496c7]/18 via-[#5bd2c1]/12 to-transparent opacity-0 transition-all duration-300 ${isActive ? 'opacity-100' : 'group-hover:opacity-100'}`}
      />
    </button>
  );
}

export default function SidebarFilters({
  uniqueStakeholders,
  selectedStakeholder,
  onStakeholderChange,
  showCompletedProjects,
  onToggleCompleted,
  areAllTasksExpanded,
  onToggleExpandTasks,
  hideBillStakeholder,
  onToggleHideBill,
  activeDashboardFilters,
  onToggleDashboardFilter,
  projectAnalysis,
}) {
  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-[#036586]/80">Stakeholders</p>
        <h2 className="mt-2 text-lg font-semibold text-[#052a3b]">Filter pipeline</h2>
        <p className="mt-3 text-sm text-[#2f617a]/80">
          Narrow down projects by accountability partner. Stakeholder tags can be combined with focus filters.
        </p>
        <div className="mt-4">
          <label htmlFor="stakeholder-filter" className="sr-only">Stakeholder filter</label>
          <div className="relative">
            <select
              id="stakeholder-filter"
              name="stakeholder-filter"
              value={selectedStakeholder}
              onChange={onStakeholderChange}
              className="block w-full appearance-none rounded-2xl border border-white/15 bg-slate-900/50 px-4 pr-12 py-3 text-sm text-white shadow-inner outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/40"
            >
              <option value="All Stakeholders">All stakeholders</option>
              {uniqueStakeholders.map((stakeholder) => (
                <option key={stakeholder} value={stakeholder}>
                  {stakeholder}
                </option>
              ))}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-[#2f617a]/70">
              <svg width="10" height="6" viewBox="0 0 10 6" aria-hidden="true">
                <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <p className="text-xs uppercase tracking-[0.2em] text-[#036586]/80">Workspace</p>
        <h2 className="text-lg font-semibold text-[#052a3b]">Display controls</h2>
        <div className="mt-3 space-y-3">
          <ToggleRow
            label={showCompletedProjects ? 'Hiding completed projects' : 'Showing completed projects'}
            helper={showCompletedProjects ? 'Completed and cancelled projects are visible.' : 'Completed and cancelled projects are hidden.'}
            icon={showCompletedProjects ? EyeIcon : EyeSlashIcon}
            enabled={showCompletedProjects}
            onChange={onToggleCompleted}
          />
          <ToggleRow
            label={areAllTasksExpanded ? 'Collapse task groups' : 'Expand all task groups'}
            helper="Toggles every project’s task list."
            icon={areAllTasksExpanded ? ArrowsPointingInIcon : ArrowsPointingOutIcon}
            enabled={areAllTasksExpanded}
            onChange={onToggleExpandTasks}
          />
          <ToggleRow
            label={hideBillStakeholder ? 'Bill hidden from view' : 'Hide Bill tagged work'}
            helper="Use this to focus on non-Bill initiatives."
            icon={hideBillStakeholder ? EyeSlashIcon : EyeIcon}
            enabled={hideBillStakeholder}
            onChange={onToggleHideBill}
          />
        </div>
      </div>

      <div className="space-y-4">
        <p className="text-xs uppercase tracking-[0.2em] text-[#036586]/80">Focus</p>
        <h2 className="text-lg font-semibold text-[#052a3b]">Priority filters</h2>
        <p className="text-sm text-[#2f617a]/80">Highlight critical projects. Counts update in real time.</p>
        <div className="mt-4 space-y-3">
          {filterOrder.map((filterKey) => {
            const ids = projectAnalysis[filterKey] || [];
            return (
              <FilterCard
                key={filterKey}
                id={filterKey}
                count={ids.length}
                isActive={Boolean(activeDashboardFilters[filterKey])}
                onToggle={onToggleDashboardFilter}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
