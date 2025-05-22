# Project Documentation

This document tracks the decisions made and the reasoning behind them during the development of the Simple Productivity Tool.

## Session 1: Initial Requirements Gathering and PRD

**Date:** $(date +%Y-%m-%d) <!-- Replace with actual date -->

### Decisions Made:

1.  **Core Functionality:** The application will be a productivity tool focusing on two main entities: Projects and Tasks. Projects have a one-to-many relationship with Tasks.
2.  **Key Features Defined:**
    *   **Projects:** Due date, priority (High, Medium, Low - sortable), stakeholders (array of names for filtering/searching).
    *   **Tasks:** Due date, task name.
    *   **In-line Editing:** For quick addition and modification of projects and tasks.
    *   **Project Completion Flow:** When a project is marked complete, a modal will prompt the user to confirm completion of all associated open tasks. If not all tasks are confirmed complete, the project remains open.
    *   **UI for Hierarchy:** Projects will have collapsible sections for their tasks, expanded by default.
    *   **Adding Items:** An "Add Project" button will be used. Task addition will be within the context of a project.
    *   **Details Sections:** Both projects and tasks will have a dedicated details section.
3.  **Technology Stack & Infrastructure:**
    *   **Database & Auth:** Supabase.
    *   **Frontend Framework:** Next.js.
    *   **Styling:** Tailwind CSS (recommended).
    *   **Deployment:** Vercel.
    *   **Version Control:** GitHub.
4.  **Documentation:**
    *   A `PRODUCT_REQUIREMENTS.md` file will store the detailed PRD.
    *   This `DOCUMENTATION.md` file will track ongoing decisions.

### Reasoning:

*   The choices for features were based directly on the user's initial request and subsequent clarifications, aiming for a minimal viable product (MVP) that addresses the core needs.
*   Supabase was chosen for its integrated database and authentication capabilities, simplifying backend setup for a Next.js application.
*   Next.js and Tailwind CSS are a common and powerful combination for building modern web applications, aligning with the desire for a good UI/UX and efficient development.
*   Vercel is a natural fit for deploying Next.js applications.
*   Maintaining a PRD and a decision log helps ensure clarity, alignment, and provides a reference for future development or handover.

### Product Requirements Document (PRD)

(The content of `PRODUCT_REQUIREMENTS.md` is maintained in that separate file but is considered part of this initial documentation set.)

## Session 2: Refining PRD and Future Enhancements

**Date:** $(date +%Y-%m-%d) <!-- Replace with actual date -->

### Decisions Made:

1.  **PRD Updates:** Incorporated several new features and clarifications into `PRODUCT_REQUIREMENTS.md` based on user feedback:
    *   Timestamped notes for projects and tasks.
    *   Specific sorting orders for projects and tasks.
    *   "Copy Project Data" button.
    *   Dedicated "Add Task" button per project.
    *   Visual cues for due dates (countdowns, overdue, almost due).
    *   Enhanced task completion (quick mark, hide completed, show/hide toggle).
    *   Mobile responsiveness requirement.
    *   Options for priority styling were added for user selection.
2.  **Future Enhancements Identified:** The following features were discussed and approved by the user for consideration in future development phases (and added to PRD section 7):
    *   Global search functionality.
    *   Advanced/specific filtering capabilities (e.g., by stakeholder).
    *   Archive functionality for completed projects.
    *   Basic reporting dashboard.
    *   Keyboard shortcuts.

### Reasoning:

*   The PRD was refined to more accurately capture the user's evolving vision for the tool, adding more granular details for a better development starting point.
*   Identifying and documenting potential future enhancements helps in long-term planning and ensures these ideas are not lost, even if they are out of scope for the initial build.

### Pending Clarifications for Initial Build:
*   Notes implementation details (display and addition method).
*   Precise definition of "almost due".
*   Format for "Copy Project Data" output.
*   User preference for priority styling.
*   Access method for project/task details sections.

### Resolved Clarifications (as of $(date +%Y-%m-%d)):

1.  **Notes Implementation:** Notes will be managed in an expandable section (toggled by an icon/label like "Notes"). An "Add Note" button within this section will reveal an input field for new, timestamped notes.
2.  **Due Date Visuals:**
    *   Items due "tomorrow" will receive an amber/yellow visual warning.
    *   Items due "today" or past due will receive a red visual warning.
3.  **"Copy Project Data" Format:** Data will be copied as plain text.
4.  **Priority Styling:** The selected approach is colour-coded borders or subtle background accents (e.g., High - red, Medium - orange/yellow, Low - green/blue).
5.  **Project/Task Details Section Access:** An icon will toggle an expandable section for a primary, editable description field for both projects and tasks. This is distinct from the chronological, timestamped notes section.

--- 

## Implementation Plan & Progress

This section tracks the features implemented and the planned next steps based on the PRD.

### Completed Features (as of Current Date):

*   **Project Setup & Core Technology:**
    *   Next.js project (`planner-app`) initialized (JavaScript, ESLint, Tailwind CSS, `src/` dir, App Router, `@/*` alias).
    *   Supabase client library (`@supabase/supabase-js`) installed and configured (`.env.local`, `src/lib/supabaseClient.js`).
*   **Database Schema (Supabase):**
    *   Tables for `projects`, `tasks`, and `notes` created with appropriate columns, relationships (foreign keys, `ON DELETE CASCADE`), constraints (`CHECK` for priority/status), and `updated_at` triggers.
    *   Row Level Security (RLS) enabled and basic policies for authenticated users applied.
*   **Authentication:**
    *   User login and logout functionality implemented.
    *   `AuthContext` for managing user session state.
    *   Protected dashboard page, redirecting to login if not authenticated.
*   **Dashboard & Project Management:**
    *   Dashboard page (`/dashboard`) as the main interface.
    *   **Project Listing:** Projects fetched and displayed for the logged-in user.
    *   **Project Creation:** Inline `AddProjectForm` on the dashboard (replaced modal).
    *   **Project Display:**
        *   Compact, single-line display for each project.
        *   Priority styling (left border colour and background accent based on High, Medium, Low).
        *   Due date status visuals (e.g., "Due Today", "Overdue", "Due Tomorrow", countdown) using `date-fns`.
*   **Task Management (within Projects):**
    *   **Task Listing:** Tasks fetched and displayed under their respective projects.
    *   Task section is collapsible (expanded by default).
    *   **Task Creation:** "Add Task" button within each project opens `AddTaskModal`.
    *   **Task Display:**
        *   Priority styling (left border colour and background accent).
        *   Due date status visuals.
    *   **Task Completion:**
        *   Checkbox to mark tasks as complete/incomplete.
        *   Visual distinction for completed tasks (strikethrough, reduced opacity).
        *   Database update for `is_completed` and `completed_at` fields.
        *   Toggle to show/hide completed tasks within a project (`ProjectItem.js`) now correctly hides completed tasks by default. The `TaskList.js` component was updated to filter tasks based on the `showCompletedTasks` prop. The prop name passed from `ProjectItem.js` to `TaskList.js` was corrected from `showCompleted` to `showCompletedTasks` to ensure functionality.
        *   Optimistic updates for a responsive UI when changing task completion status.
*   **UI Enhancements:**
    *   Dashboard layout changed to two columns (projects list on left, add project form on right).
    *   Dashboard content uses full window width (removed max-width constraint).
*   **Project & Task Details Viewing:**
    *   Expandable section in `ProjectItem` (within the main collapsible task area) to show `project.details`, `project.description`, and `stakeholders`.
    *   Expandable section in `TaskItem` to show `task.details` and full task `description`.
    *   Toggled by an `InformationCircleIcon` for both.
*   **Timestamped Notes:**
    *   Users can add and view timestamped notes for both projects and tasks.
    *   Notes are displayed in an expandable section, toggled by a `ChatBubbleLeftEllipsisIcon`, within `ProjectItem` and `TaskItem`.
    *   `AddNoteForm` and `NoteList` components are used for adding and displaying notes.
    *   Project-specific notes are fetched where `task_id` is null.
    *   Task-specific notes are fetched by `task_id`.
    *   Optimistic UI updates implemented for adding notes.
*   **Copy Project Data Button:**
    *   A "Copy" button (`ClipboardDocumentIcon`) in `ProjectItem.js` allows users to copy project details, project notes, all associated tasks (including their details), and notes for each task.
    *   Task-specific notes are fetched on-demand when the copy button is clicked.
    *   Data is formatted as plain text and copied to the clipboard, with visual feedback provided.
    *   The project's current status is included in the copied text.
    *   Database IDs (project ID, task IDs, note IDs) are now excluded from the copied text.
*   **Project Completion & Status Management:**
    *   Projects have a `status` field (e.g., 'Open', 'In Progress', 'On Hold', 'Completed', 'Cancelled') managed via a dropdown menu (`EllipsisVerticalIcon`) in `ProjectItem.js`.
    *   The current project status is visually displayed.
    *   If a project is set to 'Completed':
        *   If there are open tasks, a `ProjectCompletionModal` appears, asking the user to confirm if all open tasks should also be marked as completed.
        *   If confirmed, all open tasks associated with the project have their `is_completed` flag set to `true` and `completed_at` timestamped in the database.
        *   The project's status is then updated to 'Completed' in the database.
        *   Optimistic UI updates are in place, with status updates confirmed against the database.
    *   The dashboard refreshes its project list (`onProjectDataChange`) after project status changes, task additions/updates, and note additions to ensure data consistency.
*   **Dashboard Filtering:**
    *   Completed projects (status 'Completed') are hidden by default on the main dashboard view.
    *   A toggle button (using `EyeIcon`/`EyeSlashIcon`) allows users to show or hide these completed projects.
*   **Database Schema (Tasks):**
    *   The `status` column was removed from the `tasks` table as it was redundant with the `is_completed` boolean field. Task creation logic in `AddTaskForm.js` was updated to no longer reference this column.
*   **In-line Editing:**
    *   Project names in `ProjectItem.js` can be edited in-line.
    *   Project descriptions (`project.description`) in `ProjectItem.js` are editable in-line.
    *   Project Due Date, Priority, and Stakeholders are editable in-line in `ProjectItem.js` (using date input, select, and text input respectively).
    *   The "Details" section and its in-line editing have been removed from `ProjectItem.js`.
    *   Task names in `TaskItem.js` can be edited in-line.
    *   Task descriptions (`task.description`) in `TaskItem.js` are editable in-line. The `InformationCircleIcon` was removed; editing is triggered by clicking the description text. The description is now displayed more compactly next to the task name.
    *   Task Due Dates are editable in-line in `TaskItem.js` using a date input.
    *   Task Priorities in `TaskItem.js` can be edited in-line using a select dropdown.
    *   The quick date-pick buttons (e.g., "Tomorrow", "+2 days") associated with the task due date input in `TaskItem.js` have been removed as they were not functioning correctly and per user request.
*   **UI Enhancements & Layout:**
    *   `AddProjectForm` moved into `AddProjectModal`. Dashboard has a "New Project" button in the header.
    *   Project list on dashboard takes full width when `AddProjectForm` is not shown.
    *   Project item (`ProjectItem.js`) layout made more compact: stakeholders moved to the project name line, paddings reduced.
    *   Task item (`TaskItem.js`) layout made more compact: description moved next to task name, priority display re-added, overall height reduced.
    *   Modal backdrops for `AddProjectModal`, `AddTaskModal`, and `ProjectCompletionModal` now use a lighter, blurred effect (`bg-gray-900 bg-opacity-10 backdrop-blur-sm`).
    *   Project description background in `ProjectItem.js` now inherits from the card (no explicit white/light grey bg).
    *   Duplicate "no tasks" message in `ProjectItem.js` addressed by conditional rendering of `TaskList` or a single message.
*   **Dashboard Filtering & Display:**
    *   Filter projects by Stakeholder using a dropdown.
    *   Filter buttons for "Overdue" projects, projects with "No Tasks", and projects "Untouched" for 2 weeks (project or its tasks).
    *   Filter button for projects or their tasks with "No Due Date".
    *   Filter buttons show counts and turn red if matching projects exist.
    *   A `StandaloneTaskList` component added to the right sidebar on the dashboard, showing all non-completed user tasks.
    *   Tasks in `StandaloneTaskList` are grouped by "Overdue", "Today", "This Week", "Later", and "No Due Date", each with a group header.
    *   Fixed an issue where completed tasks were incorrectly appearing in the "Overdue" (and other active) sections of the `StandaloneTaskList`. The task grouping logic now explicitly excludes tasks marked as `is_completed`.
*   **UI/UX - Project Task Visibility:**
    *   Added a global "Expand All Tasks" / "Collapse All Tasks" button on the `DashboardPage.js`.
    *   This button controls the visibility of task lists for all projects simultaneously.
    *   Individual project task list toggles in `ProjectItem.js` still function independently after a global action.
*   **Error Fixes & Refinements:**
    *   Corrected `AuthContext.js` `useEffect` cleanup for `onAuthStateChange` listener (`authListener.subscription.unsubscribe()`).
    *   Resolved Supabase error "Could not find the 'last_activity_at' column" by removing `last_activity_at` from all update objects in `ProjectItem.js`, relying on `updated_at`.
    *   Fixed React Hook order error in `DashboardPage.js` by moving `filteredProjects` `useMemo` before early returns.
    *   Fixed issue where in-line editing of project priority in `ProjectItem.js` was not saving. The `createUpdateHandler` was updated to correctly use the passed value when invoked directly.
    *   Fixed "Converting circular structure to JSON" error when updating task due dates using quick-pick buttons in `TaskItem.js`. This was caused by the `onBlur` event on the date input field incorrectly passing the event object to the update handler. The fix involved wrapping the `handleDueDateUpdate` call in an arrow function: `onBlur={() => handleDueDateUpdate()}`.
    *   Improved stability of task inline editing in `TaskItem.js` for due dates set by quick-pick buttons by refactoring the main `useEffect` to conditionally update local state from props based on editing mode flags.
*   **Mobile Responsiveness (Phase 1):**
    *   `ProjectItem.js`:
        *   Stakeholder display adjusted for `xs` screens: Shows full name for 1, names for 2, or "Name +N more" for >2. Full list on `sm+`.
        *   "Updated X ago" text hidden on `xs` screens.
    *   `TaskItem.js`:
        *   "Updated X ago" text hidden on `xs` screens. Description truncation reviewed.
    *   `StandaloneTaskList.js` (within its internal `StandaloneTaskItem`):
        *   "Updated X ago" text added and hidden on `xs` screens.
        *   Layout refactored for a more compact, two-line display with improved truncation and element positioning.
*   **Bug Fixes:**
    *   Fixed issue where in-line editing of project priority in `ProjectItem.js` was not saving. The `createUpdateHandler` was updated to correctly use the passed value when invoked directly.
    *   Fixed "Converting circular structure to JSON" error when updating task due dates using quick-pick buttons in `TaskItem.js`. This was caused by the `onBlur` event on the date input field incorrectly passing the event object to the update handler. The fix involved wrapping the `handleDueDateUpdate` call in an arrow function: `onBlur={() => handleDueDateUpdate()}`.
    *   (Duplicate of the above, consolidated into Error Fixes & Refinements) Improved stability of task inline editing in `TaskItem.js` for due dates set by quick-pick buttons by refactoring the main `useEffect` to conditionally update local state from props based on editing mode flags.

*   **UI Interactivity - Task Panel to Project List Navigation:**
    *   In the "Upcoming Tasks" panel (`StandaloneTaskList.js`), project names are now clickable.
    *   Clicking a project name scrolls the corresponding project in the "Your Projects" list (`ProjectList.js`) into view and applies a temporary visual highlight (ring effect for 1 second).
    *   This is achieved using a new React Context (`TargetProjectContext`) to communicate the `targetProjectId` between the two components.
    *   `ProjectList.js` uses `useEffect` and `refs` to identify and manipulate the target project item, and `scrollIntoView()` for navigation. The scroll/highlight action is now more robust, only triggering for new target projects to prevent unwanted jumps during general data updates (using an `actionedProjectIdRef`).
    *   When the last open task in a project (`ProjectItem.js`) is marked as complete, an alert notifies the user, and the project is then highlighted and scrolled into view, prompting for next actions (add tasks or update project status).
    *   To further prevent unwanted scrolling, `ProjectItem.js` now calls `setTargetProjectId(null)` when the user initiates an inline edit for project name, description, due date, priority, or stakeholders. This clears any active scroll target when the user focuses on editing.

*   **Performance & UI Stability - Optimistic Updates:**
    *   Refactored data handling in `DashboardPage.js` to use optimistic UI updates for most common operations (adding projects, adding/updating tasks, updating project details, deleting projects).
    *   Instead of re-fetching all data from the database after each change (which caused page jumps), `DashboardPage.js` now updates its local state (`projects` and `allUserTasks` arrays) directly.
    *   `handleProjectAdded`, `handleProjectDataChange`, and `handleProjectDeleted` in `DashboardPage.js` now perform these local state manipulations.
    *   `ProjectItem.js` was updated to call the new `onProjectDataChange` prop with specific `itemType` and `changedData` arguments, enabling `DashboardPage.js` to perform the correct granular state update.
    *   This significantly reduces unnecessary re-renders and improves UI responsiveness, resolving the issue where the page would jump when data was modified.
    *   Full data re-fetches (`fetchData()`) are now reserved for actions that fundamentally change the dataset, like toggling the display of completed projects.
    *   Fixed "Rules of Hooks" error in `DashboardPage.js` by ensuring all hooks are called at the top level before any conditional returns.

*   **Notes Functionality:**
    *   Fixed "Invalid parent type for note" error when adding notes to tasks by ensuring `parentType="task"` prop is correctly passed to `AddNoteForm` from `TaskItem.js`.
    *   Modified `AddNoteForm.js` to use a single-line `<input type="text">` instead of `<textarea>`.
    *   Pressing "Enter" in the note input now submits the note.
    *   Pressing "Escape" in the note input now clears the field.
    *   The visible submit button for notes has been hidden as "Enter" is the primary interaction.
    *   **Note Indicators & UX (Tasks):**
        *   In `TaskItem.js`, after a note is added, the notes section now automatically collapses.
        *   A note count is displayed next to the `ChatBubbleLeftEllipsisIcon` if notes exist for the task.
        *   Notes for a task are fetched on component mount/task change to ensure the count is accurate.
    *   **Note Indicators & UX (Projects - Partially Implemented):**
        *   In `ProjectItem.js`, the logic to collapse the notes section after adding a note has been implemented in `handleProjectNoteAdded`.
        *   Logic to fetch project notes on component mount/project change (for accurate count) has been added.
        *   **Awaiting manual review/correction:** The UI change to move the notes icon and count to the project header (next to expand/collapse tasks and before the kebab menu) was not successfully applied by the automated edit tool. The icon and count are currently incorrectly placed within the kebab menu dropdown.
    *   **Note Styling:**
        *   Individual notes displayed via `NoteItem.js` are now smaller (using `text-[0.7rem]` for content and `text-[0.65rem]` for timestamp).
        *   The background and border have been removed from `NoteItem.js` to allow notes to blend with the parent card's background (e.g. project or task item background).
        *   Padding around the notes section in `TaskItem.js` and `ProjectItem.js` has been slightly reduced to better suit the smaller note items and ensure no conflicting backgrounds are applied.
        *   Vertical padding in `NoteItem.js` (`py-0.5`) and removed inter-note spacing in `NoteList.js` (removed `space-y-1`) to make the list of notes more compact.
        *   The display format for individual notes in `NoteItem.js` is now `Date: Note Content` on a single line (e.g., "MMM d, h:mm a: Your note text here."), achieved by combining them into one paragraph element.

### Remaining PRD Features (Next Steps):

*   Identifying and potentially removing unused database fields from the UI (user request).
*   Global search functionality.
*   Advanced/specific filtering capabilities (beyond current dashboard filters).
*   Archive functionality for completed projects.
*   Basic reporting dashboard.
*   Keyboard shortcuts.

This plan will be updated as features are completed and if priorities change.

--- 

## Reporting & Analysis

### Completed Items Report Page (`/completed-report`):

*   A new dedicated page has been created to view completed items.
*   Accessible via a "Completed Report" button in the main dashboard header.
*   **Features:**
    *   **View Selection:** Users can switch between "Day", "Week", and "Month" views.
    *   **Date Navigation:** "Previous" and "Next" buttons allow navigation through date ranges based on the selected view. The current date range is displayed.
    *   **Data Fetching:** Fetches completed tasks (with their notes and parent project name), completed projects (with their notes), and all other user notes (with parent task name and project context) from Supabase, filtered by the selected date range. The Supabase query for notes was updated to correctly fetch `tasks(name, project_id(id, name))` to ensure task names are available for notes linked to tasks.
    *   **Unified Chronological Display:** Completed tasks, completed projects, and other notes created within the period are all displayed together in a single chronological list, grouped by date. This replaces the previous separate section for "Other Notes".
    *   **Persistent Project Filter Panel:** A left-hand sidebar lists all unique projects relevant to any item (completed tasks, completed projects, other notes) shown in the current report period. Users can use checkboxes to filter the displayed items by project. "Select All" and "Deselect All" options are provided.
    *   **Item Display:** Items are grouped by date (day, or by day within a week/month depending on view - monthly sub-grouping by week is a TODO). Each item is rendered as a card showing relevant details (name, completion/creation date, description, type indicator, associated notes for tasks/projects). Parent task/project context for notes is now correctly displayed.
    *   **Copy Report:** A "Copy Report" button formats the currently displayed report content (respecting filters) into plain text and copies it to the clipboard. The report text now reflects the unified list of items and correct parent context for notes.
    *   **Styling:** The page uses a two-column layout with a sticky header and sidebar for navigation and filtering.

*   **UI/UX - Project Task Visibility:**
    *   Added a global "Expand All Tasks" / "Collapse All Tasks" button on the `DashboardPage.js`.
    *   This button controls the visibility of task lists for all projects simultaneously.
    *   Individual project task list toggles in `ProjectItem.js` still function independently after a global action.

--- 