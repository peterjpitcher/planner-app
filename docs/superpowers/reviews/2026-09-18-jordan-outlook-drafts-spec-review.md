# Developer Review: Jordan Outlook Drafts and Planner Follow-ups Retirement

**Specification reviewed:** `docs/superpowers/specs/2026-09-18-jordan-outlook-drafts-design.md`, dated 18 September 2026  
**Review basis:** the supplied specification, Planner `origin/main` at `c156575`, the current Follow-ups implementation and migration, and the current Jordan scheduled task and standing files  
**Review scope:** technical design, delivery, operations, security, data, migration, testing and rollback  
**Review outcome:** **Not ready for final approval or implementation.** The direction is sound, and the Planner removal is well bounded, but the mailbox and ledger design has four correctness blockers and several decisions that still need to be made.

## Rating system

- **Priority:** P0 blocks approval because it can cause duplicate, lost or wrongly addressed mail activity. P1 must be resolved before implementation. P2 should be resolved before rollout or accepted explicitly. P3 is an optional improvement.
- **Status:** Confirmed issue means the specification is missing, contradictory or unsafe as written. Optional improvement means the current approach can work, but the proposed change would reduce cost or risk.
- **Type:** Requirement, correctness, data, integration, security, privacy, operations, delivery, migration, testing, performance, accessibility or simplification.

## Findings summary

| ID | Priority | Status | Type | Finding |
|---|---|---|---|---|
| F01 | P0 | Confirmed issue | Correctness, data | One ledger entry per conversation cannot preserve an ended chain and also restart the same conversation |
| F02 | P0 | Confirmed issue | Correctness, integration | Outlook draft creation and ledger persistence are not atomic, so retries can create duplicate drafts |
| F03 | P0 | Confirmed issue | Correctness, integration | The run has no defined way to detect Peter's own existing draft in a conversation |
| F04 | P0 | Confirmed issue | Delivery, operations | One approval authorises live drafts, a 67-thread handover, merge, deploy and task deletion without separate evidence gates |
| F05 | P1 | Confirmed issue | Integration | Draft ID permanence is assumed although ordinary Outlook IDs are acknowledged to change |
| F06 | P1 | Confirmed issue | Correctness | The 14-day catch-up cap can silently skip mail and still advance the checkpoint |
| F07 | P1 | Confirmed issue | Correctness, operations | The JSON-held run lock does not define an atomic lock acquisition or safe stale-lock recovery |
| F08 | P1 | Confirmed issue | Requirement | Edited drafts have no complete lifecycle after Jordan stops managing them |
| F09 | P1 | Confirmed issue | Correctness | Ask closure by any non-Peter reply conflicts with the exclusion of automated and out-of-office mail |
| F10 | P1 | Confirmed issue | Requirement, integration | Recipient reconstruction is underspecified and can address the wrong people |
| F11 | P1 | Confirmed issue | Security | Untrusted email content and prompt injection are not addressed |
| F12 | P1 | Confirmed issue | Migration, data | The archive-and-drop migration lacks executable safety guards and a fully defined archive schema |
| F13 | P1 | Confirmed issue | Delivery | Cutover, rollback and restoration do not cover mailbox side effects or the critical ledger |
| F14 | P1 | Confirmed issue | Testing | Production proof tests are not specified tightly enough to be repeatable or safely reversible |
| F15 | P2 | Confirmed issue | Requirement | Deadline and working-day rules are not precise enough for deterministic implementation |
| F16 | P2 | Confirmed issue | Requirement | Chain, message and state transition definitions are incomplete |
| F17 | P2 | Confirmed issue | Operations | Alert transport, deduplication and recovery behaviour are not defined |
| F18 | P2 | Confirmed issue | Privacy, data | Ledger permissions, retention and backup handling for addresses and summaries are unspecified |
| F19 | P2 | Confirmed issue | Performance | Search pagination, request bounds and the 67-thread handover budget are missing |
| F20 | P2 | Confirmed issue | Delivery | Scheduled-task deletion, snapshots and configuration changes lack exact locations and verification |
| F21 | P2 | Confirmed issue | Requirement | The Charlotte Brown copying rule is too broad to apply safely without qualification |
| F22 | P2 | Confirmed issue | Monitoring | First-day observation has no lasting service measures or thresholds |
| F23 | P2 | Confirmed issue | Testing | Planner removal checks omit repository, route, environment and migration-specific cases |
| F24 | P3 | Optional improvement | Simplification | Split the work into three independently approved deliverables |
| F25 | P3 | Optional improvement | Accessibility, usability | Make bracketed gaps and attachment prompts harder to send accidentally |

## Detailed findings

### F01. One conversation cannot safely represent both an ended chain and a restarted chain

- **Relevant section:** 4, Keeping track without Planner; 5, Drafts, deletions and the end of a chain; D9.
- **Priority:** P0.
- **Type:** Correctness, data.
- **Status:** Confirmed issue.
- **Description:** The ledger has one entry per Outlook conversation, ended entries are retained forever, and a new inbound or outbound ask in the same conversation is said to start a new chain. The specification does not say whether the ended entry is overwritten, reset or duplicated. A ledger keyed only by conversation ID cannot hold two chain generations without losing the fact that the earlier generation ended.
- **Rationale:** Conversation IDs identify threads, not business episodes. The design uses chain deletion as a permanent user instruction, then permits that instruction to be superseded inside the same thread.
- **Impact:** A deleted chain may reappear unexpectedly, or a valid new message may never receive a draft. Audit history and chase counts may also be corrupted.
- **Recommended action:** Define a stable ledger key such as `conversation_id + generation`, retain a conversation-level history of ended generations, and specify the exact event that opens the next generation. Include a state-transition table with preconditions and resulting fields.
- **Open questions:** Does a new inbound automated message restart a chain? Does any Peter-sent message restart it, or only one classified as an ask? Should the old generation remain queryable after restart?

### F02. Draft creation and ledger saving can produce duplicates

- **Relevant section:** 1, The hourly run; 4, The ledger; 8, Failures and alerts.
- **Priority:** P0.
- **Type:** Correctness, integration.
- **Status:** Confirmed issue.
- **Description:** Creating a draft in Outlook and recording its ID in a local file are two separate operations. If Outlook creates the draft but the connector response, ledger update or final save fails, the next run has no durable evidence that the draft exists and will retry.
- **Rationale:** Atomic local file replacement protects only the file itself. It does not make the Outlook mutation and local persistence one transaction. The same gap exists if several drafts are created and the run fails before the final ledger save or checkpoint.
- **Impact:** Duplicate reply or chase drafts, the main failure the ledger is intended to prevent.
- **Recommended action:** Add an explicit reconciliation phase before every create. Persist an intent record before the connector call, then reconcile that intent against Drafts by conversation, recipients, normalised body fingerprint and a bounded creation window. Save the ledger after each successful external mutation, not only at the end. Define how ambiguous results are handled, with fail-closed behaviour.
- **Open questions:** Can the connector expose a stable custom marker or internet header for Jordan drafts? If not, which fields form the reconciliation key, and how long is the search window?

### F03. Peter's own drafts are not discoverable by the stated loop

- **Relevant section:** 1, The hourly run; 2, Which emails get a reply draft; 5, One draft at a time.
- **Priority:** P0.
- **Type:** Correctness, integration.
- **Status:** Confirmed issue.
- **Description:** The eligibility rule says Jordan must not draft when any draft already exists in the thread, including Peter's. The run reads Inbox and Sent Items plus Jordan draft IDs already in the ledger. It does not define a Drafts-folder scan or another method for finding Peter's draft and obtaining its conversation ID.
- **Rationale:** Search results do not include conversation ID according to the specification, so detecting an arbitrary existing draft requires paginated Drafts search followed by message reads or another supported connector operation.
- **Impact:** Jordan can create a second draft while Peter is already writing one, causing clutter and a real risk that the wrong draft is sent.
- **Recommended action:** Add a bounded, paginated Drafts reconciliation phase before eligibility decisions. Define how all candidate drafts are mapped to conversations, how very old drafts are treated, and what happens when the folder cannot be scanned completely.
- **Open questions:** How many drafts are currently in the mailbox, and can the connector filter Drafts by date? Is a partial Drafts scan sufficient, or must the run fail closed if pagination is incomplete?

### F04. Final approval is too broad for the live effects it authorises

- **Relevant section:** Rollout order; statement that approval covers steps 1 to 5 and 7.
- **Priority:** P0.
- **Type:** Delivery, operations.
- **Status:** Confirmed issue.
- **Description:** One approval would authorise real mailbox writes, a one-off pass across 67 open records, edits outside the Git repository, a schedule change, a pull request, merge, production deployment, task deletion, branch cleanup and environment changes. Several steps depend on evidence that does not exist until earlier steps run.
- **Rationale:** A proof result can invalidate the design. The 67-thread handover has a much larger live impact than the two-draft proof. Merge, deploy and deletion are separate operational decisions under the workspace rules.
- **Impact:** The project could proceed past a failed or ambiguous proof, or make difficult-to-reverse changes under approval that was not specific enough.
- **Recommended action:** Replace the single approval with explicit gates: G1 approve two controlled proof drafts; G2 approve implementation and dry-run reconciliation output; G3 approve the live handover and scheduler cutover after a count and sample report; G4 approve Planner merge and deployment after first-day evidence; G5 retain the existing separate table-drop approval. State which actions are read-only and which mutate live systems.
- **Open questions:** May the developer merge and deploy automatically after G4, or must merge and deployment each be separately confirmed? Who reviews the 67-thread dry-run list?

### F05. Draft ID permanence is unconfirmed

- **Relevant section:** 4, ledger fields; 5, reading waiting drafts by ID; Graph facts.
- **Priority:** P1.
- **Type:** Integration.
- **Status:** Confirmed issue.
- **Description:** The specification acknowledges that ordinary Outlook IDs can change when a message moves, then states that connector-created drafts keep a permanent ID. Step 1 tests selected moves, but the storage and recovery design still relies on direct lookup by that ID.
- **Rationale:** A single observed draft is not a contract. Send, move, retention processing and connector implementation changes may return a new ID or make the resource unavailable.
- **Impact:** Jordan may interpret an ID change as deletion, incorrectly end a chain, or fail to detect a send.
- **Recommended action:** Treat ID stability as unconfirmed until the connector contract says otherwise. Store conversation ID, internet message ID if available, subject, recipients, timestamps and fingerprint as fallback locators. Specify search-based recovery before applying the `missing` transition.
- **Open questions:** Does `read_resource` expose immutable ID or internet message ID? What exact error distinguishes moved, deleted, inaccessible and transient failure?

### F06. The 14-day catch-up cap permits silent data loss

- **Relevant section:** 1, window from checkpoint to now, up to 14 days; 6, missed runs.
- **Priority:** P1.
- **Type:** Correctness.
- **Status:** Confirmed issue.
- **Description:** The specification says missed runs are caught up from the last successful checkpoint, but caps that window at 14 days without defining what happens to an older checkpoint.
- **Rationale:** If the Mac or task is unavailable for more than 14 days and the run scans only the latest 14 days, advancing the checkpoint to now permanently skips the earlier gap.
- **Impact:** Replies and asks can be missed without an alert.
- **Recommended action:** Process long gaps in bounded sequential chunks and advance the checkpoint only to the end of each proven-complete chunk. Alternatively stop and require an explicit recovery handover when the gap exceeds 14 days.
- **Open questions:** Is more than 14 days of catch-up acceptable in one run? What is the maximum connector and model budget for recovery?

### F07. The lock design is not actually specified as atomic

- **Relevant section:** 4, script holds the run lock; 1, stop if another run started less than 50 minutes ago.
- **Priority:** P1.
- **Type:** Correctness, operations.
- **Status:** Confirmed issue.
- **Description:** Storing lock information in the same JSON ledger does not by itself prevent two processes from reading `unlocked` and both writing `locked`. The 50-minute rule does not define PID, host, owner token, clock skew, crash recovery or a run that genuinely lasts longer than 50 minutes.
- **Rationale:** Correct locking needs an atomic primitive, such as exclusive lock-file creation or an operating-system file lock held for the process lifetime.
- **Impact:** Overlapping runs can create duplicates or overwrite each other's ledger changes.
- **Recommended action:** Use an atomic lock separate from the ledger. Record owner token, PID, host and acquired time for diagnostics. Define stale-lock recovery and require an ownership check before release. Test contention with separate processes, not only function calls.
- **Open questions:** Can scheduled runs overlap at the runner level? What should happen when a run exceeds 50 minutes during handover?

### F08. Edited drafts have an incomplete lifecycle

- **Relevant section:** 5, row 4 says Jordan never touches an edited draft again.
- **Priority:** P1.
- **Type:** Requirement.
- **Status:** Confirmed issue.
- **Description:** It is unclear whether `never touches it again` means Jordan stops modifying the draft but continues observing the thread, or stops tracking the draft entirely. The design does not state how a later send, delete, new inbound message or abandoned edited draft affects the chain.
- **Rationale:** Peter editing a Jordan draft is a normal expected journey, not an edge case.
- **Impact:** Chases may not be armed after an edited draft is sent, new inbound messages may get no replacement draft, or an old edited draft may block the thread forever.
- **Recommended action:** Split ownership from observation. Jordan must never modify an edited draft, but must continue observing Sent Items and new inbound messages. Define state transitions for edited-then-sent, edited-then-deleted, edited-and-left, and new inbound while edited draft remains.
- **Open questions:** Does deleting an edited former-Jordan draft end the chain? If a new inbound arrives, should Jordan refrain from drafting until Peter removes his edited draft?

### F09. Any reply cannot safely close an ask

- **Relevant section:** 2, excluded automated mail; 3, answered as soon as anyone other than Peter replies.
- **Priority:** P1.
- **Type:** Correctness.
- **Status:** Confirmed issue.
- **Description:** The chase rule closes an ask on any non-Peter reply, while the reply rules recognise out-of-office and automated messages as non-human. Delivery failures, acknowledgements and unrelated participant replies are also possible.
- **Rationale:** Presence of a reply is not the same as the ask being answered.
- **Impact:** Legitimate chases can be cancelled silently.
- **Recommended action:** Define an `answering reply` classification. At minimum exclude out-of-office, delivery reports, auto acknowledgements and messages that do not address the ask. If uncertain, keep the ask open and flag it rather than silently close it.
- **Open questions:** Should a human reply saying `I will come back to you` reset the three-working-day clock, close the ask, or keep the original due date?

### F10. Recipient reconstruction can address the wrong people

- **Relevant section:** 2, reply versus reply-all; 3, chase recipients; connector facts.
- **Priority:** P1.
- **Type:** Requirement, integration.
- **Status:** Confirmed issue.
- **Description:** The chase rule copies the original To and Cc minus Peter, but does not define Peter's aliases, shared-mailbox addresses, duplicates, Reply-To, removed participants, distribution lists, Bcc, or recipients added later in the conversation. The connector search combines recipients, and the detailed read is needed to separate them.
- **Rationale:** Recipient mistakes are visible externally even though Jordan does not send automatically, and Outlook drafts can still be sent accidentally without close review.
- **Impact:** Confidentiality breach, awkward copying of the wrong party, or a chase sent to Peter himself.
- **Recommended action:** Specify a canonical set of Peter-owned addresses and case-insensitive normalisation. Never infer Bcc. Use the exact target message's To and Cc after detailed read, with Reply-To behaviour documented. Add a mandatory `needs you` warning for distribution lists, new external recipients or uncertain aliases.
- **Open questions:** Which aliases count as Peter? Should chase Cc preserve all original copied recipients or only current active participants?

### F11. Email must be treated as untrusted instructions

- **Relevant section:** 1 and 2, message reading and draft generation; 7, tool permissions.
- **Priority:** P1.
- **Type:** Security.
- **Status:** Confirmed issue.
- **Description:** The specification does not state that email bodies, quoted history, HTML, links and attachments are untrusted data that cannot change Jordan's instructions or tool permissions.
- **Rationale:** A sender can include prompt injection text asking the agent to reveal data, use another tool, alter recipients or ignore policy. Tool allow-lists help, but they do not prevent data leakage into a draft or report.
- **Impact:** Disclosure of unrelated mailbox content, malicious recipient changes, or policy bypass attempts.
- **Recommended action:** Add a hard rule that mailbox content is data only. Jordan must never follow instructions in an email that concern its system behaviour, tools, secrets, other messages or files. Limit context to the selected thread and approved standing files. Never open links or attachments during the loop. Add adversarial email fixtures and assert that no cross-thread content or forbidden action appears.
- **Open questions:** Does the connector sanitise active HTML and remote content before returning bodies? Can attachments be listed without reading them?

### F12. The retirement migration needs executable guards

- **Relevant section:** 10, Retiring the table.
- **Priority:** P1.
- **Type:** Migration, data.
- **Status:** Confirmed issue.
- **Description:** The section describes an archive copy and drop but does not define the archive columns, primary key, creation behaviour on retry, grants, comments, dependency checks or a transaction-time row-count assertion. Copying the stakeholders precedent literally would use `CREATE TABLE IF NOT EXISTS ... AS SELECT`, which can leave an existing partial archive untouched on retry.
- **Rationale:** The live dependency check dated 18 September can become stale before migration. A migration must prove safety when it executes.
- **Impact:** Incomplete archive, failed rollback, excessive access, or runtime breakage in a function or view discovered only after deployment.
- **Recommended action:** Define the archive table explicitly with all source columns plus `archived_at`, a primary key and intended grants. In one transaction, lock the source against writes, check functions/views/triggers and foreign keys, upsert or insert all rows idempotently, assert source and archive counts and IDs match, then drop. Add a restore migration or documented restore SQL before applying the drop.
- **Open questions:** Should archived rows retain foreign keys to users and customers, or be independent snapshots? Who may read the archive, and for how long?

### F13. Rollback covers files but not system state

- **Relevant section:** 4, backups; 11, snapshots; rollout steps 2 to 7.
- **Priority:** P1.
- **Type:** Delivery.
- **Status:** Confirmed issue.
- **Description:** File snapshots can restore prompts, but they cannot remove or identify all drafts made during handover, reconstruct overwritten ledger generations, restore a deleted scheduled task, re-add environment variables, or reverse a production deployment. No rollback trigger or owner is given.
- **Rationale:** The highest-risk changes are live mailbox and scheduling effects, not file edits.
- **Impact:** A failed cutover can leave two routines active, orphaned drafts, or no reliable follow-up system.
- **Recommended action:** Write a step-specific rollback runbook before rollout. Include how to pause the new schedule, re-enable the old one, identify Jordan-created drafts without deleting Peter's work, restore the exact snapshot, restore the task definition, and confirm only one loop is active. Preserve the initial ledger and every handover mapping as immutable evidence.
- **Open questions:** Is rollback allowed to move Jordan-created drafts to Deleted Items automatically, or must Peter decide draft by draft?

### F14. The live proof is not repeatable enough

- **Relevant section:** Rollout step 1; How we will know it works.
- **Priority:** P1.
- **Type:** Testing.
- **Status:** Confirmed issue.
- **Description:** The proof asks for two real drafts but does not identify controlled fixtures, expected addresses, expected subjects, exact success evidence, cleanup, or what result blocks rollout. It also combines several lifecycle checks that require Peter to send, edit and delete at particular times.
- **Rationale:** Production testing needs a scripted sequence and captured before/after state to distinguish connector behaviour from operator variation.
- **Impact:** Ambiguous proof may be treated as success, or tests may affect genuine conversations unexpectedly.
- **Recommended action:** Use named low-risk test threads or self-controlled external accounts. Write a checklist with starting state, action, expected connector result, Outlook observation, ledger observation and cleanup for each case. Any uncertain ID, recipient, threading, fingerprint or sent-state result must block G2.
- **Open questions:** Which two threads are approved for the test? Is Peter willing to send the chase, or should a controlled second mailbox be used?

### F15. Working-day and deadline semantics are incomplete

- **Relevant section:** 3, chase timing; 6, schedule; testing across clock change.
- **Priority:** P2.
- **Type:** Requirement.
- **Status:** Confirmed issue.
- **Description:** `3 working days after` does not state whether the send day counts, what local time makes the chase due, or how a Friday evening send behaves. Natural-language deadlines such as `by Thursday`, `tomorrow`, dates without a year and times in another zone are not defined. Bank holidays are ignored for scheduling, but it is unclear whether they count as working days for chase due dates.
- **Rationale:** Date ambiguity is a recurring project risk and the scheduled runtime may operate in a different zone from message timestamps.
- **Impact:** Chases can appear a day early or late.
- **Recommended action:** Define all date calculations in `Europe/London`, give worked examples, state whether bank holidays count, and require confirmation for ambiguous extracted deadlines. Store the source deadline text, parsed instant and parse confidence.
- **Open questions:** Does `3 working days` mean due at 07:30 on the third following weekday, or at the original send time? Do England and Wales bank holidays count as non-working days?

### F16. The state machine is not complete

- **Relevant section:** 4, listed states; 5, outcome table.
- **Priority:** P2.
- **Type:** Requirement.
- **Status:** Confirmed issue.
- **Description:** States are listed, but allowed transitions and required data are not. `watching`, `awaiting them`, `missing` and `ended` overlap with draft ownership and open-ask status. There is no state for Peter-owned edited draft, pending external mutation, reconciliation needed or failed draft creation.
- **Rationale:** A state list is not a state machine. Correct retries and pruning depend on unambiguous transitions.
- **Impact:** Different implementers can make incompatible decisions, and invalid combinations can enter the ledger.
- **Recommended action:** Add a transition table covering event, current state, guard, next state, field changes and permitted side effects. Prefer orthogonal fields for thread status, open ask, draft ownership and pending operation instead of forcing all concerns into one state string.
- **Open questions:** Can an ended chain retain an open ask? When is `watching` prunable? What state follows a recoverable connector error?

### F17. Alert behaviour depends on an unspecified channel

- **Relevant section:** 8, Failures and alerts; D8.
- **Priority:** P2.
- **Type:** Operations.
- **Status:** Confirmed issue.
- **Description:** The design requires push notifications but does not name the tool, recipient, delivery contract or fallback. `last failure time` is not enough to model one initial alert, one daily reminder and one recovery alert across changing failure types.
- **Rationale:** Monitoring is only effective if its transport and state are deterministic.
- **Impact:** Failures may be visible only in a scheduled-task report that Peter does not see, or notifications may repeat excessively.
- **Recommended action:** Name the notification mechanism and fallback. Store failure fingerprint, first seen, last seen, last notified and recovery-notified status. A notification failure must be reported separately without advancing the mailbox checkpoint if alerting is required for safe operation.
- **Open questions:** Which push notification tool is guaranteed in scheduled runs? Should time-sensitive draft alerts be per draft or one digest per run?

### F18. Local privacy and retention controls are missing

- **Relevant section:** 4, ledger and backups.
- **Priority:** P2.
- **Type:** Privacy, data.
- **Status:** Confirmed issue.
- **Description:** The ledger stores external names or addresses, timestamps and ask summaries, while ended entries are kept forever and backups are retained. File permissions, backup directory, encryption-at-rest assumptions and deletion policy are not stated.
- **Rationale:** One-line summaries can contain commercially sensitive or personal information even without message bodies.
- **Impact:** Unnecessary indefinite retention and wider local access than intended.
- **Recommended action:** Set files and directories to owner-only permissions, avoid names where an address hash or conversation key suffices, prohibit sensitive content in summaries, define backup location and retention, and review whether ended records can retain only a non-reversible tombstone rather than full metadata.
- **Open questions:** Is indefinite retention necessary, or can ended entries be reduced to conversation ID, generation and ended timestamp after 90 days?

### F19. Search and handover bounds are not specified

- **Relevant section:** connector facts; 1, run loop; rollout step 2; risks.
- **Priority:** P2.
- **Type:** Performance.
- **Status:** Confirmed issue.
- **Description:** Search returns 25 results at a time, but the design does not require pagination, page caps, continuation handling or checkpoint behaviour after partial pages. The 67-thread handover may require many full-body reads, and a single body has already reached 80,000 characters.
- **Rationale:** API-rate headroom does not solve model context, scheduled-task duration or partial-completion correctness.
- **Impact:** Skipped messages, long or failed runs, high cost, and ambiguous resume behaviour.
- **Recommended action:** Specify pagination until the time boundary is exhausted. Put deterministic caps on messages and bytes per run, process handover in resumable batches, and save progress after each batch. The extractor must operate before large bodies enter model context if the connector architecture permits it.
- **Open questions:** Does `read_resource` return the 80,000 characters to the model before the local extractor can receive them? If so, the proposed extractor does not achieve its stated context-saving outcome.

### F20. External file and task changes are not reproducible

- **Relevant section:** 11, Jordan's files; rollout steps 3 and 7.
- **Priority:** P2.
- **Type:** Delivery.
- **Status:** Confirmed issue.
- **Description:** One file is under `~/.claude`, the others are under `1 My Agents`, and the scheduled tasks themselves are not identified by storage path or management command. `copy every file below` does not say how the out-of-tree prompt is represented in the archive. Deleting the backfill task and changing the schedule are not given exact procedures or post-change evidence.
- **Rationale:** `1 My Agents` has no Git history, so the snapshot and change log are the only rollback evidence.
- **Impact:** Incomplete backup, accidental deletion of the wrong task, or configuration drift that cannot be reconstructed.
- **Recommended action:** Inventory exact absolute source paths, task IDs, schedule values and hashes before editing. Put a manifest in the archive mapping each source to its saved copy. Export task definitions if supported. Verify the active task title, ID, schedule and prompt after change, and verify the backfill task by exact ID before deletion.
- **Open questions:** Where is the scheduled task definition stored apart from its prompt? Can the task be disabled and retained rather than deleted for the first week?

### F21. The Charlotte Brown rule needs a narrower trigger

- **Relevant section:** 2, drafting rule; shared brand-rules change.
- **Priority:** P2.
- **Type:** Requirement.
- **Status:** Confirmed issue.
- **Description:** `Any email to a drinks brand for The Anchor` copies Charlotte and thanks her for the brief. It does not define whether this applies to complaints, invoices, existing operational relationships, private matters, later replies where she has been removed, or every chase indefinitely.
- **Rationale:** Automatically adding an external recipient is materially different from drafting text and can expose conversation content.
- **Impact:** Inappropriate disclosure or repetitive, awkward copying.
- **Recommended action:** Scope the rule to named campaign threads or a clear campaign classifier, preserve Charlotte only when she is already a participant unless Peter explicitly approved adding her, and flag uncertain cases rather than add a recipient.
- **Open questions:** Is this rule only for the tasting-night campaign, or genuinely all drinks-brand mail for The Anchor? Should every follow-up repeat the thanks?

### F22. Monitoring stops after the first day

- **Relevant section:** rollout step 4; Risks and trade-offs.
- **Priority:** P2.
- **Type:** Monitoring.
- **Status:** Confirmed issue.
- **Description:** The first three runs are checked, and usage is suggested for review after a week, but there are no ongoing measures or thresholds.
- **Rationale:** Misclassification, stale locks, missed schedules and duplicate drafts can emerge after normal mailbox variation rather than during the first day.
- **Impact:** Degradation may remain unnoticed until Peter misses a reply or sees draft clutter.
- **Recommended action:** Record per-run counts and duration without message bodies: scanned, read, drafted, reconciled, ended, skipped, retried and failed. Define alerts for no successful weekday run by a set time, checkpoint age, duplicate reconciliation, lock age and repeated connector failure. Review after day 1 and week 1.
- **Open questions:** Where will these metrics live if not Planner? How long should privacy-safe run reports be retained?

### F23. Planner removal verification needs tightening

- **Relevant section:** 9, Removing Follow-ups; How we will know it works.
- **Priority:** P2.
- **Type:** Testing.
- **Status:** Confirmed issue.
- **Description:** The listed checks are a good base, but `npm run lint` is documented as broken in this repository, the leftover search patterns do not include the table or environment names, and route checks do not state authentication context. Environment removal is not verified before or after deployment. The migration itself has no local test or dry run.
- **Rationale:** A command known to be broken cannot be an unexplained release gate, and incomplete searches can miss live coupling.
- **Impact:** False gate failure, stale secrets/configuration, or code paths left behind.
- **Recommended action:** Record the expected lint limitation and use the repository's agreed replacement if available. Search for `email_follow_ups`, `EMAIL_FOLLOWUPS`, route paths, UI labels and imports. Check `/email-follow-ups` while authenticated and unauthenticated, and the cron route directly. Inspect Vercel variables before removal and verify absence after. Apply the migration to a local or disposable database snapshot and test archive equality plus restore SQL.
- **Open questions:** What is the accepted lint replacement for this Next.js 15 repository? Are production environment variables managed only through Vercel?

### F24. Split delivery into three independently approved units

- **Relevant section:** Overall design and rollout.
- **Priority:** P3.
- **Type:** Simplification.
- **Status:** Optional improvement.
- **Description:** The specification combines the Jordan runtime redesign, Planner code removal and database retirement.
- **Rationale:** These have different repositories, rollback methods and risk profiles. Each can be reviewed and verified independently.
- **Impact:** Keeping them together increases coordination cost and makes approval less precise.
- **Recommended action:** Produce three linked implementation plans: A, ledger and Outlook draft runtime plus handover; B, Planner code and environment removal; C, archive and drop migration. Keep the current rollout dependency between them.
- **Open questions:** None. This is recommended unless there is a delivery constraint that requires one document.

### F25. Bracketed gaps can still be sent accidentally

- **Relevant section:** 2, draft writing; Out of scope.
- **Priority:** P3.
- **Type:** Accessibility, usability.
- **Status:** Optional improvement.
- **Description:** Square-bracket placeholders are visible, but Outlook will not block Peter from sending them. They may be easy to miss in a long thread or when using a small screen or assistive technology.
- **Rationale:** The design deliberately uses gaps for high-risk decisions, prices, dates and attachments.
- **Impact:** An incomplete or awkward draft may be sent.
- **Recommended action:** Use a consistent first-line marker such as `[ACTION NEEDED: ...]`, include every gap in the run report, and consider a distinctive plain-text token that is easy to search. Do not rely on colour alone.
- **Open questions:** Would Peter prefer every incomplete draft to start with one consolidated action line rather than inline gaps only?

## Requirements that are already strong

- Jordan never sends. This removes the connector send failures and materially limits harm from drafting errors.
- The Planner code-removal inventory matches the current feature references found in `src/` and the migration is correctly retained as history.
- The rollout correctly places Planner removal after Jordan stops calling the bridge.
- A separate explicit approval for dropping the live table is appropriate.
- Fail-closed behaviour for a missing or unreadable ledger is correct in principle.
- The specification recognises stale drafts, last-message races, daylight-saving risk, local-runner availability and connector body size.
- Keeping message bodies out of the ledger and reports is a sound privacy boundary.

## Readiness assessment

**Overall:** Not ready for final approval.

**Planner code removal:** Nearly ready after the verification details in F23 are corrected. The current file inventory is accurate on `origin/main` at `c156575`.

**Jordan runtime and live handover:** Not ready. F01 to F04 are approval blockers. F05 to F14 must be designed and tested before a live handover.

**Database retirement:** Not ready to implement. The separate approval gate is correct, but the migration contract needs the safeguards in F12 and an executable restore path.

## Key required changes before approval

1. Define chain generations and a complete state-transition model.
2. Design idempotent Outlook-to-ledger reconciliation around partial failures.
3. Add reliable detection of Peter's existing drafts.
4. Split approval into evidence-based live-operation gates.
5. Define ID fallback, long-gap recovery, real process locking and edited-draft lifecycle.
6. Tighten automated-reply handling, recipient calculation and untrusted-email security rules.
7. Specify a guarded, reversible archive-and-drop migration.
8. Add a reproducible production proof, cutover runbook and rollback runbook.

## Unresolved decisions requiring Peter

1. Whether a restarted conversation creates a new ledger generation while retaining the ended generation.
2. Whether long outages should be caught up in chunks or stopped for manual recovery after 14 days.
3. What qualifies as an answering reply, especially acknowledgements and `I will come back to you` messages.
4. The exact working-day due time and whether England and Wales bank holidays count.
5. Which Peter aliases and recipient-copying rules apply to replies and chases.
6. Whether the Charlotte Brown rule is campaign-specific or applies to all drinks-brand mail.
7. Whether an edited Jordan draft remains observed for send/delete outcomes.
8. Whether the backfill task should be disabled for a week before deletion.
9. Whether the 67-thread handover requires a dry-run list and separate approval before drafts are created.
10. Which controlled conversations or accounts may be used for the two-draft production proof.

## Major risks

- Duplicate drafts after partial connector or ledger failure.
- Missed or resurrected work because conversation and chain are treated as the same identity.
- Wrong recipients from aliases, Reply-To behaviour or copied external parties.
- Silent missed mail after a long outage or partial pagination.
- Two routines running during cutover, or neither routine running after rollback.
- An incomplete archive or stale database dependency discovered only after the drop.
- Prompt injection or unrelated mailbox data entering a draft.

## Recommended next steps

1. Amend only the affected specification sections using F01 to F23. Do not start the live proof yet.
2. Create a developer implementation plan for deliverable A, the ledger and Jordan runtime, including the state model, reconciliation protocol, fixtures and rollback.
3. Review that plan and approve only the two-draft proof gate.
4. After the proof passes, run a read-only handover dry run and report exact counts, uncertain classifications and expected drafts.
5. Approve the live handover separately, observe the first day and first week, then approve Planner removal.
6. Draft and test the archive migration and restore procedure against a disposable database before seeking the separate live-drop approval.
