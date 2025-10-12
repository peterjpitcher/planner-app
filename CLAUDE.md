# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development
- `npm run dev` - Start the Next.js development server on port 3000
- `npm run build` - Build the application for production
- `npm run start` - Start the production server
- `npm run lint` - Run ESLint to check code quality

### Installation
- `npm install` - Install all dependencies

## Architecture Overview

This is a Next.js 15.3.2 application using the App Router pattern for a project and task management system.

### Technology Stack
- **Framework**: Next.js 15.3.2 with App Router
- **Frontend**: React 19.0.0
- **Authentication**: NextAuth.js v5 with Supabase credential provider
- **Database**: Supabase (PostgreSQL backend)
- **Styling**: Tailwind CSS v4 with PostCSS
- **UI Components**: Headless UI, Heroicons
- **Date Handling**: date-fns for formatting and calculations

### Project Structure
- `/src/app/` - Next.js App Router pages and API routes
  - `/api/auth/[...nextauth]/` - NextAuth.js authentication endpoint
  - `/dashboard/` - Main dashboard (responsive layout)
  - `/completed-report/` - Reporting interface for completed items
  - `/login/` - Authentication page
- `/src/components/` - React components organized by feature
  - `/Auth/` - Authentication components
  - `/Projects/` - Project management components
  - `/Tasks/` - Task management components
  - `/Notes/` - Note-taking components
- `/src/contexts/` - React contexts (TargetProjectContext for project selection)
- `/src/lib/` - Utilities and clients
  - `supabaseClient.js` - Supabase database client
  - `dateUtils.js` - Date formatting utilities

### Key Features
1. **Project Management**: 
   - Priority levels (High/Medium/Low) with color-coded borders
   - Due dates with visual indicators (red for today/overdue, amber for tomorrow)
   - Stakeholder tracking and filtering
   - Project completion modal with task verification
   - Status options: Open, In Progress, On Hold, Completed, Cancelled

2. **Task Management**: 
   - Tasks linked to projects with in-line editing
   - Collapsible task sections per project
   - Global expand/collapse functionality
   - Task completion tracking with timestamps

3. **Notes System**: 
   - Timestamped notes for both projects and tasks
   - Expandable/collapsible UI
   - Creation timestamps displayed

4. **Responsive Dashboard**:
   - Unified `/dashboard` experience adapts from mobile to desktop
   - Sidebar filters and task panel stack naturally on small screens
   - Touch-friendly controls maintained across viewports

5. **Reporting & Filtering**:
   - Completed items report with date range filtering
   - CSV export functionality
   - Dashboard filters: stakeholder, overdue, projects without tasks
   - Monthly completion reports

### Authentication Flow
- Uses NextAuth.js with Supabase as the credential provider
- JWT session strategy with 30-day expiration
- Session refresh every 24 hours
- Secure session cookies in production (HttpOnly, SameSite=lax)
- Login page at `/login`
- Protected routes require active session

### Database Schema (Supabase)
Key tables include:
- `users` - User accounts with email/password authentication
- `projects` - Project records with:
  - `name`, `dueDate`, `priority` (High/Medium/Low)
  - `status`, `stakeholders[]`, `user_id`
  - `created_at`, `updated_at`, `completed_at`
- `tasks` - Tasks with:
  - `name`, `projectId` (foreign key), `dueDate`
  - `status`, `priority`, `user_id`
  - `created_at`, `updated_at`, `completed_at`
- `notes` - Notes with:
  - `content`, `projectId`, `taskId`
  - `user_id`, `created_at`

### Environment Requirements
Required environment variables:
- `NEXT_PUBLIC_SUPABASE_URL` - Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Supabase anonymous key
- `NEXTAUTH_SECRET` - Secret for JWT encryption
- `NEXTAUTH_URL` - Application URL for callbacks

### UI/UX Patterns
- **In-line Editing**: Direct field editing without modals
- **Priority Styling**: 
  - High: Red border and text
  - Medium: Yellow/amber border and text
  - Low: Green border and text
- **Due Date Indicators**: Visual cues for urgency
- **Optimistic Updates**: Immediate UI updates before database confirmation
- **Modal Backdrops**: Blurred background for better focus

### Development Patterns
- Heavy use of client components (`'use client'`)
- Direct Supabase queries in components
- Try-catch error handling with user feedback
- Real-time state updates after database operations
- Component-level state management
- Responsive design with mobile-first approach
