# Enhancements Requested This Session

This document summarizes the enhancements and new features requested during the current development session.

1.  **Dashboard Filters:**
    *   Add a filter to the dashboard to filter projects by **stakeholder**.
    *   Add a filter for projects with **no subtasks** (displaying a counter).
    *   Add a filter for **overdue projects**.
    *   Add a filter for projects (or their tasks) that have **not been touched recently** (e.g., in the last two weeks).
    *   Ensure filter buttons turn **red if there are any projects** matching that filter's criteria.
    *   Add a filter for any project or task that **doesn't have a due date**.

2.  **Task Item UI (`TaskItem.js`):**
    *   Restore the **priority display** to the task line.
    *   Reduce the perceived **height of the task line**.
    *   Move the **task description next to the task name** (styled in grey italics) to reduce space.

3.  **Project Item UI (`ProjectItem.js`):**
    *   Ensure the project description field background is the **same colour as the card**.
    *   Remove one of the two **"no tasks" warnings**.
    *   Reduce the overall **vertical space** needed for each project card.
    *   Add an **arrow icon to show expandability** of the project's task list.
    *   Collapse project task lists **by default**.

4.  **Dashboard Layout & Display:**
    *   Add a **task list on the right side of the page** showing just tasks, ordered by date then priority. (This was implemented as `StandaloneTaskList.js`).
    *   Group projects on the dashboard by **priority** (High, Medium, Low, Other).

5.  **Modal UI:**
    *   Change the backdrop of "new task" and "new project" modals from a black background to a **blurred background**.

6.  **Error Identification:**
    *   Identify any **unused database fields** in the UI. (This was an analysis request, not an enhancement to build yet).

7.  **New Feature Request (Pending Clarification):**
    *   Add a button that will show **everything that's been done each month**. (Details like button location, definition of "done", and display format are pending).

8.  **Documentation:**
    *   Summarise all enhancements requested in this chat session into a new document (this document). 