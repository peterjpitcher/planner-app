# Plan A: Jordan drafts in Outlook (runtime, proof, handover, cutover) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use the implement-plan skill to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Jordan's Planner-tracker loop with an hourly loop that drafts replies and chases straight into Outlook Drafts, never sends, and remembers which chains Peter ended.

**Architecture:**
- A standard-library Python state machine, `scripts/jordan_ledger.py` with the `scripts/jordan/` package, owns all state and decisions. It drives the scheduled Claude run through a request and response "step" protocol.
- The model only does three things: connector calls, message classification into fixed fields, and draft writing through a helper subagent.
- Safety comes from deny rules in `settings.json`, backed up by the script's checks.

**Tech Stack:** Python 3.12 (standard library), `unittest`, Claude desktop scheduled tasks, the Microsoft 365 connector, macOS `launchd`, `osascript` and `sntp`.

**Spec:** `docs/superpowers/specs/2026-09-18-jordan-outlook-drafts-design.md` (revision 3, approved 18 Sep 2026). Binding interface: `/Users/peterpitcher/Cursor/1 My Agents/scripts/jordan/CONTRACT.md`.

**Linked plans:** Plan B (`2026-09-18-jordan-plan-b-planner-removal.md`) starts after Task A13. Plan C (`2026-09-18-jordan-plan-c-archive-drop.md`) starts after Plan B is verified in production.

## Global Constraints

**Mailboxes and sending:**
- Only peter@orangejelly.co.uk is ever read. General Mills is never touched.
- Nothing is ever sent, forwarded, trashed or permanently deleted.

**Schedule and time:**
- Hourly schedule `30 7-17 * * 1-5`, local time (Europe/London).
- Chase due: 07:00 London on the third working day after the London send date. England and Wales bank holidays are excluded.

**Addresses:**
- Peter's addresses: peter@orangejelly.co.uk, peter@the-anchor.pub, manager@the-anchor.pub, peter.pitcher@outlook.com, thepitchersummers@gmail.com.
- Team addresses: theteam@, info@, events@, ticket@, now@, orders@ and employeecomms@the-anchor.pub.

**Draft content:**
- Sign-off "Thanks, Peter".
- Gaps use `[FILL: ...]`, and the first line is `[ACTION NEEDED: ...]`.
- Charlotte (CharlotteBrown@greeneking.co.uk) stays copied only on emails she is already on. She is thanked for the brief only in threads she started, and never added.
- Tasting-night threads (subject prefix "Anchor Stanwell Moor - Tasting Night 20th Nov") belong to `tasting-night-brand-chase` until 2026-11-21.

**Engineering rules:**
- Python standard library only; no em dash character anywhere (use `chr(0x2014)` in tests); British English.
- Tests: `cd "/Users/peterpitcher/Cursor/1 My Agents" && TZ=Europe/London python3 -m unittest discover -s scripts/jordan/tests -t scripts` must pass, and the same with `TZ=UTC`.
- Files under `desks/jordan/work/` are 0700 (folders) and 0600 (files).

---

## File structure

All paths are relative to `/Users/peterpitcher/Cursor/1 My Agents/` unless absolute. Layout and responsibilities are fixed by `scripts/jordan/CONTRACT.md` section 1.

| Task | Owns (creates or edits) |
|---|---|
| A1 | `scripts/jordan/dates.py`, `scripts/bank_holidays_england_wales.json`, `scripts/jordan/tests/test_dates.py` |
| A2 | `scripts/jordan/fp.py`, `scripts/jordan/tests/test_fp.py` |
| A3 | `scripts/jordan/lockfile.py`, `scripts/jordan/clock.py`, `scripts/jordan/tests/test_lockfile.py`, `scripts/jordan/tests/test_clock.py` |
| A4 | `scripts/jordan/__init__.py`, `paths.py`, `errors.py`, `jsonio.py`, `store.py`, `invariants.py`, `scripts/jordan_ledger.schema.json`, `scripts/jordan/tests/__init__.py`, `test_store.py`, `test_invariants.py` |
| A5 | `scripts/jordan/tool_policy.py`, `tool_policy.json`, `alerts.py`, `metrics.py`, `scripts/jordan_watchdog.py`, `scripts/jordan/launchd/com.orangejelly.jordan-watchdog.plist`, tests `test_tool_policy.py`, `test_alerts.py`, `test_metrics.py`, `test_watchdog.py` |
| A6 | `scripts/jordan/engine.py`, `rules.py`, `reconcile.py`, `report.py`, `handover.py`, `cli.py`, `scripts/jordan_ledger.py`, `scripts/jordan/tests/fake_connector.py`, `test_engine_*.py` |
| A7 | Additional scenario tests `scripts/jordan/tests/test_scenarios_*.py`; fixes routed through the lead |
| A8 | Staged prompt and standing files in `desks/jordan/work/staging/` |
| A9 | `company/peter-email-voice.md` |
| A10 to A13 | Live steps; evidence recorded in `desks/jordan/work/evidence/` and in this plan's results section |

---

### Task A1: Dates and bank holidays

**Files:** as table. **Interfaces:** Produces `dates.*` exactly as CONTRACT section 7.

- [ ] Fetch `https://www.gov.uk/bank-holidays.json` with Python `urllib`. Keep only `england-and-wales` events for 2026, 2027 and 2028. Write `{"division": "england-and-wales", "source": url, "fetched": ISO, "events": [{"title","date"}]}`. Check it against the spec's worked-example holidays (31 Aug 2026, 25 and 28 Dec 2026).
- [ ] Write failing tests:
  - every worked example in spec A5 (both time zones);
  - each parse form in the phrase table, including the vague cases (same weekday, "next Thursday", numeric dates, "end of the week", "EOD", another zone, a year-less date more than 6 months ahead);
  - a deadline at or before the send, which is not agreed;
  - `add_working_days` raising `DateOutOfRange` beyond 2028;
  - `holidays_cover` false on 2028-11-01.
- [ ] Implement `dates.py` until the tests pass under `TZ=Europe/London` and `TZ=UTC`.

### Task A2: Fingerprints and text checks

- [ ] Write failing tests:
  - normalisation ignores tags, entities, case, spacing and zero-width characters, but a changed word changes `fp_text`;
  - `split_top` finds the markers `divRplyFwdMsg`, `appendonsend`, `<hr` and a "From:" line followed by a "Sent:" line, and returns `(None, None)` when there is no marker;
  - similarity is at least 0.5 for a lightly edited text and below 0.5 for unrelated text;
  - `allowed_html` rejects span, font, blockquote, img, script, iframe, `on*` attributes and comments;
  - `check_unfinished` passes when every gap is `[FILL: x]` and the first line `[ACTION NEEDED: ...]` lists every gap in order;
  - `sanitise_summary` rejects "£40 per head", an email address, a UK phone number, more than 80 characters and the em dash;
  - `extract_saved` reads a saved tool-result JSON file (fixture shaped like the real `read_resource` output: id, subject, body.content, toRecipients as name and address objects, conversationId, parentFolderId, isDraft).
- [ ] Implement `fp.py`.

### Task A3: Lock and clock

- [ ] Write failing tests:
  - 100 processes (`multiprocessing`) call `acquire` together and exactly one gets "acquired";
  - two breakers race on one stale lock;
  - an old token is refused by `guarded`;
  - a late heartbeat from an old token does not refresh a new lock;
  - release with the wrong token raises;
  - a lock whose host differs is reported "foreign" and never broken;
  - `record_status` counts consecutive busy events;
  - `clock.check` with a fake `sntp` output gives "ok" for +0.02 and "offset" for +300, and gives "unreachable" when the command fails;
  - a wrong `JORDAN_SYSTEM_TZ` gives "tz_wrong";
  - `verify_newest` is false when the Mac is behind.
- [ ] Implement `lockfile.py` (hard-link acquire, flock guard, IOPlatformUUID host id, stale after 1,800 seconds) and `clock.py`.

### Task A4: Store and invariants

- [ ] Write failing tests:
  - `init` refuses when any of the ledger, journal or a backup exists;
  - init creates 0700 folders, 0600 files and `.key`;
  - `write` appends to the journal before the snapshot, and increments the version;
  - a crash after the journal append (simulated) is replayed on `load`;
  - `backup` keeps 14 copies and truncates the journal;
  - `check_permissions` raises on a 0644 file;
  - `hash_address` is stable and keyed;
  - every invariant I1 to I16 has one passing and one failing ledger fixture;
  - `write` refuses (exit 30) when `invariants.check` finds a breach.
- [ ] Implement `paths.py`, `errors.py`, `jsonio.py`, `store.py`, `invariants.py` and `jordan_ledger.schema.json`.

### Task A5: Tool policy, alerts, metrics and watchdog

- [ ] Write `tool_policy.json`:
  - **Allowed:** the connector tools and built-ins in spec A1.1, with names in the form `mcp__<server>__<tool>`. The server id is matched by the pattern `mcp__*__<tool>` for Microsoft 365 connector tools.
  - **Denied:** every other Microsoft 365 connector tool; all other MCP servers (as `mcp__<server>` prefixes); WebFetch, WebSearch, Workflow, CronCreate, CronDelete, RemoteTrigger, SendMessage and NotebookEdit; the worktree tools; plus Edit and Write on `desks/jordan/work/**`, `archive/**`, `scripts/**` and `.claude/**`.
- [ ] Write failing tests:
  - coverage flags an unlisted tool;
  - coverage flags a denied entry missing from `settings.json`;
  - alert dedupe allows one first alert per fingerprint per working day, a reminder at the first run from 07:00, and recovery after 2 clean runs;
  - `notify` calls `JORDAN_NOTIFY_CMD`;
  - `runs.jsonl` gets started and finished lines, with the prompt SHA-256;
  - the watchdog notifies when no finished run exists since the previous scheduled slot on a working day, and stays silent at weekends and on bank holidays.
- [ ] Implement `tool_policy.py`, `alerts.py`, `metrics.py`, `jordan_watchdog.py`, and the LaunchAgent plist (`StartCalendarInterval` Monday to Friday at 09:05 and 14:05, running `/usr/bin/python3 "<ROOT>/scripts/jordan_watchdog.py"`).

### Task A6: Engine, rules, reconciliation, handover, CLI

**Interfaces:** Consumes A1 to A5 exactly as CONTRACT section 7. Produces the CLI and step protocol in CONTRACT sections 4 and 5.

- [ ] Write `tests/fake_connector.py`: an in-memory mailbox (Inbox, Sent Items, Drafts, Deleted Items, Outbox, custom folders). It answers every request type in CONTRACT 5.1 the way the real connector does:
  - search results carry no conversationId and use offset paging;
  - `NOT_FOUND` for missing ids;
  - optionally, ids change when a message moves;
  - delete of a draft that is already gone succeeds;
  - timeouts can be injected after the change has been made;
  - rate limits can be injected.

  Scripted classifications and draft bodies stand in for the model.
- [ ] Write failing scenario tests:
  - every row in spec Appendix 1 (S, M, DR, E1, AR);
  - every reconciliation row R1 to R10;
  - every crash point in Appendix 2;
  - every A17 bullet.
- [ ] Implement `engine.py` with these phases, in order:
  1. start: clock, lock, load, permissions, coverage, metrics;
  2. drafts scan and index;
  3. listing and ingest, as a merged stream up to the horizon;
  4. reconcile;
  5. observe;
  6. act;
  7. finish: backup, alerts, metrics, report, release.
- [ ] Implement `rules.py`, `reconcile.py`, `report.py`, `handover.py` (handover and dry-run modes with `progress.json`) and `cli.py`.
- [ ] Both test runs pass.

### Task A7: Independent adversarial testing of the engine

- [ ] A fresh agent writes more scenario tests from the spec alone, without reading the implementation first, aimed at breaking the rules on:
  - chain ending and restart;
  - duplicates;
  - recipients;
  - dates;
  - the lock;
  - catch-up.
- [ ] Any failure is fixed by the engine owner, and the full suite passes in both time zones.

### Task A8: Prompt and standing files (staged)

- [ ] Write `desks/jordan/work/staging/SKILL.md`, the new hourly prompt. It loops on `start` and `step` and performs requests exactly. For `write` requests it uses a helper subagent with only the given context. It never calls a tool no request asked for, and it prints the final report.
- [ ] Write the staged versions of `jordan.md`, `outlook-connector/SKILL.md`, `draft-reply/SKILL.md`, `daily-triage/SKILL.md`, `platform-policies.md`, `brand-rules.md` and the notebook note, as spec A16 describes.

### Task A9: Voice profile

- [ ] Read-only: list recent Sent Items from peter@orangejelly.co.uk and select about 50 emails Peter wrote himself. Leave out emails only to his own or team addresses, app subjects (for example "Planner:", "Daily Review", recruitment and booking summaries) and emails that began as Jordan or tracker drafts.
- [ ] Write `company/peter-email-voice.md` (0600), with Orange Jelly and Anchor sections: openings, sign-offs, phrases, tone by relationship, and things he never says. Short phrases only, with no names, prices or email content.

### Task A10: G1, proof

- [ ] Change step 5 of the old prompt to "list approved rows in the report as: send this yourself from Outlook". Record its hash in `MANIFEST.txt`.
- [ ] Merge the tool policy into `.claude/settings.json` (deny list). Record the before and after hashes.
- [ ] Run a coverage check on a scheduled one-off run's tool listing.
- [ ] Run P9 as a one-off scheduled task in `1 My Agents`: it attempts `outlook_send_draft`, `outlook_send_mail` and `outlook_forward_mail`, all addressed only to peter@orangejelly.co.uk, and each must be refused by a deny rule.
- [ ] Run the proof as in spec "Proof as run", on real threads with drafts only, using a proof-mode ledger at `desks/jordan/work/proof/attempt-1/`. Record every case in `results.md`.
- [ ] Clean up: remove the proof drafts, and move the proof folder to the archive.

### Task A11: G2, dry run

- [ ] Take a read-only Supabase select of the open tracker rows and save it to `desks/jordan/work/handover/export-dryrun.json` (0600).
- [ ] Run `start --mode dryrun` with an ephemeral ledger, then `handover-load` and steps until done. Record the proposed action for each of the 67 rows, the counts and the estimate.

### Task A12: G3, cutover and handover

1. Pause `jordan-followups-loop` (`enabled: false`).
2. Hash everything again and record any drift.
3. Take the frozen export (read-only select) and save it to the archive (0600).
4. Refresh the dry run and record the differences.
5. `init --mode live --checkpoint <start of the old loop's last completed run>`.
6. `start --mode handover`, then `handover-load`, then steps until done (batches of 10, each draft saved individually).
7. Copy the ledger after the handover, the journal and the mapping to the archive, and record their hashes.
8. Install the new prompt and standing files, set the title "Jordan: hourly inbox drafts", cron `30 7-17 * * 1-5`, and enable the task.
9. Disable `jordan-inbox-6month-backfill`.
10. Install the watchdog LaunchAgent, set `cleanupPeriodDays: 30` in `.claude/settings.local.json`, and set the transcript folder to 0700.
11. Verify the scheduled tasks and all hashes.

### Task A13: Live verification

- [ ] Start two hourly runs by hand (`run_scheduled_task`). Both must finish cleanly, with:
  - zero duplicate candidates;
  - zero invariant breaches;
  - zero recipient mismatches;
  - no open alerts;
  - each "started" line carrying the new prompt's hash.
- [ ] Record the results. This is the evidence that starts Plan B.

## Results

Results are recorded here as tasks complete.
