'use client';

import { EyeIcon, EyeSlashIcon, ArrowsPointingInIcon, ArrowsPointingOutIcon, CalendarDaysIcon, ClockIcon, ExclamationTriangleIcon, InboxIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import { Switch } from '@headlessui/react';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/Card';

const filterOrder = ['overdue', 'noTasks', 'noActiveTasks', 'untouched', 'noDueDate'];

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
  noActiveTasks: {
    label: 'No active tasks',
    description: 'Projects with only completed tasks (or none).',
    icon: CheckCircleIcon,
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
    <div className="flex items-center justify-between rounded-md border border-border bg-card p-2.5 shadow-sm transition-colors hover:bg-muted/30">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-foreground">{label}</p>
          {helper && <p className="text-[11px] leading-tight text-muted-foreground">{helper}</p>}
        </div>
      </div>
      <Switch
        checked={enabled}
        onChange={onChange}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
          enabled ? "bg-primary" : "bg-input"
        )}
      >
        <span
          className={cn(
            "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
            enabled ? "translate-x-4" : "translate-x-0.5"
          )}
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
      title={meta.description}
      className={cn(
        "group relative w-full overflow-hidden rounded-md border p-2.5 text-left transition-all",
        isActive
          ? "border-primary bg-primary/5 shadow-sm"
          : "border-border bg-card hover:bg-muted/50 hover:border-primary/50"
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className={cn(
            "flex h-7 w-7 items-center justify-center rounded-md transition-colors",
            isActive ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary"
          )}>
            <Icon className="h-3.5 w-3.5" />
          </span>
          <div>
            <p className={cn("text-xs font-semibold tracking-tight", isActive ? "text-primary" : "text-foreground")}>
              {meta.label}
            </p>
          </div>
        </div>
        <span
          className={cn(
            "flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1.5 text-[11px] font-semibold transition-colors",
            isActive ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
          )}
        >
          {count}
        </span>
      </div>
    </button>
  );
}

export default function SidebarFilters({
  uniqueJobs,
  selectedJob,
  onJobChange,
  uniqueStakeholders,
  selectedStakeholder,
  onStakeholderChange,
  showCompletedProjects,
  onToggleCompleted,
  areAllTasksExpanded,
  onToggleExpandTasks,
  activeDashboardFilters,
  onToggleDashboardFilter,
  projectAnalysis,
}) {
  return (
    <Card className="border-none shadow-none bg-transparent">
      <div className="space-y-5">
        {/* Jobs Section */}
        <div>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Jobs</p>
          <div className="relative">
            <select
              id="job-filter"
              value={selectedJob}
              onChange={onJobChange}
              className="w-full appearance-none rounded-md border border-input bg-card px-3 py-1.5 text-xs ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-input"
            >
              <option value="All Jobs">All jobs</option>
              <option value="No Job">No job</option>
              {(uniqueJobs || []).map((job) => (
                <option key={job} value={job}>
                  {job}
                </option>
              ))}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground">
              <svg className="h-4 w-4 fill-current" viewBox="0 0 20 20">
                <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
              </svg>
            </div>
          </div>
        </div>

        {/* Stakeholders Section */}
        <div>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Stakeholders</p>
          <div className="relative">
            <select
              id="stakeholder-filter"
              value={selectedStakeholder}
              onChange={onStakeholderChange}
              className="w-full appearance-none rounded-md border border-input bg-card px-3 py-1.5 text-xs ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-input"
            >
              <option value="All Stakeholders">All stakeholders</option>
              {uniqueStakeholders.map((stakeholder) => (
                <option key={stakeholder} value={stakeholder}>
                  {stakeholder}
                </option>
              ))}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground">
              <svg className="h-4 w-4 fill-current" viewBox="0 0 20 20">
                <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
              </svg>
            </div>
          </div>
        </div>

        {/* Workspace Controls */}
        <div>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">View Options</p>
          <div className="space-y-1.5">
            <ToggleRow
              label={showCompletedProjects ? 'Hide completed' : 'Show completed'}
              helper="Toggle visibility of finished work"
              icon={showCompletedProjects ? EyeSlashIcon : EyeIcon}
              enabled={showCompletedProjects}
              onChange={onToggleCompleted}
            />
            <ToggleRow
              label={areAllTasksExpanded ? 'Collapse All' : 'Expand All'}
              helper="Toggle task lists"
              icon={areAllTasksExpanded ? ArrowsPointingInIcon : ArrowsPointingOutIcon}
              enabled={areAllTasksExpanded}
              onChange={onToggleExpandTasks}
            />
          </div>
        </div>

        {/* Priority Filters */}
        <div>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Priority Filters</p>
          <div className="space-y-1.5">
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
    </Card>
  );
}
