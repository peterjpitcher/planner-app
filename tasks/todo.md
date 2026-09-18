# Migration history drift (18 Sep 2026)

Found: 446c4ba (anon drift check) and 677e50b (two applied migrations) never reached main; live history records the atomic promotion migration as 20260905164422 while the repo file was 20260905162045; 20260901000012 backfill is in the repo but not in live history.

- [x] Branch `fix/migration-history-drift` from origin/main; cherry-pick 446c4ba and 677e50b (no conflicts).
- [x] Rename the atomic promotion file to 20260905164422 (byte-identical to the live statement, md5 5bc32668...), and update the `\ir` in `supabase/__tests__/workflow-repairs.sql`.
- [x] Confirm the two 5 Sep files carry the same SQL as live (comments differ only).
- [x] Read-only live checks: anon catalogue matches the allowlist (6 stale trigger-function entries); no function missing a search_path; the 20260901000012 backfill has 207 links, all written 1 Sep 19:02 UTC, 0 left to insert.
- [x] Lint, `npm test`, `npm run test:utc`, build; open PR.
- [x] Trim the 6 stale trigger-function entries from the anon allowlist.
- [ ] `supabase migration repair --status applied 20260901000012` (history write only, no SQL runs).
- [ ] Merge #43, verify the deployment, tidy the branch.
- [ ] b3002eb (AGENTS.md symlink, docs/codebase-map.md) in its own PR, without overwriting main's CLAUDE.md.

Results: lint clean; 906 tests pass and 2 skip (the live anon checks, which need SUPABASE_DB_URL) in London and in UTC; build passes. `supabase migration list --linked` now differs only on 20260901000012, and `db push --dry-run` lists only that file (behind `--include-all`). Peter approved all four follow-ups on 18 Sep: the history repair, the merge, trimming the 6 stale trigger-function entries from `supabase/anon-access-allowlist.js` (done: 52 entries, matches live, a re-grant is caught), and bringing b3002eb over in a separate PR.

# Keep unsaved notes in the browser (17 Sep 2026)

Peter's answers: tasks from notes stay due today unless a date is written (no change); the normal project page keeps its usual tab title (no change); keep unsaved notes on the device (yes, approved storing note text in the browser).

- [x] `lib/noteDrafts`: one draft per project, task or customer in localStorage; tolerant of storage being unavailable.
- [x] NotesPanel: keep on change, restore with "Unsaved note from ... restored" and Discard (confirmed), remove on save, keep on failed save, warn when the browser will not keep it. A panel only removes a draft it wrote or restored, and gives it up when another tab writes, so a second tab cannot delete it. Lines finished before the tab closed are not picked up as tasks again.
- [x] Sidebar sign-out wipes every note draft.

Results: 881 tests in London and UTC. Real browser on a local harness: draft kept while typing, survived another tab clicking in and out of its empty box, restored after reload with the banner, failed save kept it, good save removed it, no duplicate task.

# Project screen: tab title and tasks from notes (17 Sep 2026)

- [x] Tab title is the project name on the project screen (#38). `useDocumentTitle` re-applies it, because Next.js streamed its metadata title in after load and overwrote a one-off `document.title` (and a React `<title>`).
- [x] Rules and notes panel support for picking tasks out of notes, off by default (#39).
- [x] Switched on for project notes, on the project screen and the project page, with lists kept in step on pick-up and undo.

Results: 863 tests in London and UTC. Real browser on a local harness with a faked API: tab title held after Next's rewrite; task lines created tasks with the right due dates, ordinary lines ignored, undo removed the task, saving created no duplicate. Signed-in live check still needs Peter.

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
