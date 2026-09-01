'use client';

/*
 * /today's quick capture box.
 *
 * The implementation now lives in the shared QuickTaskInput, because /projects
 * needs exactly the same date parsing and previously had none: adding a task to
 * a project always landed it due today, and built that date from a machine-local
 * `new Date()` rather than Europe/London.
 *
 * This file stays as the named entry point for /today so TodayView and the
 * existing tests are untouched by the merge.
 */

import QuickTaskInput, { parseQuickTasks } from '@/components/shared/QuickTaskInput';

export { parseQuickTasks };

export default function QuickTaskList() {
  return <QuickTaskInput mode="multi" />;
}
