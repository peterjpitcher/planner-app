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
        *   Toggle to show/hide completed tasks within a project (hidden by default).
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
*   **UI/UX - Project Task Visibility:**
    *   Added a global "Expand All Tasks" / "Collapse All Tasks" button on the `DashboardPage.js`.
    *   This button controls the visibility of task lists for all projects simultaneously.
    *   Individual project task list toggles in `ProjectItem.js` still function independently after a global action.
*   **Error Fixes & Refinements:**
    *   Corrected `AuthContext.js` `useEffect` cleanup for `onAuthStateChange` listener (`authListener.subscription.unsubscribe()`).
    *   Resolved Supabase error "Could not find the 'last_activity_at' column" by removing `last_activity_at` from all update objects in `ProjectItem.js`, relying on `updated_at`.
    *   Fixed React Hook order error in `DashboardPage.js` by moving `filteredProjects` `useMemo` before early returns.
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

### Remaining PRD Features (Next Steps):

*   Identifying and potentially removing unused database fields from the UI (user request).
*   Global search functionality.
*   Advanced/specific filtering capabilities (beyond current dashboard filters).
*   Archive functionality for completed projects.
*   Basic reporting dashboard.
*   Keyboard shortcuts.

This plan will be updated as features are completed and if priorities change.

--- 