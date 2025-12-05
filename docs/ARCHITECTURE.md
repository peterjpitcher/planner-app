# System Architecture

## Overview
Planner is a Task Management application built with **Next.js 15** (App Router) and **Supabase**. It features a secure, layered architecture where the frontend interacts with the database exclusively through server-side API routes, ensuring Row Level Security (RLS) enforcement.

## Technology Stack
- **Frontend:** Next.js 15, React 19, Tailwind CSS 4.
- **Backend:** Supabase (PostgreSQL).
- **Authentication:** NextAuth.js (integrated with Supabase Auth).
- **State Management:** React Context (`SupabaseContext`, `TargetProjectContext`) + Local State.

## Core Architecture Patterns

### 1. Data Access Layer (`src/lib/apiClient.js`)
- **Pattern:** Singleton API Client.
- **Purpose:** Centralizes all fetch requests to `/api/*` endpoints.
- **Features:**
  - Automatic authentication header injection.
  - Request deduping and caching (`requestCache.js`).
  - Standardized error handling.

### 2. API Routes (`src/app/api/*`)
- **Pattern:** Server-side endpoints acting as a proxy to Supabase.
- **Purpose:** 
  - Validates user session (NextAuth).
  - Executes Supabase queries using the `service_role` key (for admin tasks) or authenticated client (for RLS).
  - **Crucial:** The frontend *never* calls `supabase.from()` directly.

### 3. Database Security
- **Row Level Security (RLS):** Enabled on all tables (`projects`, `tasks`, `notes`).
- **Policies:** Users can only select/insert/update/delete data where `user_id` matches their auth UID.
- **Indexes:** Performance indexes are applied to foreign keys (`project_id`, `user_id`) and sorting fields (`due_date`, `priority`).

### 4. Component Structure
- **`src/components/Projects/ProjectItem.js`:** The core container for a project card. Handles editing, expansion, and orchestrates sub-components.
- **`src/components/Tasks/TaskItem.js`:** Individual task rendering with inline editing and "Chase" functionality.

## Recent Changes (Dec 2025)
- **Outlook Sync Removed:** The legacy bi-directional sync with Microsoft Outlook has been fully decommissioned to simplify the codebase.
- **"Chase" Feature:** Added ability to push task due dates and auto-log notes via `ChaseTaskModal`.
