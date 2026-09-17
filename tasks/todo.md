# Project screen for screen sharing (17 Sep 2026)

Ask: the first note stamp should not need Enter; a full-screen screen for one project with notes, quick task add and files, showing nothing about any other project.

Complexity 4 (about 9 files), so three PRs, each deployable on its own:

- [x] PR A: stamp appears as soon as the empty note box is focused; renewed on the first keystroke so the time is when writing started; a stamp left alone is cleared on blur.
- [x] PR B: `GET /api/projects/[id]` (session plus user_id ownership, 404 otherwise) and `apiClient.getProject`, so the screen loads one project and never the full list.
- [x] PR C: `/focus/project/[id]` with no app shell (no sidebar, header, tab bar, quick capture or planning prompt). Notes (large composer), quick task add, task list without the project link, files. No link anywhere into the rest of the app; Close closes the tab. Opened in a new tab from the project page (header button and the notes full-screen icon) so only that tab is shared.
- [x] Gates per PR: London and UTC tests, eslint, build; real-browser check; merge, verify deployment, tidy.

Results: shipped as #34 (stamp on focus), #35 (single project GET), #36 (screen, split 3a) and 3b (project page button). 796 tests in both zones. Real-browser checks ran on local harness pages with a faked API, because the in-app browser has no session; the signed-in live screen still needs Peter to try it.

# Discovery repair plan

Complexity: XL, delivered as four ordered batches. All 18 discovery findings have local implementations and regression evidence.

- [x] Explicit date confirmation; native month navigation checked.
- [x] UI failures, journal edits, attachment races, settings and customer drawer.
- [x] Project state, completed report notes, recurrence identity/customer and atomic promotion.
- [x] Outlook/attachment retries, read-only cron dry runs and live-schema tracking.
- [x] Independent review and cleanup retry correction.
- [x] Full London/UTC tests, lint including JSX, production build.
- [x] Isolated PostgreSQL validation and exact migration approval packet.
- [x] Verify each commit boundary and release batches 1 to 3, PRs #25 to #27.
- [x] Exact migration approved, applied via MCP as 20260905164422 and smoke-tested in production; PR #28 merged for batch 4.
- [x] Verify serving deployment dpl_BxmT5nbs2DW6RageBLHEtqR8Merh and original checkout preservation.

Evidence: tasks/fix-function/2026-09-05-discovery-repairs/verification.md.
