# OJ Planner — iPhone App Design Spec

**Date:** 2026-03-10
**Status:** Approved

---

## Overview

A full-featured iPhone companion app for OJ Planner 2.0 that mirrors the functionality of the web app at `https://planner.orangejelly.co.uk`. Built with **React Native (Expo)** so the Xcode project can be opened and deployed directly to an iPhone.

---

## Technology Choices

| Concern | Decision | Rationale |
|---|---|---|
| Framework | React Native (Expo) | Same language (TypeScript/JS) as the web app; can reuse API client and types; Expo generates a standard Xcode project |
| Authentication | Email + password via NextAuth.js | POST to `https://planner.orangejelly.co.uk/api/auth/callback/credentials`; session token stored securely in Expo SecureStore |
| API | Existing REST endpoints | No backend changes needed; all data via `https://planner.orangejelly.co.uk/api/*` |
| State | React Context + local useState | Mirrors the web app pattern; no Redux/Zustand needed |
| Storage | Expo SecureStore | For session token; no sensitive data cached locally |

---

## Navigation Structure

Bottom tab bar with 5 positions. The centre position uses a raised FAB (floating action button) for Capture.

```
[ Dashboard ] [ Prioritise ] [ + Capture ] [ Journal ] [ More ]
```

- **Dashboard** — project list with metrics bar, drill into project detail
- **Prioritise** — urgency/importance matrix view
- **Capture (FAB)** — slides up a bottom sheet for quick task creation
- **Journal** — entries list, new entry, AI summary
- **More** — Completed Report, Settings, Office 365 Sync status

---

## Screens

### 1. Login
- App logo + "OJ Planner"
- Email field
- Password field
- Sign In button (calls NextAuth credentials endpoint)
- "Forgot password?" link (opens web browser to reset page)
- Session token persisted to Expo SecureStore on success

### 2. Dashboard
- **Metrics bar** — Active projects / Needs attention / Due soon (tapping each filters the list)
- **Project list** — cards showing name, task count, due date, priority; colour-coded border (red = today/overdue, amber = tomorrow, purple = normal)
- **Search bar** — filters across project names, stakeholders, notes
- **Filter chips** — Stakeholder and Job filters (matching web app sidebar filters)
- Tap a project card → Project Detail screen (pushed onto nav stack)

### 3. Project Detail
- Header: project name, status badge, due date, priority
- Task list with tap-to-complete checkboxes
- Add task inline (text field at bottom of task list)
- Notes section below tasks
- Add note button
- Edit / Delete project via ⋯ menu

### 4. Capture Sheet (FAB)
- Slides up as a bottom sheet over the current screen
- Fields: task name (auto-focused), project picker, due date picker, priority selector (High/Medium/Low)
- Save Task button → calls POST `/api/tasks`, dismisses sheet
- Dismiss by tapping ✕ or swiping down

### 5. Prioritise
- List of incomplete tasks sorted by urgency + importance score
- Displays urgency bar and importance bar per task
- Tap a task to view/edit it
- Mirrors the `/prioritise` web page

### 6. Journal
- List of recent journal entries (date + excerpt)
- "+ New Entry" button → full-screen text editor
- "✨ Generate Summary" button → calls POST `/api/journal/summary`; shows result in a modal
- Summary period picker: Weekly / Monthly / Annual / Custom

### 7. More (tab)
- **Completed Report** — date range picker + list of completed projects/tasks
- **Settings** — user preferences (mirrors web `/settings`)
- **Office 365** — sync toggle + last synced timestamp + manual sync button
- **Sign Out** — clears SecureStore token and returns to Login

---

## Authentication Flow

1. User enters email + password on Login screen
2. App POSTs to `https://planner.orangejelly.co.uk/api/auth/callback/credentials` with `{email, password, csrfToken}`
3. On success, the session cookie / token is extracted and stored in Expo SecureStore
4. All subsequent API requests include the session token as a cookie header
5. On 401 from any API call → clear token and redirect to Login

> **Note:** NextAuth returns a session cookie. The app will need to capture and replay this cookie on every request, matching the behaviour of the web browser client.

---

## API Integration

All endpoints are called against `https://planner.orangejelly.co.uk`. The existing `apiClient.js` logic (request deduplication, cache invalidation) will be replicated in a mobile-specific `apiClient.ts`.

| Screen | Endpoints used |
|---|---|
| Dashboard | `GET /api/projects`, `POST /api/tasks/batch` |
| Project Detail | `GET /api/tasks?projectId=`, `GET /api/notes?projectId=`, `PATCH /api/projects/[id]`, `DELETE /api/projects/[id]` |
| Capture | `POST /api/tasks` |
| Prioritise | `GET /api/tasks` |
| Journal | `GET /api/journal/entries`, `POST /api/journal/entries`, `POST /api/journal/summary` |
| More → Completed | `GET /api/completed-items` |
| More → Settings | `GET/PATCH` settings endpoints |

---

## Visual Design

- **Dark theme** — matches the web app (`#0f0f1a` background, `#7c6af7` purple accent)
- **Typography** — system font (SF Pro on iOS)
- **Colour coding** — red for overdue/today, amber for tomorrow, purple for normal, green for completed
- **Priority badges** — HIGH / MEDIUM / LOW inline tags matching web app style

---

## Out of Scope (first release)

- Push notifications
- Widgets / Siri shortcuts
- Offline mode / local caching
- In-app password reset (opens browser instead)
- Microsoft OAuth flow in-app (Settings shows sync status only)

---

## Project Structure

```
oj-planner-app/          ← separate directory alongside OJ-Planner2.0
├── app/
│   ├── (auth)/
│   │   └── login.tsx
│   ├── (tabs)/
│   │   ├── index.tsx          ← Dashboard
│   │   ├── prioritise.tsx
│   │   ├── journal.tsx
│   │   └── more.tsx
│   └── project/[id].tsx       ← Project Detail
├── components/
│   ├── CaptureSheet.tsx
│   ├── ProjectCard.tsx
│   ├── TaskItem.tsx
│   ├── MetricsBar.tsx
│   └── JournalEntry.tsx
├── lib/
│   ├── apiClient.ts
│   ├── auth.ts                ← SecureStore session management
│   └── types.ts               ← shared with web app
├── constants/
│   └── config.ts              ← BASE_URL = 'https://planner.orangejelly.co.uk'
├── app.json
├── package.json
└── tsconfig.json
```

---

## Assumptions

1. The production site at `planner.orangejelly.co.uk` is consistently available (app has no offline fallback)
2. NextAuth session cookies can be captured and replayed from a native HTTP client
3. The existing API endpoints return the same shape used by the web app (no mobile-specific endpoints needed)
4. The Office 365 OAuth flow will continue to be handled via the web app (not re-implemented natively)
