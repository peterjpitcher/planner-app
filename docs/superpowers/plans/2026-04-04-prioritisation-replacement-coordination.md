# Prioritisation Replacement — Coordination Plan

## Team

| # | Role | Owns | Must Not Touch |
|---|------|------|----------------|
| 1 | **Product-Technical Lead** | Sequence, decisions, acceptance criteria, dependency control, sign-off | Implementation code directly |
| 2 | **Data Model & Migration** | Phase 1 schema, migration SQL, constraints, triggers, indexes, RPC functions | Service layer, UI |
| 3 | **Backend Domain & Service Layer** | taskService, ideaService, validators, API routes, state transition logic, constants | Migration SQL, UI components |
| 4 | **Frontend Workflow** | /today, /plan, dnd-kit, sections, columns, move/reorder, soft caps, staleness, a11y | Service layer, migration |
| 5 | **Frontend Capture & Ideas** | AppShell, TabBar, QuickCapture, /ideas, idea promotion, task detail drawer, notes | Drag-and-drop mechanics, service layer |
| 6 | **Integration & Legacy Surface** | O365 sync, daily email, completed-report, project survivors, sidebar filters | New views, migration |
| 7 | **QA, Test & Release** | Vitest, critical tests, regression, deployment checklist, smoke tests | Feature code |

## Execution Waves

### Wave 1: Lock Foundations
**Agents:** Lead + Migration + Backend + QA
**Tasks:** 1.1, 1.2, 1.3, 1.4, 1.5
**Goal:** Schema decisions finalised, tests scaffolded, migration written and dry-run verified

**Contract outputs:**
- QA: Vitest installed, test infrastructure ready (Task 1.1)
- Backend: Constants defined, validators updated (Tasks 1.2, 1.3)
- Backend: dateUtils updated (Task 1.4)
- Migration: SQL written and dry-run clean (Task 1.5)

### Wave 2: Build Application Core
**Agents:** Backend + Frontend Workflow + Frontend Capture + QA
**Tasks:** 2.1–2.9 (Backend), 3.1–3.2 (Capture), 3.3 (shared), then 3.4–3.6 (Workflow + Capture parallel)
**Goal:** Services stable, new views built against real API contracts

**Sequencing within Wave 2:**
1. Backend completes service layer + API routes FIRST (2.1–2.9)
2. Frontend Capture builds shell + QuickCapture (3.1, 3.2) — can start as soon as constants are locked
3. Backend publishes API contract examples
4. Both frontend agents build views in parallel (3.4+3.5 Workflow, 3.6 Capture)
5. Shared TaskCard (3.3) built before views that consume it

### Wave 3: Integrate Edges
**Agents:** Integration + QA + (Cleanup if separate)
**Tasks:** 4.1, 4.2, 4.3, 3.7, 3.8, 3.9
**Goal:** O365 sync, email, survivors updated, detail drawer and a11y complete

### Wave 4: Release
**Agents:** Lead + Migration + QA
**Tasks:** 5.1, 5.2, 5.3
**Goal:** Legacy deleted, build clean, migration applied, deployed, smoke tested

## Status Tracker

| Task | Phase | Owner | Status | Notes |
|------|-------|-------|--------|-------|
| 1.1 Vitest setup | 1 | QA | pending | |
| 1.2 Constants | 1 | Backend | pending | |
| 1.3 Validators | 1 | Backend | pending | Depends on 1.2 |
| 1.4 dateUtils | 1 | Backend | pending | |
| 1.5 Migration | 1 | Migration | pending | Depends on 1.2 |
| 2.1 taskService | 2 | Backend | pending | Depends on 1.2, 1.3 |
| 2.2 ideaService | 2 | Backend | pending | Depends on 1.2, 1.3 |
| 2.3 apiClient | 2 | Backend | pending | Depends on 2.1, 2.2 |
| 2.4 Tasks API | 2 | Backend | pending | Depends on 2.1 |
| 2.5 Ideas API | 2 | Backend | pending | Depends on 2.2 |
| 2.6 Areas + sortOrder | 2 | Backend | pending | |
| 2.7 Projects API | 2 | Backend | pending | |
| 2.8 Completed API | 2 | Backend | pending | |
| 2.9 Utility files | 2 | Backend | pending | |
| 3.1 dnd-kit + layout | 2 | Capture | pending | Depends on 1.2 |
| 3.2 QuickCapture | 2 | Capture | pending | Depends on 2.3 |
| 3.3 TaskCard | 2 | Shared | pending | Depends on 1.2, 2.6 |
| 3.4 Today view | 2 | Workflow | pending | Depends on 3.3, 2.4 |
| 3.5 Plan board | 2 | Workflow | pending | Depends on 3.3, 2.4 |
| 3.6 Idea Vault | 2 | Capture | pending | Depends on 2.5 |
| 3.7 Redirects | 3 | Integration | pending | |
| 3.8 Detail drawer | 3 | Capture | pending | |
| 3.9 A11y | 3 | Workflow | pending | Depends on 3.4, 3.5 |
| 4.1 O365 sync | 3 | Integration | pending | Depends on 2.1 |
| 4.2 Daily email | 3 | Integration | pending | Depends on 2.1 |
| 4.3 Survivors | 3 | Integration | pending | |
| 5.1 Delete legacy | 4 | Cleanup | pending | Depends on all above |
| 5.2 Build verify | 4 | QA | pending | Depends on 5.1 |
| 5.3 Deploy | 4 | Lead + Migration + QA | pending | Depends on 5.2 |

## Merge Order

1. test setup + constants + validators + dateUtils
2. migration file (committed but NOT applied)
3. service layer + API routes
4. shared UI shell + QuickCapture + TaskCard
5. Today view
6. Plan view
7. Ideas view + detail drawer
8. integrations + survivors
9. legacy cleanup
10. release prep + migration apply + deploy
