# Product Requirements Document: Simple Productivity Tool

## 1. Introduction
A web-based productivity tool designed for managing projects and their associated tasks with a focus on speed and ease of use through in-line editing and a clear hierarchical structure.

## 2. Goals
*   To provide users with a simple and intuitive way to organise their work.
*   To allow for quick capturing and management of projects and tasks.
*   To enable users to prioritise and track deadlines effectively.

## 3. Target Audience
*   Individuals looking for a straightforward personal productivity tool.

## 4. Features

### 4.1 User Authentication
*   Users can sign up and log in to the application.
*   Authentication will be handled by Supabase.

### 4.2 Project Management
*   **4.2.1 Create Project:**
    *   Users can create new projects.
    *   Each project will have:
        *   A unique identifier.
        *   Name (text input).
        *   Due Date (date picker).
        *   Priority (Selectable: High, Medium, Low).
        *   Stakeholders (Array of names, input as a comma-separated list or similar).
*   **4.2.2 View Projects:**
    *   Projects are displayed in a list, sorted first by priority (High > Medium > Low) and then by due date (earliest first).
    *   Each project entry shows its name, due date, priority, and stakeholders.
*   **4.2.3 Edit Project:**
    *   Users can edit project details (name, due date, priority, stakeholders) by clicking on the respective text/fields (in-line editing).
*   **4.2.4 Project Details Section:**
    *   A dedicated expandable section, toggled by an icon, to show and edit more detailed information or a description for the project.
    *   This section will also display all associated sub-tasks, sorted first by priority (High > Medium > Low) and then by due date (earliest first).
*   **4.2.5 Complete Project:**
    *   Users can mark a project as complete.
    *   When a project is marked complete, a modal appears displaying any open tasks associated with that project.
    *   The modal will have tickboxes for each open task.
    *   If the user confirms all displayed tasks are complete, the project status is set to 'completed'.
    *   If the user indicates that not all tasks are complete, the project remains 'open'.
*   **4.2.6 Add Project Button:**
    *   A clearly visible "Add Project" button to initiate the creation of a new project.
*   **4.2.7 Add and View Notes (Project):**
    *   Users can add textual notes to a project within a dedicated expandable section, toggled by an icon or label (e.g., "Notes").
    *   Within this section, an "Add Note" button will allow users to input new notes.
    *   Each note will be automatically timestamped with its creation date and time.
*   **4.2.8 Copy Project Data:**
    *   A button to copy all project details (name, due date, priority, stakeholders, primary description, notes) and all associated task details (name, due date, status, primary description, notes) to the clipboard in a structured, human-readable plain text format.

### 4.3 Task Management
*   **4.3.1 Create Task:**
    *   Users can add tasks to a specific project via a clearly visible "Add Task" button within each project's section.
    *   Each task will have:
        *   A unique identifier.
        *   Task Name (text input).
        *   Due Date (date picker).
        *   Status (e.g., 'open', 'completed').
*   **4.3.2 View Tasks:**
    *   Tasks are displayed within their parent project's collapsible section.
    *   Each task entry shows its name and due date.
*   **4.3.3 Edit Task:**
    *   Users can edit task details (name, due date) by clicking on the respective text/fields (in-line editing).
*   **4.3.4 Task Details Section:**
    *   A dedicated expandable section, toggled by an icon, to show and edit more detailed information or a description for the task.
*   **4.3.5 Task Completion:**
    *   Users can quickly mark tasks as 'completed' (e.g., via a checkbox).
    *   Completed tasks are hidden by default within the project's task list.
    *   A toggle/button within each project allows users to show/hide completed tasks for that project.
*   **4.3.6 Add and View Notes (Task):**
    *   Users can add textual notes to a task within a dedicated expandable section, toggled by an icon or label (e.g., "Notes").
    *   Within this section, an "Add Note" button will allow users to input new notes.
    *   Each note will be automatically timestamped with its creation date and time.

## 5. User Interface (UI) / User Experience (UX)
*   **In-line Editing:** Core project and task fields should be editable directly in place by clicking them.
*   **Collapsible Sections:** Projects will act as accordions/collapsible sections to show/hide their tasks. These will be expanded by default.
*   **Clarity:** The interface should be clean, intuitive, and require minimal clicks for common actions.
*   **Priority Styling:**
    *   Projects and tasks will have distinct visual cues based on their priority using colour-coded borders or subtle background accents (e.g., High priority: red accent; Medium priority: orange/yellow accent; Low priority: green/blue accent).
    *   (User to confirm preferred styling approach).
*   **Due Date Visuals:**
    *   Display a countdown (e.g., "Due in 3 days", "Due tomorrow") for upcoming project and task due dates.
    *   Clearly mark projects and tasks due "today" or that are past due with a red visual cue (e.g., red text, an "Overdue" or "Due Today" badge).
    *   Clearly mark projects and tasks that are due "tomorrow" with an amber/yellow visual cue (e.g., orange/yellow text, an "Due Tomorrow" badge).
*   **Mobile Responsiveness:** The application must be mobile-friendly, with an interface that adapts gracefully to smaller screen sizes for easy viewing, addition, and updating of projects and tasks on mobile devices.

## 6. Non-Functional Requirements
*   **6.1 Data Storage:**
    *   Supabase will be used for the database (PostgreSQL) to store project and task data, and manage user authentication.
*   **6.2 Technology Stack:**
    *   Frontend: Next.js (latest stable version).
    *   Styling: Tailwind CSS for utility-first CSS.
    *   Language: JavaScript (ES6+).
*   **6.3 Deployment:**
    *   Vercel.
*   **6.4 Version Control:**
    *   GitHub.
*   **6.5 Performance:**
    *   The application should be responsive and provide quick feedback for user actions.

## 7. Future Considerations (Out of Scope for Initial Build)
*   Advanced filtering and searching (e.g., by due date ranges across all projects).
*   Notifications or reminders for due dates.
*   Direct task completion outside the project completion flow.
*   User collaboration features.
*   Drag-and-drop reordering of projects or tasks.
*   Global search functionality to find projects or tasks by name, stakeholder, or note content.
*   Specific filtering capabilities (e.g., filter by stakeholder to see all related items).
*   Archive functionality for completed projects (moving them to a separate, accessible view).
*   A basic reporting dashboard (e.g., overview of overdue items, completion rates).
*   Keyboard shortcuts for common actions. 