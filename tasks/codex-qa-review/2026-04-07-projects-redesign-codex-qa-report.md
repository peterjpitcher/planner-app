# QA Review Report — Projects Page Redesign Spec

**Scope:** `docs/superpowers/specs/2026-04-07-projects-page-redesign-design.md` + existing implementation
**Date:** 2026-04-07
**Mode:** Spec Compliance Review
**Engines:** Claude + Codex (5 specialists)

## Executive Summary

5 specialists reviewed the design spec against the existing codebase. 31 findings total: 4 critical, 8 high, 12 medium, 7 low. All critical and high findings have been integrated into the revised spec. The most significant cross-engine agreements were around pagination limits, notes API contract mismatch, timezone handling, and missing UI states.

## Cross-Engine Agreements (Highest Confidence)

| Finding | Flagged By | Resolution |
|---------|-----------|------------|
| API pagination caps (50 projects, 100 tasks) silently truncate data | Codex (Bug Hunter, Spec Compliance) + Claude (Performance) | Spec now requires fetching all data |
| Notes API contract mismatch (object vs positional args) | Codex (Bug Hunter, Spec Compliance) | Spec now uses correct `getNotes(projectId)` signature |
| Notes race condition on rapid project switching | Codex (Bug Hunter) + Claude (Performance) | Spec now requires AbortController + version check |
| No notes caching despite encouraging rapid switching | Codex (Bug Hunter) + Claude (Performance) | Spec now requires `dedupedFetch` for notes |
| Date comparisons not timezone-safe | Codex (Bug Hunter, Spec Compliance) + Claude (Standards) | Spec now mandates `getStartOfTodayLondon()` |
| Missing loading/error/empty states | Codex (Bug Hunter) + Claude (Standards) | All states enumerated in revised spec |
| Area filter case sensitivity mismatch | Codex (Bug Hunter, Spec Compliance) | Spec now uses case-insensitive comparison |
| Overdue count double-counting risk | Codex (Bug Hunter, Spec Compliance) | Spec now specifies unique project count |
| Hardcoded hex colours violate design tokens | Claude (Standards) | All colours replaced with token references |

## All Findings Integrated

All 31 findings were addressed in the revised spec. Key additions:
- Pagination strategy for full dataset loading
- AbortController for notes race condition
- dedupedFetch caching for notes
- getStartOfTodayLondon() for all date comparisons
- Case-insensitive area filtering derived from projects only
- Unique project counting for overdue metric
- Dashboard filter interaction rules (global counts, table respects area only)
- All empty state combinations enumerated
- Loading and error states per component
- Keyboard navigation and ARIA roles
- Design tokens replacing all hardcoded hex values
- Project deletion in workspace header menu
- Unassigned tasks section retained
- Desktop dashboard link for clearing selection
- Deep link edge cases (invalid, hidden, completed)
- Security notes (IDOR, input validation, note validation)
- Completed project read-only mode
- Attention dot priority order
- AddTaskInput extraction to shared component
- State design using selectedProjectId (not object copy)
- Task project reassignment regrouping
- Optimistic mutation revert via toast (not loadData)
- useMemo for filter derivation and attention counts

## Source Reports

- `2026-04-07-projects-redesign-spec-compliance-auditor-report.md`
- `2026-04-07-projects-redesign-bug-hunter-report.md`
- `2026-04-07-projects-redesign-security-auditor-report.md`
- `2026-04-07-projects-redesign-performance-analyst-report.md`
- `2026-04-07-projects-redesign-standards-enforcer-report.md`
