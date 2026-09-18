# Jordan drafts in Outlook, and Follow-ups leaves Planner

- **Date:** 18 September 2026
- **Revision:** 3. Rewritten after the developer review in `docs/superpowers/reviews/2026-09-18-jordan-outlook-drafts-spec-review.md` (findings F01 to F25), a three-way design panel on the runtime, and an adversarial check that every finding is closed. Peter's answers from his first review are recorded in the Decisions table.
- **Status:** approved by Peter on 18 September, with his answers recorded in the Decisions table. He asked for the whole of it to be implemented without stopping, so the gates run back to back: each gate's evidence is checked and recorded rather than paused on, and any failed check still stops the rollout (see "How the gates run").
- **Covers three separately approved parts:**
  - **Part A:** Jordan's new hourly drafting runtime, the proof and the handover from the tracker. It lives in `/Users/peterpitcher/Cursor/1 My Agents` and `~/.claude/scheduled-tasks/`.
  - **Part B:** removing Follow-ups from Planner's code.
  - **Part C:** archiving and dropping the `email_follow_ups` table.
- **After approval:** three linked plans are written in `docs/superpowers/plans/`, one per part (A covers gates G1 to G3, B covers G4, C covers G5). Each plan names its preconditions, gate and rollback, and links to the other two.

## In one paragraph

Jordan stops using Planner. Every hour from 07:30 to 17:30 on weekdays, it reads the Orange Jelly and Anchor inbox (peter@orangejelly.co.uk). It writes reply drafts straight into Outlook Drafts, threaded under the email they answer, and writes chase drafts for emails Peter sent that asked for something and have had no answer. Jordan never sends anything. That is enforced by tool deny rules, not just by the prompt. Peter reads, edits and sends from Outlook. If he deletes a Jordan draft, that thread's chain ends and Jordan leaves it alone. A small script on the Mac keeps Jordan's memory (the ledger), so hourly runs never repeat work or bring back what Peter deleted. Once the new loop is proven live, the Follow-ups page, its API, the machine bridge and then the table come out of Planner.

## What changed in this revision

| Finding | Where it is answered |
|---|---|
| F01 chain generations | A6, A7, Appendix 1 (M, DR and E rows) |
| F02 duplicate drafts after partial failure | A10, Appendix 2 |
| F03 finding Peter's own drafts | A9, A10 (the check just before creating) |
| F04 approval too broad | Gates G0 to G5 |
| F05 draft id permanence | A11 |
| F06 the 14-day cap | A13 |
| F07 lock not atomic | A12 |
| F08 edited drafts | A6 |
| F09 what closes an ask | A4, A5 |
| F10 recipients | A3, D11 |
| F11 untrusted email | A1, A4, proof items P9, P14 and P15 |
| F12 migration guards | Part C |
| F13 rollback | Rollback runbook |
| F14 repeatable proof | Proof checklist |
| F15 working days and deadlines | A5, A14 |
| F16 state machine | A7, Appendices 1 and 3 |
| F17 alert channel | A15 |
| F18 local privacy | A7, D26 |
| F19 pagination and bounds | A13, Handover |
| F20 reproducible file and task changes | A16 |
| F21 the Charlotte rule | A3, D12 |
| F22 monitoring | A15, D25 |
| F23 Planner checks | Part B |
| F24 split into three parts | Header, Parts A to C, Gates |
| F25 unfinished drafts sent by mistake | A3, D28 |

## Why

1. **One less step.** Today a draft is read in Planner, approved, then sent by Jordan at its next run, up to a day later. A draft in Outlook sits where Peter already reads and sends mail.
2. **Sending through the connector fails on real mail.** On 18 September both approved chases failed. One quoted a Gmail message that failed the connector's HTML check; the other carried attachments the connector cannot send. If Peter sends from Outlook, this class of failure goes away.
3. **Once a day is too slow.** An email that lands at 09:05 currently gets a draft the next morning.

## What discovery found

### Planner (checked on `origin/main` at c156575, re-checked at 59c39a3)

The feature shipped on 15 to 17 September (commits fb58617, 28a3c40, b0071b8). It is used only by these files:

| Kind | Path |
|---|---|
| Page | `src/app/email-follow-ups/page.js` |
| Component and test | `src/components/emailFollowUps/FollowUpList.jsx`, `src/components/emailFollowUps/__tests__/FollowUpList.test.jsx` |
| Session API | `src/app/api/email-follow-ups/route.js`, `src/app/api/email-follow-ups/[id]/route.js` |
| Machine bridge (Jordan calls it) | `src/app/api/cron/email-follow-ups/route.js` |
| Service and test | `src/services/emailFollowUpService.js`, `src/services/__tests__/emailFollowUpService.test.js` |
| Outlook link helper and test | `src/lib/outlookWebLink.js`, `src/lib/__tests__/outlookWebLink.test.js` |
| Shared files with a Follow-ups block | `src/components/layout/Sidebar.jsx` (lines 14 and 30), `src/lib/apiClient.js` (768 to 799), `src/lib/constants.js` (108 to 140, 266 to 273), `src/lib/validators.js` (3, 350 to 408) |
| Migration | `supabase/migrations/20260915000001_email_follow_ups.sql` |

- **Documentation refers to it.** Since PR #44 (18 September), `CLAUDE.md` describes the feature (line 72) and its environment variables (line 88). `docs/codebase-map.md` lists it on lines 13, 25, 43 and 83.
- **Nothing else refers to it.** No command palette, shortcut, search entry, `vercel.json` cron or middleware special case uses it. The README and `.env.example` do not mention it.
- **Its environment variables:** `EMAIL_FOLLOWUPS_USER_ID` and `EMAIL_FOLLOWUPS_USER_EMAIL` are read only by the bridge. Neither is in `.env.local`, so Vercel is the only place they can live.
- **Shared helpers stay.** The bridge uses `resolveDigestUserId` (also used by four other crons), `addDaysToDateKey`, `getLondonDateKey` and `verifyCronAuth`. The Waiting-task `follow_up_date` feature is unrelated.
- **Lint works.** `npm run lint` passes on Next.js 15.5 ("No ESLint warnings or errors", with a deprecation notice), checked on 18 September.
- **Branches.** The local branches `feat/follow-ups-tracker` and `feat/followups-table` are already merged into main, and no remote copies were found.
  - `feat/email-follow-ups` is 6 commits ahead of main. Its two security commits reached main through PR #43 as new commits (aa128d7, 3a62510, dab6b5a).
  - Its working tree also holds another session's uncommitted edits, plus this spec and its review, which are not yet committed.

**Live database** (planner-app, read on 18 September):
- The table matches the migration exactly: 22 columns, every constraint, index and trigger, and one policy.
- Live grants are ALL to `postgres`, `authenticated` and `service_role`, and none to `anon`.
- It holds 84 rows for one user, none linked to a customer.
- The last write was 18 September at 06:37 UTC, so the current Jordan still writes to it.
- No foreign key, view, function or publication depends on the table.

| State | No draft | Draft ready | Approved |
|---|---|---|---|
| Awaiting Peter | 43 | 8 | 0 |
| Awaiting them | 12 | 2 | 2 |
| Closed | 12 | 5 | 0 |

The 67 open rows carry 12 drafts: 10 ready and 2 approved.

**Resolved on 18 September by PR #43:**
- The anon security commits are now on main, including the drift test `supabase/__tests__/anon-access.test.js` and its list, `supabase/anon-access-allowlist.js`.
- Repo migration names now match live history.
- Part C can therefore use the normal `npx supabase db push`.

### Jordan today

- **The task.** `jordan-followups-loop` runs on cron `30 7 * * 1-5`, local time, from `/Users/peterpitcher/Cursor/1 My Agents`. Runs start 4 to 5 minutes after the cron time and last 30 seconds to 9 minutes. No two runs have ever overlapped.
- **Scheduled runs use bypass permissions**, on Opus, not the Sonnet named in `jordan.md`.
  - The `tools:` line in `jordan.md` does not apply.
  - Only the deny list in `1 My Agents/.claude/settings.json` is enforced; it blocked `curl` and a `.env` read in past runs.
  - So "only send what Peter approved" is currently a prompt instruction, not a control.
- **PushNotification has never reached Peter.** Five attempts all returned "not sent": either the terminal was active, or Remote Control was off.
- **Where the task is kept.** The prompt is in `~/.claude/scheduled-tasks/jordan-followups-loop/SKILL.md`. The schedule, title and enabled flag are held by the desktop app (`scheduled-tasks.json` under `~/Library/Application Support/Claude/claude-code-sessions/`) and are changed only through the scheduled-tasks tools. `enabled: false` pauses a task without deleting it. The tool documentation says a task due while the app is closed runs on next launch; this has not been observed.
- **The folder.**
  - `1 My Agents` is not a git repository.
  - Its settings deny `Edit(scripts/**)`, so Jordan cannot change its own scripts.
  - Python 3.12.8 with `zoneinfo` is available.
  - The disk is encrypted (FileVault on). Time Machine has no destination configured, so nothing backs up the folder.
  - The folder is local and not synced. Its directories and the run transcripts under `~/.claude/projects/-Users-peterpitcher-Cursor-1-My-Agents/` are readable by other local users (0755). No transcript retention is set, so Claude Code's default applies.
- **The Mac's clock** is checkable with `sntp time.apple.com`: an offset of +0.02 seconds was measured on 18 September.
- **Another routine chases some of the same mail.** `tasting-night-brand-chase` (Wednesdays 09:00, until 21 November) runs from the Planner folder. It handles the six drinks-brand threads for The Anchor's tasting night and sends only chases Peter approves. Deny rules in `1 My Agents` do not affect it.
- **Working hours.** `company/boss.md` records Peter's hours as 08:00 to 18:00, Monday to Friday.
- **A leaked secret.** The live `CRON_SECRET` appears in plain text three times in one local Jordan transcript (checked without printing it). Jordan will not need it after cutover, and rotating it is recommended.

**Addresses seen in about 5,200 messages** (sender and recipient fields only):
- **Peter's own address.** Everything Peter sends goes from peter@orangejelly.co.uk.
- **The Anchor's mail** arrives addressed to Anchor mailboxes: manager@the-anchor.pub on 1,268 messages, and also theteam@, peter@, info@, events@, ticket@, now@ and orders@.
- **App emails.** About 690 emails are sent as Peter by apps, to himself or to manager@.
- **Other Peter addresses:** peter.pitcher@outlook.com, thepitchersummers@gmail.com, and peter.pitcher@genmills.com (General Mills, out of scope).
- **Billy is someone else.** billy@orangejelly.co.uk belongs to Billy Summers. An unrecorded backfill rule that treated the whole orangejelly.co.uk domain as "self" is not carried over.

### Connector and harness facts (checked live on 18 September)

- **Search** lists a named folder (Inbox, Sent Items, Drafts, Deleted Items, Outbox) oldest or newest first, 25 per page, with a total count.
  - Each result has the Outlook id, the internet message id, subject, sender, one merged recipient list, dates and a 255-character preview.
  - It has **no conversation id**.
  - A mailbox-wide search can combine a text query with a start time.
- **Reading one message** returns:
  - its conversation id; To, Cc and Bcc separately; its folder; its draft flag; its internet message id; attachment details;
  - the full body, including the whole quoted history. A three-line reply came back as 80,000 characters.
  - It has **no created or modified time** and no headers.
- **A missing id** returns a structured `NOT_FOUND` error, which can be told apart from a transient failure.
- **Reply and reply-all drafts** are created threaded, with the quoted original, no signature and an `X-AI-Generated` header. Each call returns a draft id and an Outlook link. Whether the id survives a move is established by the proof, not assumed. There is no way to put a hidden marker in a draft.
- **Updating a draft** can change To, Cc, Bcc, subject or body; changing the body also replaces the quoted original.
- **Deleting a draft** moves it to Deleted Items. The connector refuses to delete anything that is not a draft.
- **Tool results** above a harness size limit are saved to a file; smaller ones enter Jordan's working memory in full. The limit is measured in proof item P16.
- **The Drafts folder** returned no results on the afternoon of 18 September.

### Similar solutions and what we borrow

This was researched on 18 September from product docs and Microsoft's Graph documentation. The products that do this well share four habits: they draft only for mail that needs a reply, keep at most one AI draft per thread, never send, and drop a chase once a real reply arrives.

| Product | What it does | What we take |
|---|---|---|
| [Fyxer](https://docs.fyxer.com/resources/support/faqs) | Drafts only for "to respond" mail; added controls after unused drafts piled up | Draft only where a reply may be needed; tidy stale drafts |
| [Inbox Zero](https://docs.getinboxzero.com/essentials/reply-zero) (open source) | Tracks to reply and awaiting reply; stores draft ids; [deletes an old AI draft only if its text still matches](https://raw.githubusercontent.com/elie222/inbox-zero/main/apps/web/utils/ai/choose-rule/draft-management.ts); weekends excluded | The ledger, the unchanged-text test, working days |
| [Superhuman](https://new.superhuman.com/automatic-reminders-306107) | Reminders return only if no reply arrives | Chases cancelled by a real reply |
| [Shortwave Ghostwriter](https://www.shortwave.com/blog/introducing-ghostwriter-ai-writing-that-learns-from-you/) | Learns greeting, sign-off and phrasing from sent mail | Style extract from Peter's recent emails |
| [FollowUpThen](https://help.followupthen.com/knowledge-base/response-detection-is-not-working/) | Misses replies when forwarding strips headers or a reply lands just before the chase | Re-check the thread just before each chase |
| Copilot in Outlook, Gmail | Draft only when asked; never send | Never send |

**Pitfalls designed against:**
- **Over-agreeable drafts.** [TechCrunch](https://techcrunch.com/2026/07/14/superhumans-new-auto-draft-feature-almost-makes-me-like-ai-replies/) found auto drafts accepting pitches and agreeing to meetings after midnight.
- **Drafts piling up.**
- **Missed replies.**

**Graph facts used:**
- API drafts carry no signature ([Microsoft Q&A](https://learn.microsoft.com/en-us/answers/questions/1811240)).
- Replies go to the Reply-To address if one is set ([createReply](https://learn.microsoft.com/en-us/graph/api/message-createreply)).
- Quoted "Sent:" times may be in UTC.
- Ordinary ids can change when a message moves ([message resource](https://learn.microsoft.com/en-us/graph/api/resources/message)).
- Exchange strips categories on send ([Slipstick](https://www.slipstick.com/outlook/email/sending-categories-on-email-messages/)).
- Hourly polling is far below Graph's limits.

---

## Part A: Jordan drafts in Outlook

### A1. Hard safety controls

1. **Tool policy: two explicit lists, allowed and denied.** Deny rules are enforced even under bypass permissions. The rules go in `1 My Agents/.claude/settings.json`, with the exact tool names taken from a run transcript at G1. They include the connector's server id, currently `mcp__ba79c6a1-9377-4e9f-8fc3-941768ab949f__`.
   - **Allowed, Microsoft 365 connector:** `get_me`, `outlook_email_search`, `read_resource`, `outlook_create_reply_draft`, `outlook_create_reply_all_draft`, `outlook_create_draft`, `outlook_update_draft` and `outlook_delete_draft`.
   - **Allowed, built-in:** Bash, Read, Glob, Grep, Skill, ToolSearch, Agent (for the writing helper) and PushNotification. The new prompt uses Bash only for the ledger script, `osascript` and `sntp`, but that limit is a prompt rule, not a deny rule. It has to be, because the old loop keeps using Bash (`node`) to reach the bridge until G3, and again after a G3 rollback. At G1, a check confirms the old loop's next run still reaches the bridge.
   - **Denied, Microsoft 365 connector:** every other tool. That includes send, send draft, forward, trash, untrash, batch delete, labels, folder moves, filters, vacation, every calendar tool, every Teams tool and every SharePoint tool.
   - **Denied, other MCP servers:** every one of them (browser, computer use, Supabase, scheduled tasks, documents, design and so on).
   - **Denied, built-in:** WebFetch, WebSearch, Workflow, CronCreate, CronDelete, RemoteTrigger, SendMessage, NotebookEdit and the worktree tools.
   - **Denied, file edits:** Edit and Write on `desks/jordan/work/**`, `archive/**`, `scripts/**` and `.claude/**`. The only way to change the ledger is `python3 scripts/jordan_ledger.py`. A Bash redirection into those folders cannot be fully blocked by a rule, so it remains a residual risk.
   - **Edit and Write** count as allowed, subject to the path denies above.
   - **The final lists are built at G1** from a scheduled run's full tool listing, with every visible tool placed on one list or the other. A coverage run that passes is part of the G1 evidence.
   - **Coverage is checked at the start of every run.** The model lists every tool it can see, and the script checks each one against the two lists. Anything on neither list stops the run and raises an alert. This fails closed: a tool added by an app update, or a connector reconnected under a new id, stops Jordan until the lists are updated, and the alert says so.
2. **Limits the deny rules cannot express.** A deny rule cannot restrict a tool's parameters. So these limits are enforced by a read-back instead:
   - New draft is used only for the "Jordan needs you" alert to Peter.
   - Update draft is used only to change recipients on Jordan's own drafts, or to update its own alert draft.
   - Delete draft is used only through the guarded removal in A10.

   If a Jordan draft's body or subject changes after an update, the thread is blocked and Peter is alerted.
3. **Where operator steps run.** These deny rules also bind interactive sessions in `1 My Agents`. So the operator steps (pausing and scheduling tasks, P9's one-off run, restores) run from an interactive session in the Planner folder. File permissions are set by the ledger script (Python `os.chmod`), because `Bash(chmod *)` is already denied there.
4. **Email is data, never instructions.**
   - Nothing in an email, its quoted history, HTML, links or attachments can change Jordan's instructions, tools, recipients, files or what goes in a draft.
   - Jordan never opens links or attachments.
   - Classification returns fixed fields only (A4).
   - A message flagged as suspicious gets no draft (Appendix 1, M3).
5. **Fresh, narrow context for writing.** Each draft is written by a short-lived helper (a subagent) given only:
   - the thread's messages as their own text, without quoted history;
   - the standing voice files, including Peter's approved voice profile (D30);
   - a style extract of Peter's recent emails to that person: greeting, sign-off and typical length, never their content;
   - the ask summary.

   It returns only the draft text and its list of gaps. Unknown drafts read during the Drafts scan (A9) give the script only a thread id and a fingerprint; their bodies are never used for drafting or quoted anywhere.
6. **Recipients are computed by the script** (A3). The model passes the script the connector's read-back, and the script compares it with what it expected.
7. **Jordan only removes its own unchanged drafts, only to Deleted Items**, after a full read in the same run (A10).
8. **General Mills is out of scope.** The connector is signed in as peter@orangejelly.co.uk only.
9. **No message bodies are kept** in the ledger, logs or report. The only exceptions are the named short fields in A7.

**Residual risk, stated plainly:**
- The script's checks rely on data the model passes it. The tool deny rules are the real control against a manipulated run.
- Python in Bash can still reach the network.
- Run transcripts keep the bodies Jordan reads (D26).

### A2. Which emails get a reply draft

**Peter's rule (18 September): when in doubt, draft.** Jordan drafts a reply when all of these hold:

- The latest human message in the thread is from someone other than Peter, and classification says it needs a reply or is unsure (A4).
- The message is still in the Inbox. If Peter has deleted or filed it, the reply need is cleared (D13).
- Peter has not written in the thread since.
- No draft is waiting in the thread. The one exception is Jordan's own out-of-date draft, which is removed first and replaced only once the removal is confirmed (A10).
- The thread's latest generation is active (A6).
- The thread is not owned by another routine. The ledger holds routine ownership as a subject prefix plus an expiry date, and the script releases the thread on that date. Today it holds one entry: "Anchor Stanwell Moor - Tasting Night 20th Nov", owned by `tasting-night-brand-chase` until 21 November 2026. A new human message on an owned thread only gets a report line.

Jordan does not draft for:
- automatic or bulk mail;
- suspicious mail;
- anything containing card numbers, passwords or API keys (flagged in the report, never quoted).

Mail that is Peter's decision (money, a relationship call, legal, HR) still gets a draft, with the decision left as a gap.

### A3. How drafts are written

**Voice.**
- Voice comes from `company/voice.md` and the `draft-reply` shape: answer first, match the length of their message, name the next step.
- "Brand" means which business the email is about: Orange Jelly (the consultancy) or The Anchor (the pub). It changes the tone and what Jordan knows, not the sign-off.
- **Peter's voice profile (D30).** This is a short file, `1 My Agents/company/peter-email-voice.md`, with an Orange Jelly section and an Anchor section. It covers Peter's usual openings and sign-offs, phrases he uses, his tone with clients, suppliers and staff, and things he never says.
  - **How it is made:** a one-off, read-only analysis at G2 of about 50 recent emails Peter wrote himself. It leaves out app-generated mail (emails only to his own or team addresses, or with known app subjects) and any sent email that began as a Jordan or tracker draft, so Jordan never learns from itself.
  - **What it may contain:** short phrases only, with no names, prices or email content.
  - **Approval:** Peter edits and approves it before G3, and it is refreshed every three months with his approval.
  - **How it is used:** the writing helper reads it for every draft, together with the per-person style extract.

**Never invent or agree.** A draft never contains an invented price, date, time, contact detail or commitment. It never says yes on Peter's behalf: no accepting a meeting time, an offer or a request.

**Unfinished drafts (F25, D28).**
- Every gap in the text uses the fixed form `[FILL: what is needed]`.
- Any draft with a gap, an attachment to add or a recipient warning starts with one line: `[ACTION NEEDED: 1. price for 40 covers; 2. attach the Christmas menu; 3. check recipients: 14 people copied]`. The line lists every gap, attachment and warning, in order.
- The script counts the `[FILL:` markers and refuses a draft whose count differs from the line.
- The run report repeats each ACTION NEEDED line.
- `FILL` and `ACTION NEEDED` can both be found with Outlook's search.

**Sign-off.** "Thanks, Peter", with no signature block (D1).

**Recipients (F10, D11):**
- **Peter's addresses and team addresses** are fixed, lower-case lists in the ledger. Matching ignores case. Duplicates are removed, keeping an address in To over Cc. Bcc is never set or inferred.
- **Replies** use the connector's reply draft, which goes to the sender or their Reply-To. Reply-all is used only when the target message's own To or Cc (from a full read) holds people other than Peter, the sender and team addresses. Team addresses already on the target stay on it, but never trigger reply-all by themselves.
- **Every draft is read back.** The script compares To, Cc and Bcc with what it expected:
  - Peter's own addresses are removed with a recipients-only update, then the draft is read again.
  - **Reply-To is the one allowed difference, recognised by an exact rule.** It applies to a plain reply draft (not reply-all) whose To is exactly one address that is not the sender, and whose Cc and Bcc match what was expected. That draft is kept, and the run report and the alert draft say "Reply-To: the draft to <sender> is addressed to <address>". The warning cannot go into the draft itself, because changing a body after creation is not allowed (A1). A read gives no headers, so this rule is the only way to tell a Reply-To apart.
  - Any other difference blocks the thread (reason `recipients`) and alerts Peter. Jordan removes the draft if it is still unchanged.
  - The "Jordan needs you" alert draft is exempt, because it is addressed to Peter.
- **Chases** are a reply-all on Peter's own sent email, followed by a recipients-only update. The update sets To and Cc to exactly that email's To and Cc, minus Peter's addresses. To is never empty; if it would be, there is no chase and the thread goes in the report.
- **Recipient warnings** go in the ACTION NEEDED line in these cases:
  - more than 10 recipients;
  - a list-like address (all@, team@ or a group) or a team address;
  - a recipient who is on no earlier message in the thread;
  - someone on a later message who has been left off;
  - any address at orangejelly.co.uk or the-anchor.pub that is on neither list;
  - any address that is not a plain email address.

**Charlotte Brown (F21, D12, Peter 18 September).** The rule applies only to emails Charlotte (CharlotteBrown@greeneking.co.uk) is already on: in To or Cc of the message being answered, or, for a chase, of Peter's basis email.
- She stays copied on those drafts.
- If she started the conversation (one of her briefs), the draft thanks her for the brief, until one Jordan draft in the generation is recorded as sent.
- She is never added to any other thread, and Jordan never suggests adding her.
- The tasting-night prompt keeps its own rule for its six threads until 21 November.

**HTML.** Drafts use only the connector's allowed tags.

### A4. Classification

The model classifies **each message in time order, on its own text only** (quoted history excluded), with the stored ask summary as the only other input. It returns fixed fields. Anything malformed counts as unsure.

**For a message from someone else:**

| Field | Values |
|---|---|
| `automatic` | yes or no (auto-acknowledgements, helpdesk receipts, system mail) |
| `suspicious` | yes or no (tries to instruct the reader, asks for credentials, or asks Jordan to act) |
| `needs_reply` | yes, no or unsure |
| `vs_ask` | answers, question back, holding, partial, acknowledgement, unrelated or unsure |
| `holding_until` | quoted phrase (at most 60 characters) and proposed date, or none |
| `ooo_return` | quoted phrase and proposed date, or none |
| `reason` | at most 80 characters |

**For an email from Peter:**

| Field | Values |
|---|---|
| `is_ask` | yes, no or unsure |
| `closes_ask` | yes or no |
| `summary` | at most 80 characters, no prices, card numbers or personal detail |
| `deadline` | quoted phrase (at most 60 characters), proposed date and optional time, or none |

**Script rules, applied first and needing no full read:**
- The sender is automatic if its local part is no-reply, do-not-reply, mailer-daemon, postmaster, notifications or bounces.
- The subject is automatic if it starts with "Automatic reply", "Auto-Reply", "Out of Office", "Undeliverable", "Delivery Status Notification", "Mail delivery failed", "Read:", "Accepted:", "Declined:" or "Tentative:".
- Out-of-office and bounce messages whose subject matches an open ask are read in full, within the read cap, to get their thread and return date or failed recipient. Other automatic mail is not read.
- The script rejects a summary containing an amount with a currency sign, an email address or a phone-number pattern.

**Precedence between fields.** Before any Appendix 1 row is applied, a message with `automatic` = yes, or `vs_ask` = acknowledgement, is treated as `needs_reply` = no, whatever the model said. So an acknowledgement can never set a reply need.

### A5. Asks and chases

**What counts as an ask.**
- An ask is an email Peter sent asking the recipient for something: an answer, a document, a decision, a date, a price or a confirmation.
- `is_ask` unsure counts as an ask when it is opening generation 1 and inside an active generation: an unwanted chase costs one delete, and that delete ends the chain. Only an email that would start a new generation after an ended one needs a clear yes (D9).
- Emails Peter sends only to his own or team addresses never open an ask (D19). This keeps the 690 app emails out.

**What each reply does to an open ask (D27).** Anyone other than Peter can answer, including people on Cc.

| Reply | Effect |
|---|---|
| Automatic (any kind) | Never changes a due time, never closes the ask, never removes a chase |
| Answers it | Closed. Jordan removes its unchanged chase draft |
| Question back | Closed, and a reply is needed. Jordan removes its unchanged chase draft |
| Partial answer | Treated as holding, and flagged in the report |
| Holding (an explicit promise to come back) | Stays open. Due is recalculated from the holding reply. Jordan removes its unchanged chase draft |
| Bare acknowledgement ("thanks, got it") | Unrelated: no change |
| Out-of-office with a return date | Stays open. If the script and the model agree on the return date, due moves to 07:00 on the first working day after it, when that is later |
| Bounce naming a recipient of the ask | Ask blocked (reason `bounce`), with a "needs you" line |
| Unrelated or unsure | No change. Unsure is flagged |

**Due dates (F15).** The script works out every due date in Europe/London, and stores instants in UTC.

- **Working days** are Monday to Friday, excluding England and Wales bank holidays.
  - The bank holidays come from `scripts/bank_holidays_england_wales.json`, a copy of gov.uk's data for 2026 to 2028.
  - From 1 November each year, every run alerts if next year's holidays are missing.
  - The script refuses to calculate a date beyond the file and alerts instead.
- **Default (D5):**
  - Take the London date of Peter's email. The sending day never counts.
  - The chase is due at 07:00 London on the third working day after it, so the 07:30 run picks it up.
- **A deadline in Peter's email** is used only when the script's own parse of the quoted phrase agrees with the model's date. When it is used:
  - a date alone makes the chase due at 07:00 on the first working day after that date; a date with a time makes it due at that moment;
  - it replaces the default, whether earlier or later.
- **Later emails from Peter in the same thread:**
  - **An ask** (yes or unsure, including a chase he sent) becomes the new basis for the ask. Its due time is its own agreed deadline, or the default from that email. Any earlier deadline is dropped, so a passed deadline can never make a chase due again straight away.
  - **Not an ask:** the basis (and so the chase recipients) and any agreed deadline are kept. Only the default restarts from this email. If the kept deadline has already passed, the default from this email applies.
  - The due time is always later than Peter's latest email in the thread.
- **When the deadline is not used:**
  - An agreed deadline at or before the send time falls back to the default and is reported. It is never an error.
  - A disputed or vague phrase uses the default and is reported (D29). The ledger keeps the phrase, the parsed instant in UTC and whether the two agreed.
- **Holding replies:** a stated date is used only when the script and the model agree. The chase is then due at 07:00 on the first working day after that date. Otherwise it is due 3 working days after the holding reply.

**Phrases the script parses** (anything else is vague):

| Form | Rule |
|---|---|
| Weekday name ("Thursday", "by Thu") | The next such day strictly after the send date. The same weekday as the send day is always vague. "next Thursday" is vague |
| today, tomorrow | Relative to the send date |
| "5 January", "5 Jan 2027", "the 30th" | A year-less date takes the next occurrence on or after the send date. More than 6 months ahead is vague |
| A time ("2pm", "14:00") | Only with one of the forms above, and taken as UK time |
| Numeric dates (30/9), "end of the week", "EOD", any other time zone | Vague |

**Worked examples:**

| Case | Working days counted | Chase due |
|---|---|---|
| Fri 18 Sep 2026, 19:40 | Mon 21, Tue 22, Wed 23 | Wed 23 Sep, 07:00 |
| Thu 27 Aug 2026, 11:00 | Fri 28, (Mon 31 Aug bank holiday), Tue 1, Wed 2 | Wed 2 Sep, 07:00 |
| Wed 23 Dec 2026, 11:00 | Thu 24, (Fri 25 and Mon 28 bank holidays), Tue 29, Wed 30 | Wed 30 Dec, 07:00 GMT |
| Fri 23 Oct 2026, 16:00 BST (clocks go back on Sun 25) | Mon 26, Tue 27, Wed 28 | Wed 28 Oct, 07:00 GMT (07:00 UTC) |
| Fri 23 Oct 2026, 00:30 BST (Thu 23:30 UTC) | The London date is Friday | Wed 28 Oct (using the UTC date would wrongly give Tue 27) |
| "Can you confirm by Thursday?", sent Mon 21 Sep | Deadline Thu 24, agreed | Fri 25 Sep, 07:00 |
| "by Thursday", sent Thu 24 Sep | Same weekday: vague | Default: Tue 29 Sep, 07:00; phrase reported |
| "by tomorrow", sent Mon 21 Sep | Deadline Tue 22, agreed | Wed 23 Sep, 07:00 |
| "by 2pm Tuesday", sent Mon 21 Sep | Tue 22 at 14:00 | Drafted by the 14:30 run |
| "by 9am today", sent Mon 21 Sep at 10:00 | Deadline before the send | Default: Thu 24 Sep, 07:00; reported |
| Holding reply Wed 23 Sep, no date | Thu 24, Fri 25, Mon 28 | Mon 28 Sep, 07:00 |
| Holding reply Wed 23 Sep, "I'll come back to you on Friday", agreed | Fri 25 | Mon 28 Sep, 07:00 |

The bank-holiday rows are checked against gov.uk when the data file is written.

**Chasing.**
- **Re-check first.** Just before drafting a chase, Jordan re-checks the mailbox for any message in the thread after Peter's email. It runs a mailbox-wide search by subject from that time (at most 2 pages), then reads up to 5 candidates to confirm the thread. If a cap is reached or the search fails, there is no chase this run.
- **One at a time.** There is only ever one chase draft per thread.
- **When it stops.** The ask stays open until someone answers it. Chases continue for as long as the ask is open; the chain itself ends only as described in A6. There is no fixed limit on chases.
- **Replies come first.** When a reply is needed, it takes priority over a chase and restates the open ask.

### A6. Chains, generations and how a chain ends

**Peter's rule (18 September): if he deletes a Jordan draft, that is the end of that chain.**

**Keys (F01).**
- A **thread** is one Outlook conversation, keyed in the ledger by the conversation id from a full read. The subject is for display and search only.
- A **chain** is one episode in a thread, called a generation and addressed as conversation id plus number (1, 2, 3 and so on). Intents, journal entries and reports use that pair.
- Only a thread's latest generation can be active. Generation numbers only go up. A thread record is never deleted.

**What opens generation 1:** a human message that needs a reply (yes or unsure), or an ask from Peter (yes or unsure), in a thread with no generation. The handover also opens generations.

**What ends a generation.** Nothing else does:
- **Deleted.** A draft Jordan created, whether Peter edited it or not (D10), is found in Deleted Items, Jordan did not remove it, and there was no qualifying takeover (below).
- **Gone.** That draft cannot be found anywhere. Two complete recovery searches at least 45 minutes apart both find nothing, Peter has sent nothing in the thread since the draft was last seen, and ingest has passed the moment it went missing (A11).

A quiet thread, an answered ask, or an inbound email Peter filed never ends a chain. A draft that goes missing while Peter has emailed in the thread since it was last seen does not end the chain either. That is most likely Peter sending or replacing it, perhaps with an id the connector cannot match, so the draft is recorded as superseded and the chain carries on as his reply (A11). Only positive evidence of deletion (the draft in Deleted Items), or a draft gone with no activity from Peter, ends a chain.

**The watermark is measured in mailbox time, not on the Mac.** It is the listing horizon (A13) at the end of the last run that saw the draft in Drafts. A draft Jordan creates during Act counts as seen at its intent's listing horizon. Everything up to the watermark had been listed before Peter deleted. When a run's clock could not be verified, its horizon is capped at the newest mailbox time it saw (A14).

**Every ending uses the same procedure (E1 in Appendix 1), in this order:**
1. **Split first.** Any reply need whose message is after the watermark, and has `needs_reply` = yes, moves into a new generation with its basis intact. So does any ask whose basis is after the watermark and has `is_ask` = yes. This covers a new message that arrived in the same hour Peter deleted. Items after the watermark that are only unsure do not move; they get the report line "X wrote again on a thread you ended; no draft made". This gives the same result whether the deletion is noticed in the same run as the new message or in an earlier one.
2. **Out-of-date edited drafts (D23).** If the deleted draft was Peter-edited, and a newer human message with `needs_reply` = yes had arrived that the draft did not answer, that message also moves into the new generation.
3. **Then end what remains.** The ask becomes `ended`: its summary and recipients are cleared and its chase count is kept. The reply need, the draft slot and any pending operation are cleared.
4. Any draft Peter wrote himself moves to the thread's Peter-draft list. It still blocks drafting.
5. The end is recorded: when, why, the watermark and which draft ended it.

**What restarts a chain after it has ended (D9).** Only one of these, received after the watermark, opens the next generation:
- a human message with `needs_reply` = yes;
- an email from Peter with `is_ask` = yes.

An unsure message on an ended thread gets a report line ("X wrote again on a thread you ended; no draft made"), not a draft.

**Takeover.** This applies only when the draft is found in Deleted Items, Jordan did not remove it, and Peter has emailed in the thread since the draft was last seen.
- If that email is an ask (yes or unsure) to someone outside his own and team addresses, deleting the draft does not end the chain. Peter has taken it over, and his ask is chased in the usual way.
- Any other email from Peter (a thanks, or a note only to the team) does not count. The deletion ends the generation, with the watermark set to the later of the last listing horizon and that email.

**Edited drafts (F08).** A Jordan draft counts as edited, for good, if any of these differs from what Jordan recorded:
- the text fingerprint;
- To, Cc or Bcc;
- the subject;
- whether it has attachments.

Once edited, Jordan never changes or removes it. It keeps observing it, and updates its last-seen time and preview fingerprint every run.

| What happens to Peter's edited draft | Result |
|---|---|
| He sends it | Treated as Peter's email. If it is an ask, the chase clock starts |
| He deletes it | The generation ends (D10), with D23 carry-forward, unless the takeover rule applies |
| It vanishes altogether | With no email from Peter, the generation ends after the second check (gone). If he has emailed in the thread, it is recorded as superseded and the chain carries on |
| He leaves it | It blocks new Jordan drafts in the thread. A new message from them adds a daily 07:30 report line: "X wrote again; your edited draft still waits. Deleting it ends this chain", followed by either "but X's newer message would still get a draft" (when that message clearly needs a reply) or "and no draft will follow" (when it is only unsure). If an ask closes while it waits, the line says the chase is now out of date |
| He files it elsewhere | Recorded as filed. It is no longer observed and no longer blocks. The reply need is cleared; the generation stays active; a later deletion has no effect |

**Drafts Peter writes himself:**
- They are never touched, and they block Jordan drafting in their thread, at any age. The Drafts scan has no date filter.
- If one has blocked something due for 10 working days, it is listed in the Monday 07:30 report.
- If Peter deletes his own draft and a reply is still needed, Jordan drafts it (D18).
- If Peter starts his own draft in a thread where Jordan's unchanged draft is waiting, Jordan removes its own draft through the guarded removal and reports it (D21).

**A draft that comes back.** A Jordan draft from an ended generation, or any recorded draft, that reappears in Drafts is treated as Peter's own draft. It blocks drafting, never reopens anything, and never counts as a second Jordan draft.

### A7. The ledger

**Files.** All of these live in `"/Users/peterpitcher/Cursor/1 My Agents/desks/jordan/work/"`; the path has a space, so it is always quoted.

| File | Purpose |
|---|---|
| `ledger.json` | Current state. Written to a unique temporary file, flushed, renamed over the old file, then the folder is flushed. Its version number goes up on every write |
| `ledger.journal.jsonl` | Every change, appended and flushed before the snapshot. On load, entries newer than the snapshot are replayed. Emptied after each successful backup |
| `backups/ledger-<UTC time>.json` | A copy after every successful run; the last 14 are kept. Fixed copies are kept separately in the archive (A16) |
| `jordan.lock`, `jordan.lock.guard` | The run lock and the write guard (A12) |
| `lock-status.json`, `alerts.json` | Busy and foreign-lock counts, and alert state. They work even when the ledger or lock cannot (A12, A15). Written atomically, with their own short file lock |
| `log/runs.jsonl` | One "started" and one "finished" line per run, with counts only (A15). Kept for 90 days |
| `.key` | A local secret for hashing addresses. Never leaves the folder |

**Permissions (F18).**
- The script sets umask 077.
- Every folder under `work/` and the archive folder must be 0700 and every file 0600, checked recursively when the ledger loads.
- A wrong permission stops the run and raises an alert. It is never silently fixed.
- The disk is encrypted, and there is no Time Machine or sync copy. If a backup destination is added later, this folder is excluded or the backup must be encrypted.

**Model and script (F16).** The model never edits the ledger and never chooses a transition. The script `scripts/jordan_ledger.py` (Python standard library only) is the state machine. Its interface, with JSON on standard input and output:

| Command | Does | Exit codes |
|---|---|---|
| `init --checkpoint <ISO> --mode live\|proof` | Creates a ledger. Refuses if any ledger, journal or backup exists | 0, 40 |
| `clock` / `clock --verify <newest mailbox time>` | Checks the system time zone is Europe/London and the `sntp` offset is at most 2 minutes. If the time server cannot be reached, `--verify` checks the Mac is not behind the newest mailbox time seen (A14) | 0, 21, 23 |
| `lock --mode hourly\|handover` / `heartbeat` / `unlock` | The lock (A12). `unlock --force` is interactive only and journalled with the operator | 0, 10 busy, 11 foreign |
| `load` | Replays the journal and checks permissions, invariants and the coverage of tool names | 0, 20, 22 |
| `scan`, `index`, `ingest`, `observe`, `reconcile` | Take listing and read results with classifications, apply Appendix 1 rows, save after each | 0, 3, 30, 40 |
| `plan` | Returns the next actions, with the expected fingerprint and recipients | 0 |
| `intent`, `commit` | Record an operation before and after the connector call | 0, 3, 30 |
| `fp`, `extract`, `due` | Fingerprint; pull fields from an oversized saved result; due date calculation | 0, 40 |
| `report`, `finish` | Report text; backup, journal truncation, metrics, alert update | 0 |
| `resolve <thread> adopt\|not-created\|end\|unblock` | Interactive only, journalled with the operator; the only way out of `ambiguous` and some other blocks | 0, 40 |
| `proof-due <thread> <ISO>` | Proof mode only; refused on a live ledger | 0, 40 |

Exit codes: 3 is a lock-token mismatch; 20 an invalid ledger; 21 a clock or time zone problem; 23 the time server unreachable (A14); 22 a permissions problem; 30 a refused write that would break an invariant; 40 bad input. The model stops making connector calls on any exit code other than 0, except code 23, which allows only the steps in A14. The exact JSON schema is written as `scripts/jordan_ledger.schema.json` in Plan A; the field names below are normative.

**Top level:**
- `schema`, `version`, `mode` (live or proof)
- `peter_addresses`, `team_addresses`
- `routine_owners`: each entry is a subject prefix, a routine name and an expiry date
- `folders`: the ids of Inbox, Sent Items, Drafts, Deleted Items and Outbox
- `checkpoint`: never defaulted; it is set by `init`
- `seen`: processed messages, as internet message id to thread and time, pruned 14 days behind the checkpoint
- `skipped`: messages that could not be read, with a retry count; pruned after 30 days
- `drafts_scan` and `drafts_index`: draft id to internet message id, thread, first seen and last seen
- `alert_draft`: id, internet message id and fingerprint of Jordan's alert draft, kept outside the draft index
- `budget`: this run's reads and characters
- `threads`

**Per thread:**
- `subject_n`: normalised, at most 120 characters
- `next_gen`
- `known_drafts`: every draft ever tracked there, with its fate (sent, removed by Jordan, deleted, filed or superseded)
- `peter_drafts`
- `generations`

**Per generation.** Each concern is a separate field, not one combined state:

| Field | Holds |
|---|---|
| `status` | active or ended |
| `opened` | when, which message, and the cause (inbound, Peter ask, handover or carry-forward) |
| `reply` | needed or not, for which message, and what cleared it |
| `ask` | status (open, answered, cancelled or ended); summary; basis email; due instant and the rule used; deadline phrase, parsed instant and whether agreed; blocked reason; chases drafted |
| `draft` | id, internet message id, purpose (reply or chase), owner (Jordan or Peter-edited), text and preview fingerprints, recipients, subject, attachment flag, when made, last-seen horizon, location (Drafts, Outbox or missing), missing checks, and a "removed by Jordan" mark |
| `pending` | an operation in progress (A10) |
| `blocked` | reason (duplicates, failures, bounce, missing, ambiguous or recipients) and since when |
| `end` | when, why, the watermark and which draft ended it |

**Addresses.**
- Plain addresses are kept only where they are needed to act: an open ask's basis email and a live draft's recipients.
- Everywhere else (`seen`, `skipped`, `known_drafts`, ended generations) an address is kept only as a keyed hash made with `.key`.
- Display names are never kept.

**Never stored:** message bodies, attachment names or quoted history. The only text kept is the named short fields: summary (at most 80 characters), deadline, holding or return phrase (at most 60, cleared when the ask closes), reason (at most 80) and subject (at most 120).

**Pruning (D15):**
- **Active generations are compacted, never removed.** An active generation with nothing outstanding for 30 days has its answered-ask summary and references cleared (nothing outstanding means no reply need, no open ask, no draft, no Peter draft, no pending operation and no block). It stays the thread's latest generation, so a later message follows the active-generation rules rather than the ended ones.
- **Ended generations** are shrunk after 90 days to number, end time, reason and watermark, and kept for good.
- **Old threads.** Once every generation in a thread has been ended for 90 days, the thread keeps only its id, `next_gen` and those shrunk generations.
- **Thread records** are never deleted, so generation numbering never restarts.

**If the ledger is missing, corrupt, fails its checks or has wrong permissions,** the run stops before any connector call and alerts. Jordan never rebuilds the ledger from the mailbox, because that would forget which chains Peter ended. Restoring it from the latest backup plus the journal needs Peter's yes.

### A8. The hourly run

1. **Start.** In this order, which matches the run-level rows in Appendix 1:
   1. Run `clock` (A14).
   2. Take the lock (A12).
   3. Run `load`.
   4. Check every visible tool against the tool policy (A1).
   5. Write the "started" metrics line.

   Any failure stops the run with no connector calls, apart from the limited clock fallback in A14.
2. **Drafts scan (A9).**
   - Index every draft.
   - Match each draft to the ledger by internet message id first, then by Outlook id.
   - A draft in a thread with a pending operation stays unattributed for now.
3. **Ingest (A13).**
   - List Inbox and Sent Items from the checkpoint and merge them into one stream in time order, up to the listing horizon.
   - Classify each message and apply its row in Appendix 1, saving after each one.
   - A message that cannot be read is set aside in `skipped` and ingest carries on. When a skipped message is retried later, its row is applied in its true time position against the Peter emails already known. It can never become a reply target if Peter has emailed in the thread since.
   - A message whose row would break an invariant is also set aside in `skipped`, with a report line and an alert. The run carries on; it is not stopped by one bad message.
4. **Reconcile** operations left pending by earlier runs (A10). This runs after ingest, so Peter's latest emails are already known. When reconciliation adopts a draft, the script re-applies the removal step of M13 for every email from Peter in that thread after the intent's horizon. So an adopted draft that Peter has already overtaken is queued for guarded removal in the same run.
5. **Observe** every tracked draft (A11). Apply the D rows and the ending procedure. Save after each change.
6. **Act**, within the caps in A13. Blocked, owned or ended threads are skipped.
   - **First, guarded removals.** These may run even when the Drafts scan is incomplete, because each one has its own full-read check (A10).
   - **Then replies, oldest first, then chases, earliest due first.** Each goes through A10. Creating a draft needs all three of these:
     - the Drafts scan was complete, with no unread ids;
     - the listing horizon reached the run's start;
     - the read and character budget is reserved.
7. **Finish.** Back up, empty the journal, update alerts, write the "finished" metrics line and the report, and release the lock.

**The report** is the run's final message in the scheduled run, visible in the app's Runs pane. It has no bodies. It lists:
- a health line: checkpoint age in scheduled slots, scan status, open alerts;
- replies and chases drafted (who and subject);
- every ACTION NEEDED line;
- chains Peter ended;
- "needs you" items;
- anything skipped or failed.

The 07:30 run also adds the daily lines for blocked items, and on Mondays the 10-working-day list.

### A9. Drafts folder scan (F03)

- **Every run lists the whole Drafts folder** newest first, 25 per page, until the count reaches the folder total. The limit is 40 pages (1,000 drafts) plus one rescan. This limit is separate from the listing caps in A13.
- **The scan is complete only if** the total is the same on the first and last page, the number of distinct ids equals the total, and page 1, listed again at the end, holds the same ids as it did at first. Otherwise Jordan rescans once. If the scan is still incomplete, no draft is created anywhere in that run; reading, observing and guarded removals continue. Three incomplete scans in a row raise an alert.
- **Each unknown draft id is read once** to learn its thread, up to 25 reads per run. These reads are outside the 40 message reads. While any listed id is unread, no draft is created anywhere in that run.
- **Ownership comes only from the ledger.** An unknown draft in a thread with no pending operation is Peter's own draft (Appendix 1, row DR11).
- **Just before each create,** Jordan lists page 1 of Drafts and page 1 of Sent Items again, newest first, and reads any id it does not know. The create is skipped if either of these holds:
  - a draft in the target thread, or one that cannot be read;
  - an email from Peter in the target thread since the listing horizon.
- **The alert draft is exempt** from the scan and page-1 guards. It is its own conversation, addressed to Peter.
- **Residual risk:** a draft Peter starts in the seconds before a create, or one Outlook desktop has not yet saved to the server, can still be missed.

### A10. Creating, updating and removing drafts safely (F02)

**Before a draft is created, all of these hold:**
- The target is still in the Inbox (or, for a chase, is still Peter's basis email).
- Peter has not emailed in the thread since the target.
- This run's scan is complete, and no draft is indexed in the thread.
- The page-1 checks in A9 are clean.
- Two reads, and enough characters for two copies of the thread at its known size, are reserved for the read-backs.

**Creating a draft, in stages, saving after each.** A stage that is already recorded is never repeated:
1. **Intent.** Record the operation, the thread and generation, the target, the expected fingerprint and recipients, the listing horizon and the time. If this save fails, no call is made.
2. **Call** the connector once. Never retry in the same run.
3. **Created.** Save the returned draft id.
4. **Read back.** Record the internet message id, fingerprints, recipients, subject and attachment flag.
5. **Addressed.** For a chase, set the recipients. For any draft, remove Peter's own addresses (A3). Then read back again. This stage is skipped if nothing needs changing.
6. **Baselined.** Record the final state and clear the intent.

**Outcomes:**
- **A definite refusal** clears the intent and counts a failure. Three failures block the thread (reason `failures`).
- **A refused recipients update** blocks the thread (reason `recipients`), adds "check recipients before sending" to the report and alerts Peter.
- **A timeout, server error, rate limit or unclear result** marks the intent `ambiguous` and blocks the thread.

**Candidates for reconciliation.**
- **What a candidate is:** any draft or sent email in the thread that the ledger does not know, found inside the search window.
- **Where they are found:** this run's Drafts index, plus Deleted Items, Outbox and Sent Items, each listed newest first from 15 minutes before the intent, up to 4 pages.
- **Confirming a candidate:** each one is read to confirm it is in the thread. Any page error, or reaching the read cap, makes the lookup incomplete.
- **Classing a candidate against the text Jordan intended:**
  - **matching:** the fingerprint is equal;
  - **similar:** at least half of the intended text's five-word sequences appear in it, so it is Jordan's text edited by Peter;
  - **unrelated:** anything else, which is Peter's own writing.
- **What is left out of the match:** recipients and creation time. The connector gives no created time, and Peter may have changed the recipients. The bounded search window serves as the creation window instead.

**Reconciliation on the next run.** Rows are checked in order, and the first match wins:

| # | Found | Result |
|---|---|---|
| R1 | The intent already holds a draft id | Read it by id and resume at the next unfinished stage. If its text is unchanged and its recipients equal the intent's expected final recipients, it is baselined as Jordan's. The removal step of M13 is then re-applied, and if Peter has emailed in the thread since the intent, any unfinished recipients stage is skipped and the draft is queued for guarded removal. On `NOT_FOUND`, it becomes a tracked draft and follows A11 (missing, gone, takeover). An intent holding a draft id is never "not created" |
| R2 | In Sent Items, a matching or similar candidate sent by Peter | Treated as sent (Peter sent Jordan's draft) |
| R3 | Any matching or similar candidate in Outbox | Wait. The thread stays blocked |
| R4 | Two or more matching or similar candidates in Drafts | Blocked (reason `duplicates`). Nothing is adopted or deleted, and the links are reported. Candidates in Deleted Items are not counted. The block clears when one or none remain in Drafts |
| R5 | Exactly one matching candidate in Drafts | Adopted as Jordan's. The removal step of M13 is re-applied (A8 step 4) |
| R6 | Exactly one similar candidate in Drafts | Adopted as Jordan's draft with owner Peter-edited, so D10 applies. Reported. The removal step of M13 is re-applied |
| R7 | None in Drafts, and one or more matching or similar candidates in Deleted Items | Judged by the takeover rule (A6), with the intent's listing horizon as the watermark. Without a qualifying takeover, the generation ends (deleted) |
| R8 | Only unrelated candidates | They are Peter's own drafts or emails (DR11, M13). The intent is still unresolved, so R9 or R10 applies to it |
| R9 | Nothing Jordan-like found, every lookup complete | Counted. After two runs at least 45 minutes apart, recorded as not created, and drafting is allowed |
| R10 | A lookup failed or was incomplete | Stays `ambiguous`. After 3 runs, "needs you", and `resolve` is named in the report |

**Guarded removal.**
- Immediately before removing its own draft, Jordan reads it in full. It must be in Drafts, owned by Jordan, and unchanged in every edited field (A6).
- Jordan records "removed by Jordan" before the call, then reads back afterwards.
- **If the call is definitely refused,** the mark is cleared in the same save.
- **If the response is lost,** the next run reads the draft:
  - in Deleted Items or not found: the removal counts as Jordan's, and this is reported as uncertain;
  - still in Drafts and unchanged: the removal is tried again;
  - changed: the removal is cancelled.
- **A replacement draft** (Appendix 1, rows M9 and AR1) is created only after the same run's read-back shows the old draft in Deleted Items or not found, and the index is updated. Otherwise it waits for the next run.
- Jordan never calls delete on anything outside Drafts.

**The alert draft** is created and updated through the same staged protocol, and its id is kept in `alert_draft`.
- While it is in Drafts, Jordan updates its body in place and never creates a second one.
- If it is not in Drafts when a new alert is due, Peter deleted or filed it. That counts as acknowledged, and a new alert draft is created and replaces `alert_draft`.
- It is exempt from the scan and page-1 guards (A9).

**Fingerprints.**
- The text above the quoted original is normalised, then hashed with SHA-256. Normalising means: tags stripped, with block tags turned into new lines; entities decoded; Unicode NFKC; zero-width characters removed; case folded; whitespace collapsed.
- The quote marker is confirmed in proof item P1.
- A missing marker, or a body too large to handle, counts as changed.
- The preview fingerprint (the first 200 normalised characters of the search preview) is a cheap check between runs. Any change means edited. A match is always confirmed by a full read before Jordan changes or removes anything.
- Edits made only inside the quoted history are not detected. Removal goes to Deleted Items and can be recovered.

**Accepted residual risks (D20):**
- If a crash leaves an intent unrecorded and Peter permanently deletes the draft within the next hour, one draft may be recreated.
- If Peter deletes a draft in the moment Jordan is removing it, the deletion may be counted as Jordan's.

Both cases are reported each time they happen, and deleting the draft again ends the chain.

### A11. Missing drafts and changed ids (F05)

Ids are locators, not identity. For a tracked draft missing from a complete scan:

1. **Re-key first.** If the same internet message id is in the scan under a new Outlook id, the draft is re-keyed and nothing else changes.
2. **Read it by id.** Its folder decides:
   - Drafts: look again next run;
   - Outbox: waiting to send; reported after 3 runs;
   - Sent Items, or no longer a draft: sent;
   - Deleted Items: A6;
   - any other folder: filed by Peter.
3. **On `NOT_FOUND`, search mailbox-wide** by its subject from when it was last seen (at most 2 pages). Match the results by internet message id, then read the hit to learn its folder and apply step 2.
4. **If that finds nothing,** search Sent Items from when it was last seen, matching on the internet message id, or the thread plus the fingerprint. A match means it was sent.
5. **Only a complete, uncapped search counts as "nothing found".**
   - If Peter has emailed in the thread since the draft was last seen, the draft is recorded as superseded and the chain carries on as his reply (A6). It is most likely sent or replaced under an id the connector cannot match.
   - Otherwise the draft is marked missing, and a second complete search at least 45 minutes later, still with no email from Peter, ends the generation (gone).
   - A capped or failed search changes nothing.
6. **Other errors.** Any other error changes nothing. After 24 hours of errors on the same draft, it becomes a "needs you" item.

Missing is a location, not an ending. While it lasts, the thread is blocked (reason `missing`). The block clears when the draft is resolved.

### A12. Lock (F07)

- **The lock file.** `jordan.lock` holds a random token, the Mac's hardware id (IOPlatformUUID, which does not change with the network), the process id and Claude session id (for diagnosis only), the run id, the mode (hourly or handover) and the time it was taken.
- **Taking it is atomic.** The script writes a temporary file and hard-links it into place. The link fails if a lock already exists. The script then reads the lock back to confirm the token.
- **Fencing is atomic too.**
  - Every write command holds an operating-system file lock on `jordan.lock.guard` from its token check to its snapshot rename. So a lock that is broken mid-write cannot let the old owner overwrite the new owner.
  - Only commands carrying the matching token touch the lock's modified time; read-only commands never do.
  - A mismatch exits with code 3.
- **Stale** means not touched for 30 minutes on the same Mac. To break a stale lock, the script:
  1. renames it to a unique name;
  2. confirms the renamed file carries the stale token; if it does not, puts it back with a hard link (which fails if a new lock now exists) and exits as busy;
  3. then takes the lock as normal.
  - Journal entries from a stale owner are replayed only after the lock has been broken, and the change of token is journalled.
- **A lock from another Mac** means no run. Jordan alerts on every run until Peter clears it with `unlock --force` from an interactive session.
- **Busy.** An hourly run that finds a fresh lock exits quietly. It records the event in `lock-status.json`, and after 3 in a row it sends the macOS notification itself.
- **Release** happens only with the matching token.
- **Limits.** An hourly run starts no new work 40 minutes after taking the lock. The handover runs in handover mode, with the hourly task paused.
- **Not reused:** the existing `board.py` lock (`flock`), because each script call is a short-lived process.
- **Tests:** 100 processes contend for the lock and exactly one wins each time; two breakers contend for the same stale lock; an old token's write is refused; a late heartbeat does not refresh a new owner's lock.

### A13. Listing, checkpoint, caps and catch-up (F06, F19)

**Window.** Listing starts at the checkpoint minus 15 minutes. That overlap also absorbs any clock difference within the 2 minutes A14 allows.
- Inbox and Sent Items are each listed oldest first with a start time, 25 per page.
- Each next page starts from the last processed time minus 60 seconds. Duplicates are dropped using `seen`.
- If a page holds nothing unseen, paging moves to offsets at the same start time. If the 1,000 offset limit is reached, Jordan alerts and stops.

**Listing horizon.**
- If both folders are listed to the end, the horizon is the run's start.
- Otherwise it is the earlier of the two folders' last fully processed times.
- The merged stream is processed only up to the horizon, and the checkpoint moves to it. The checkpoint never goes backwards and never passes a message that was not listed.

**Lag is measured in scheduled slots, not hours.**
- "Behind" means the checkpoint is older than the start of the previous scheduled slot. Weekends, bank holidays and nights never count.
- **Catch-up mode** starts when more than one working day of slots (more than 11) has been missed. It raises one alert ("catching up N working days") and allows higher caps.
- In catch-up mode, no drafts are made until Inbox and Sent Items are both caught up in the same run, so Jordan never drafts for mail Peter already answered from his phone (D14).

**Caps:**

| Per run | Normal | Catch-up |
|---|---|---|
| Listing pages, Inbox and Sent Items (each) | 8 | 40 |
| Drafts scan pages | 40 plus 1 rescan and the page-1 checks | Same |
| Full message reads (Sent, then Inbox, then re-checks, then recoveries), including read-backs | 40 | 150 |
| Draft index reads (outside the 40) | 25 | 25 |
| Characters brought into working memory | 400,000 | 1,200,000 |
| Reply drafts created | 10 | 10 |
| Chase drafts created | 5 | 5 |
| Guarded removals | 10 | 10 |
| Stop starting new work after | 40 minutes | 40 minutes |

**How the caps are applied:**
- The model reports each read's size to the script. No new read starts once the character budget would be passed.
- Each planned create reserves two reads, and characters for two copies of the thread at its known size, for its read-backs. No create starts without that reserve.
- Anything left over waits for the next run.
- Automatic mail is not read in full, except as A4 says. Peter's emails that are already known are not read again.
- The `extract` command only helps with oversized results that the harness has saved to a file.

### A14. Schedule and clock

- **Schedule.** Cron `30 7-17 * * 1-5` runs 11 times a day, from 07:30 to 17:30 local time (D7). The app adds a dispatch delay of 4 to 5 minutes. A missed run is caught up from the checkpoint by the next run. Bank holidays run as normal, which is harmless because Jordan only drafts.
- **Clock and time zone.** Every run starts with `clock`:
  - the system time zone must be Europe/London;
  - `sntp time.apple.com` must report an offset of at most 2 minutes.

  If either fails, the run stops and alerts (exit 21).
- **If the time server cannot be reached (exit 23):**
  1. Only one connector call is allowed: the first Inbox page, listed newest first.
  2. Then `clock --verify` checks the Mac's clock is not behind the newest mailbox time on that page.
  3. If the check passes, the run carries on, but its listing horizon is capped at the newest mailbox time seen plus 2 minutes. So a Mac clock running fast can never push the checkpoint past mail that has not yet been listed.
  4. The report notes that the clock was unverified.
  5. If the check fails, the run stops and alerts.
  6. A fallback run may still create drafts. The Act rule that the horizon must reach the run's start is met when both folders were listed to the end and the horizon equals the capped value. The page-1 Sent Items check before each create covers any email Peter sent in the last minutes. If the time server stays unreachable for 3 runs in a row, an alert says so.

### A15. Alerts, reports and monitoring (F17, F22)

PushNotification has never reached Peter, so it is not relied on.

| Alert class | Channels |
|---|---|
| Ledger, invariant, permissions, lock or clock stop (no connector calls allowed) | macOS notification only, plus the report |
| Connector down or authentication failure | macOS notification, plus the report |
| Everything else (duplicates, blocks, scan incomplete, missed slots, needs you) | macOS notification, the "Jordan needs you" alert draft, and the report |

- **Channels.**
  - The macOS notification is sent with `osascript` and appears in Notification Centre. `osascript` cannot confirm delivery: it succeeds even when notifications are off or Focus is on. This is a known limit, and proof item P10 checks it once.
  - PushNotification is used as a best effort only.
  - There are no notifications for individual drafts: new drafts simply appear in Outlook and the report (D8).
- **Alert state** lives in `alerts.json`, outside the ledger, so it works when the ledger does not. Each alert is fingerprinted by type and scope (a thread or "global"), never by error text.
  - At most one first alert per fingerprint per working day.
  - A reminder at the first run starting on or after 07:00 London each working day while the alert is open.
  - Recovery after 2 clean runs in a row, with one recovery message.
- **Metrics.** `log/runs.jsonl` gets a "started" line at step 1 and a "finished" line at step 7, so an unfinished run still shows up. The "started" line records the SHA-256 of the prompt the run used, read by the script. The lines record:
  - counts listed, read, drafted (replies and chases), reconciled, removed, chains ended, skipped, retried and failed;
  - characters read;
  - duration;
  - checkpoint age in slots;
  - scan status;
  - lock waits.
- **Thresholds:**
  - 3 missed scheduled slots between 08:00 and 18:00 on a working day;
  - catch-up mode;
  - any duplicate candidates;
  - a stale lock broken;
  - 3 connector failures in a row;
  - the Drafts scan incomplete 3 runs in a row;
  - the lock busy 3 times in a row;
  - any `ambiguous` block older than 3 runs.

  A normal Monday 07:30 run after a normal Friday raises nothing.
- **Runs that never start** (the likeliest cause is the Claude app being closed). A small watchdog runs independently of the app (D25). It is a macOS LaunchAgent that checks `log/runs.jsonl` at 09:05 and 14:05 on working days. If no run has finished since the previous scheduled slot, it shows a notification: "Jordan has not run since HH:MM: is the Claude app open".
- **Reviews** happen after the first day (G4 evidence) and after the first week (the precondition for deleting the backfill task, D17). Each review records its findings in the Plan A document.

### A16. Files and tasks that change (F20)

**Inventory and snapshot at G1, before the first change.**
- Every file below that already exists is copied to `1 My Agents/archive/2026-09-jordan-tracker/`, with 0700 and 0600 permissions.
- The prompts under `~/.claude` are saved as `scheduled-tasks/<task id>/SKILL.md`.
- `MANIFEST.txt` records each source path, its saved copy and its SHA-256.
- The export records every field the scheduled-tasks tool returns for both Jordan tasks, plus a read-only copy of their two entries from the app's `scheduled-tasks.json`.
- At G3, everything is hashed again and any drift since G1 is recorded.

| Path | Change | Gate |
|---|---|---|
| `1 My Agents/.claude/settings.json` | Tool policy from A1 | G1 |
| `~/.claude/scheduled-tasks/jordan-followups-loop/SKILL.md` | At G1, step 5 of the old prompt is changed from "send approved rows" to "list approved rows in the report as: send this yourself from Outlook". This no-send version is snapshotted as well as the original. At G3, it is replaced by the new hourly prompt | G1, G3 |
| Task `jordan-followups-loop` | At G3: title "Jordan: hourly inbox drafts", cron `30 7-17 * * 1-5`, same task id so the run history stays | G3 |
| `~/.claude/scheduled-tasks/jordan-inbox-6month-backfill/SKILL.md` and its task | Snapshotted at G1; task disabled at G3; deleted after a clean first-week review (D17) | G1, G3, later |
| `1 My Agents/.claude/agents/jordan.md` | Drafts in Outlook, never send, the chain rule, the model and script split | G3 |
| `1 My Agents/.claude/skills/outlook-connector/SKILL.md` | The hourly run and the tool policy | G3 |
| `1 My Agents/.claude/skills/draft-reply/SKILL.md` | Drafts go to Outlook; FILL and ACTION NEEDED; style extract; recipients | G3 |
| `1 My Agents/.claude/skills/daily-triage/SKILL.md` | Jordan's output is drafts plus report lines | G3 |
| `1 My Agents/shared/memory/platform-policies.md` | The tracker line is replaced: Jordan drafts, Peter sends from Outlook | G3 |
| `1 My Agents/shared/memory/brand-rules.md` | The Charlotte rule as scoped in A3; the sign-off | G3 |
| `1 My Agents/company/peter-email-voice.md` | New: Peter's voice profile (A3, D30), drafted at G2 and approved by Peter | G2 draft, G3 live |
| `1 My Agents/desks/jordan/notebook.md` | The three 17 September tracker lessons are marked retired, with a date | G3 |
| `1 My Agents/company/team.md` | Regenerated with `python3 scripts/roster.py` | G3 |
| `1 My Agents/scripts/jordan_ledger.py`, `test_jordan_ledger.py`, `jordan_ledger.schema.json`, `bank_holidays_england_wales.json` | New. Written from an interactive session in the Planner folder, because nothing in `1 My Agents` may edit `scripts/` | G0 (inert until used) |
| `~/Library/LaunchAgents/` watchdog, with its script in `1 My Agents/scripts/` | New, if D25 is approved | G3 |
| `1 My Agents/.claude/settings.local.json` | `cleanupPeriodDays`, if D26 is approved | G3 |

- **Approved hashes.** Every new or replaced file's approved hash goes in `MANIFEST.txt`. After G3, all of them are checked, not just the prompt's.
- **Verification after G3:**
  - `list_scheduled_tasks` shows the new title, id, cron and enabled state;
  - the backfill task shows as disabled;
  - exactly one Jordan loop is enabled.
- **Deleting the backfill task, later:**
  - First, list the tasks and confirm the id `jordan-inbox-6month-backfill`, its title and that it is disabled.
  - Then delete it by that id.
  - Then confirm it is gone, that `jordan-followups-loop` is the only enabled Jordan task, and that `desks/jordan/work/backfill/` is unchanged.

### A17. Tests

**Setup.** Tests use Python `unittest` and the standard library only. They run against a fake connector that behaves like the real one:
- no thread id in search results;
- offset paging;
- `NOT_FOUND` errors;
- ids that change when a draft moves;
- deleting a draft that is already gone succeeds;
- timeouts after the change was made;
- rate limits;
- 30 messages in the same second.

The suite runs under `TZ=Europe/London` and `TZ=UTC` and must pass in both. It is written at G0, revised with what the proof learns, and run again for G2.

**What it covers:**

- **Appendix rows.** One test per row in Appendix 1, and one per crash point in Appendix 2 (each ends with exactly one draft and the right recipients).
- **Timing and reconciliation:**
  - the same inputs give the same result whether Peter's deletion is noticed in the same run as a new message or in an earlier run;
  - every reconciliation row R1 to R10;
  - Peter's own new draft in a thread with an unclear create stays Peter's (R8);
  - an edited, unrecorded Jordan draft counts as Jordan's (R6), and deleting it ends the chain (R7);
  - an adopted draft that Peter has already overtaken is removed in the same run;
  - handover messages written to `seen` cause no removal and redraft at the first hourly run;
  - M9 marks a draft out of date only for a newer message.
- **Duplicates and unclear results:**
  - two candidates block the thread;
  - an unclear result escalates after 3 runs;
  - `resolve` clears a block;
  - a draft saved mid-scan stops drafting;
  - more than 1,000 drafts stops drafting;
  - the page-1 check before a create catches Peter's new draft.
- **Ids and missing drafts:**
  - an id changes on a move;
  - a draft filed to a custom folder is found by search;
  - a missing draft turns out to be sent;
  - a draft missing twice ends the chain;
  - a delete and a send in the same run count as a takeover only for an outside ask;
  - Shift-deleting a chase draft ends the chain.
- **Generations:**
  - a message before the watermark is ignored;
  - a clear message after it opens the next generation, and an unsure one only adds a report line;
  - a new message plus a deletion in the same run gives an ended generation and a new active one;
  - carry-forward of an out-of-date edited draft;
  - a deleted draft that comes back counts as Peter's own.
- **Edited drafts:**
  - an edit to the text, the recipients only, the subject only, or adding an attachment is each detected;
  - an edited draft that is sent, deleted, left or filed.
- **Replies and asks:**
  - an automatic acknowledgement changes nothing;
  - a bare "thanks" is unrelated;
  - a holding reply with and without a date;
  - a partial answer;
  - an out-of-office moves the due date;
  - a bounce blocks the ask;
  - an answer filed in another folder is caught by the re-check;
  - an inbound email filed before drafting clears only the reply;
  - a filed target with Jordan's draft waiting.
- **Recipients:**
  - matching ignores case;
  - To wins over Cc for duplicates;
  - team addresses do not trigger reply-all;
  - a read-back mismatch blocks the thread;
  - Peter's addresses are stripped;
  - the Charlotte trigger;
  - sends only to Peter's own or team addresses open no ask.
- **Lock:**
  - 100 processes, one winner;
  - two breakers;
  - an old token's write is refused;
  - a late heartbeat does not refresh a new owner's lock;
  - a release with the wrong token is refused;
  - another Mac's lock is never broken;
  - a crash then recovery replays the journal after the lock is broken.
- **Listing:**
  - Sent Items hits its cap before Inbox, and the checkpoint stays at the Sent Items horizon;
  - a listing that fails on page 3;
  - the same-second paging problem;
  - 21 days and 1,200 messages in catch-up give the same result as one pass;
  - no drafts until caught up;
  - a normal Monday raises no alert.
- **Dates:**
  - every worked example in A5, in both time zones;
  - each phrase form, including vague ones;
  - a deadline before the send;
  - a deadline kept across a later email from Peter;
  - the bank-holiday file's expiry.
- **Ledger:**
  - missing, corrupt, invalid or wrongly permissioned means zero connector calls;
  - journal replay after a kill;
  - a restore gives the exact state;
  - 10,000 random events never break an invariant;
  - `init` refuses when anything exists;
  - `proof-due` is refused on a live ledger.
- **Clock and tools:**
  - an unverified clock caps the listing horizon at the newest mailbox time plus 2 minutes;
  - a visible tool on neither list stops the run;
  - an acknowledgement never sets a reply need;
  - a message that would break an invariant is skipped and the run continues;
  - an ask email from Peter becomes the new basis and drops the old deadline.
- **Safety:**
  - an injection email fixture produces no new recipient, no other thread's content and no tool outside the policy;
  - a style email carrying a unique marker never leaks that marker into a draft;
  - the fingerprint ignores formatting but catches a changed word;
  - a missing quote marker counts as changed;
  - the FILL count must match the ACTION NEEDED line;
  - summaries containing money, email addresses or phone numbers are rejected.

---

## Part B: remove Follow-ups from Planner

**Preconditions.**
- G3 is complete, and the first-day pass criteria (Gates) are met.
- Nothing has called the bridge since the cutover. The old prompt is its only caller. The new loop keeps the same task id, so its run history cannot show this; instead, every run's "started" metrics line records the SHA-256 of the prompt it ran. Every run since G3 must show the new prompt's approved hash, which never calls the bridge. The table's `updated_at` is not used, because Peter closing a row on the page would also change it. Where Peter can, he also confirms in Vercel's logs that `/api/cron/email-follow-ups` has had no call since G3.
- At G3, Peter is told the Follow-ups page is out of use.

**Where the work is done.** One pull request from `origin/main`, on branch `chore/remove-email-follow-ups`, in a worktree under `.claude/worktrees/`, which Vitest already excludes. The current working tree holds another session's uncommitted edits and is left alone. This spec and its review are committed on this branch as documentation.

**Delete these 10 files:**
- `src/app/email-follow-ups/page.js`
- `src/components/emailFollowUps/FollowUpList.jsx`
- `src/components/emailFollowUps/__tests__/FollowUpList.test.jsx`
- `src/app/api/email-follow-ups/route.js`
- `src/app/api/email-follow-ups/[id]/route.js`
- `src/app/api/cron/email-follow-ups/route.js`
- `src/services/emailFollowUpService.js`
- `src/services/__tests__/emailFollowUpService.test.js`
- `src/lib/outlookWebLink.js`
- `src/lib/__tests__/outlookWebLink.test.js`

**Edit these 6 files:**
- `src/components/layout/Sidebar.jsx`: the link and the `Mail` import (lines 14 and 30).
- `src/lib/apiClient.js`: lines 768 to 799.
- `src/lib/constants.js`: lines 108 to 140 and 266 to 273.
- `src/lib/validators.js`: the import on line 3, and `validateEmailFollowUp` on lines 350 to 408.
- `CLAUDE.md`: the "Email follow-ups" integration bullet (line 72) and the `EMAIL_FOLLOWUPS_*` line in the environment block (line 88). `AGENTS.md` is a symlink to it.
- `docs/codebase-map.md`: the Follow-ups entries on lines 13, 25, 43 and 83.

Line numbers are as on `origin/main` at 59c39a3, and are re-checked when the branch is cut.

`isValidEmail` predates the feature and is left alone. The migration file stays as history.

**Checks before merge:**
- **Commands:** `npm run lint` (zero warnings), `npm test`, `npm run test:utc` and `npm run build`.
- **Routes:** the build's route list no longer includes `/email-follow-ups`, `/api/email-follow-ups`, `/api/email-follow-ups/[id]` or `/api/cron/email-follow-ups`.
- **Leftover references:** a case-sensitive `git grep` over `src/`, `supabase/`, `CLAUDE.md` and `docs/codebase-map.md` for `email_follow_ups`, `email-follow-ups`, `EMAIL_FOLLOWUPS`, `emailFollowUp`, `FOLLOWUP_`, `FollowUpList`, `outlookWebLink` and `Follow-ups`. Only two hits are allowed:
  - `supabase/migrations/20260915000001_email_follow_ups.sql`;
  - `src/lib/noteTasks.js` line 21 (an unrelated comment).

  Any other hit fails the gate.

**Checks after deploy** (the deployment id is recorded):

| Request | Before | Expected after |
|---|---|---|
| `GET` and `POST /api/cron/email-follow-ups`, no credentials | 401 | 404 (the proof that needs no sign-in) |
| `/email-follow-ups` and `/api/email-follow-ups`, signed out | 307 to `/login` | 307 to `/login` (unchanged: the middleware runs first) |
| `/email-follow-ups`, signed in | The page | 404, and no Follow-ups link in the sidebar (Peter checks in his browser) |

**Environment variables.**
- Peter checks `EMAIL_FOLLOWUPS_USER_ID` and `EMAIL_FOLLOWUPS_USER_EMAIL` in all three Vercel environments (Production, Preview, Development).
- He records their values in the manifest (a user id and an email address, not secrets), removes them, and confirms they are gone.
- `CRON_SECRET` stays, because other crons use it. Rotating it is recommended.

**Branch tidy (covered by G4):**
- **Deleted:** the local branches `feat/follow-ups-tracker` and `feat/followups-table` (both already merged), and `chore/remove-email-follow-ups` after the merge.
- **Never deleted:** `feat/email-follow-ups` and `chore/agent-instruction-files`, until every commit unique to them is confirmed on main (the security commits landed in PR #43; the rest are checked one by one) and the other session's uncommitted work is safe.

---

## Part C: archive and drop the table (F12)

**Preconditions:**
- Part B is deployed and verified.
- The Part B bridge-silence check still holds, and the bridge route now returns 404.
- The migration and restore have passed their tests.
- The live table's grants, indexes, trigger, policy and row-level security flag have been captured with a read-only catalogue query.
- Peter has given his explicit yes at G5.

**The migration** (`supabase/migrations/<timestamp>_retire_email_follow_ups.sql`). The file starts with `BEGIN` and ends with `COMMIT`, as 20260901000011 does.

1. `SET LOCAL lock_timeout = '5s'`, then lock `public.email_follow_ups` in ACCESS EXCLUSIVE mode.
2. **Guard.** Stop with an error if any of these is true:
   - any function in any schema other than `pg_catalog` and `information_schema` has `email_follow_ups` in its source (`pg_proc.prosrc`);
   - `pg_depend` shows any view, materialised view, rule or policy on another table that depends on it;
   - any non-internal trigger (`NOT tgisinternal`) other than `trg_email_follow_ups_updated_at` exists on it;
   - any foreign key points to it;
   - it is in a publication.
3. **Create** `public.email_follow_ups_archive` explicitly, with no `IF NOT EXISTS`. If it already exists, the migration fails and changes nothing.
   - It has all 22 source columns, with the same types and NOT NULL rules, plus `archived_at timestamptz NOT NULL DEFAULT now()`. Its primary key is `id`.
   - It has no foreign keys: it is an independent snapshot that keeps `user_id` and `customer_id` as plain values.
   - A table comment records the source, the date and the path of the restore SQL.
4. **Lock it down.**
   - Enable row-level security, with no policies.
   - `REVOKE ALL ON public.email_follow_ups_archive FROM PUBLIC, anon, authenticated, service_role`.
   - `GRANT SELECT ON public.email_follow_ups_archive TO service_role`.
5. **Copy** every row. Assert that the counts match, and that comparing all columns in both directions finds no difference. Otherwise stop with an error.
6. **Drop** `public.email_follow_ups`. Its trigger, indexes and policy go with it; the shared `update_updated_at_column()` function stays.

**After applying:**
- Assert from `information_schema.role_table_grants` that `service_role` holds exactly SELECT on the archive, and that `anon` and `authenticated` hold nothing.
- Check that the archive's count equals the table's final count (84 unless something changed).
- Check that the source table is gone.

**Restore SQL** (`supabase/restore/restore_email_follow_ups.sql`, not a migration):
1. Recreate the table as `20260915000001` did: columns, constraints, indexes including the partial unique index, trigger, row-level security and policy.
2. Apply the live grants captured before G5, written out explicitly.
3. Copy the rows back from the archive. A row whose customer no longer exists is restored with `customer_id` set to null. A row whose user no longer exists is skipped and listed.

**Tests before applying.** The tests run on a throwaway database on the local Homebrew PostgreSQL 17. The database is created and dropped by `supabase/__tests__/run-retire-email-follow-ups.sh`, which runs `supabase/__tests__/retire-email-follow-ups.sql` with psql. This uses its own database because the migration has its own transaction; it is not part of `npm test`. The test:
1. Sets up the same default privileges as live, and stubs `auth.users`, `customers` and the shared trigger function.
2. Applies `20260915000001` and inserts synthetic rows covering every column, including nulls.
3. Applies the retirement migration, then asserts that the archive matches, the grants are exactly as stated, and the source is gone.
4. Runs the restore SQL and compares a catalogue query taken before the drop with one taken after the restore: columns, constraints, indexes, trigger, policy, row-level security and grants, as well as the rows.
5. Runs two negative tests. A view on the table, and separately a plpgsql function that reads it, must each make the migration fail with nothing changed.

The live database is PostgreSQL 15.8, so nothing version-specific is used.

**Applying (G5).**
- Live migration history now matches the repo (PR #43), so the migration is applied with `npx supabase db push` and recorded under its own file name.
- The anon drift test (`supabase/__tests__/anon-access.test.js`) must still pass. Neither table is reachable by `anon`, so no change to `supabase/anon-access-allowlist.js` is expected; the test confirms it.
- The 90-day archive review (D24) is added to `tasks/todo.md` as an unticked item when G5 is applied.

---

## Gates and rollout (F04, F24)

Each gate is Peter's explicit yes, given after he has seen the evidence. Nothing goes on past a failed or unclear result.

| Gate | Peter approves | What changes live | Evidence first |
|---|---|---|---|
| **G0** | This spec | Nothing live. The ledger script and tests in `scripts/` (inert). The new prompt and standing files staged in `desks/jordan/work/staging/`. Read-only checks only | This spec |
| **G1** | The proof | Snapshot and manifest first. The old prompt changed so it never sends, and every run lists approved rows as "send this yourself from Outlook". Peter is told which rows are approved now, and that approving on the Follow-ups page no longer sends anything. The tool policy is added to `settings.json`. The proof runs on controlled threads only. The harness file limit is measured | The proof checklist; the staged prompt; ledger tests passing in both time zones; a passing tool-coverage run; the old loop's next run still reaching the bridge |
| **G2** | The build, the dry-run list and the voice profile | Nothing live. Read-only mailbox reads and a read-only select on the tracker. The script and tests are revised from the proof and run again. The dry run of the 67 open rows is written to `desks/jordan/work/handover/`, resumable, with a read and character estimate. The voice profile is drafted | Every proof item passed; tests passing; the dry-run list and the voice profile, which Peter approves here |
| **G3** | The live handover and cutover | The ordered steps below | A refreshed dry run showing its differences from the approved list |
| **G4** | Part B | Pull request merged to main and deployed by Vercel; the checks after deploy; Peter removes the two environment variables; the branch tidy | The first-day pass criteria; the pull request checks |
| **G5** | Part C | The migration applied to the live database | Part B verified in production; migration and restore tests passed; the captured catalogue; row counts |

**G3 in order:**
1. Pause the old loop (`enabled: false`) and wait until no run is in progress.
2. Hash everything again and record any drift since G1.
3. Take a frozen export of the tracker rows with a read-only select. Save it in the archive, with 0600 permissions.
4. Refresh the dry run from that export and show Peter the differences from the approved list. Rows whose action matches the approved list are drafted in step 6. New or changed rows are shown to Peter, and are entered in the ledger at step 6 as generations without a draft (reply needed, or ask open with its due time). They may come from mail older than the checkpoint, which hourly ingest will never list again, so entering them in the ledger is what lets the hourly runs draft them.
5. Run `init` for the live ledger:
   - `mode live`;
   - the checkpoint set to the start of the old loop's last completed run (from its run history);
   - `peter_addresses` including peter.pitcher@outlook.com;
   - the tasting-night owner entry.
6. Do the handover. First, the new or changed rows from step 4 are entered in the ledger without drafts. The first batch of 10 is reported to Peter, and the handover waits for his go-ahead before the remaining batches. Every draft goes through A10 and is saved on its own; batches are only resume points. For each thread, the handover also records in the ledger:
   - every message it read, in `seen`;
   - the reply target each draft answers;
   - each ask's basis and due time.

   So the first hourly run does not treat those messages as new, and does not remove and redraft the handover's drafts.
   - **Stop rule:** the handover stops, and the schedule stays off, on any duplicate candidate, invariant breach, recipient mismatch or action not on the approved list. A rollback decision then goes to Peter.
7. Copy the ledger after the handover, the journal and the handover mapping (tracker row to thread to draft) to the archive as fixed records, hashed in the manifest, and never overwritten.
8. Install the new prompt and standing files and check their approved hashes. Set the title and cron, then enable the task.
9. Disable the backfill task. Install the watchdog and the transcript settings if D25 and D26 are approved.
10. Verify the scheduled tasks and the hashes (A16).

**First-day pass criteria (for G4).** The first day is the first full working day after G3. By its 17:30 run, all of these must hold:
- all 11 scheduled runs finished;
- zero duplicate candidates;
- zero invariant breaches;
- zero recipient mismatches;
- no open alerts;
- the checkpoint within one slot.

Approving G4 covers the merge, deployment, verification and branch tidy without a further ask (D22).

### How the gates run (Peter, 18 September)

Peter approved the spec and asked for everything to be implemented without stopping. So:
- Each gate's evidence is produced and recorded in the Plan A document instead of waiting for a separate yes. Any failed or unclear check still stops the rollout and triggers the rollback runbook.
- The first handover batch is reported in the run log rather than held for a go-ahead.
- G4's first-day evidence is replaced by two consecutive clean live runs of the new loop, started by hand. The full first-day and first-week reviews still happen from the metrics, and are reported to Peter.
- G5 runs only after the archive and restore tests pass on a throwaway database. Peter approved archive-then-drop (D2) and full implementation.
- The backfill task is disabled at G3 and deleted only after the first-week review.

## Proof checklist (G1, F14)

**Setup.**
- Proof items P1 to P8 and P10 to P16 run by hand in an interactive session. P9 runs as a one-off scheduled run in `1 My Agents`, because scheduled runs use bypass permissions.
- **Test counterpart:** peter.pitcher@outlook.com (D16), treated as external for the proof only.
- **Numbered attempts.** Each attempt N has:
  - subjects starting "Proof N-";
  - its own ledger at `desks/jordan/work/proof/attempt-N/` (`mode proof`, with the checkpoint set to the first proof email's time);
  - a results file there, with one row per case holding every column below.
- **Scope.** The proof run carries an allow-list of subjects starting "Proof N-", and the script refuses to plan any action on any other thread.
- **Failed attempts.** A failed attempt is archived as it stands, and the next attempt starts again from P1.
- **What blocks G2.** Any unclear result on ids, recipients, threading, fingerprints, sent state, the tool policy or P8 blocks G2 and brings the design back to Peter.

| # | Starting state | Action | Expected connector result | Expected in Outlook | Expected in ledger | Clean-up |
|---|---|---|---|---|---|---|
| P1 | Empty proof ledger | Test account sends "Proof N-1: can you confirm the 3pm slot"; Jordan runs | Reply draft created; read-back matches; Drafts listing shows the new id and a total one higher | Threaded draft to the test account, quoted original, ACTION NEEDED line and FILL gap as written | Generation 1 active; Jordan-owned reply draft; intent cleared; quote marker and "Sent:" time zone recorded | Kept for P2 |
| P2 | The P1 draft | Peter changes one word, and separately (on a copy) changes only the recipients | Full read shows the changes | His edits | Owner Peter-edited in both cases | Kept for P3 |
| P3 | Edited P1 draft | Peter sends it | Read by id returns `NOT_FOUND`, or shows Sent Items (recorded); the sent copy is found by internet message id (whether it survives the send is recorded) | Sent | Draft recorded as sent; reply need cleared | None |
| P4 | Clean thread | Peter sends "Proof N-4: please send the figures" to the test account, copied to peter@the-anchor.pub; `proof-due` sets it due; Jordan runs | Reply-all draft, then a recipients-only update | To is the test account only; no Peter address; quote and threading intact | Ask open; chase count 1; recipients verified | Kept for P5 |
| P5 | The P4 chase draft | Peter deletes it normally | Draft found in Deleted Items, by the same or a new id (either passes if found) | In Deleted Items | Generation ended (deleted); watermark is the listing horizon | None |
| P6 | A new reply draft on "Proof N-6" | Peter permanently deletes it (Shift+Delete) | `NOT_FOUND`; complete searches find nothing | Gone | Missing, then ended at the second check at least 45 minutes later | None |
| P7 | Jordan's unchanged reply draft on "Proof N-7" | Test account writes again in that thread | Guarded removal, then one new draft | Old draft in Deleted Items; one new draft | Old draft marked removed by Jordan; generation still active; one replacement | Peter deletes the new draft (which ends that chain, as a bonus check) |
| P8 | Proof threads with sent and deleted items | A mailbox-wide search by subject from a start time; a Drafts listing newest first | The search returns messages sent or deleted after that time; what "newest" sorts by in Drafts is recorded | None | None | None |
| P9 | A draft addressed only to the test account | The one-off scheduled run tries send draft, send mail and forward to the test account, and one Teams send | Each is refused, and the transcript names the deny rule | Nothing sent | None | Peter deletes the draft |
| P10 | None | Trigger a test alert | Alert draft created, then updated in place on a second alert | One alert draft; a macOS notification (Peter confirms he saw it) | `alert_draft` recorded; `alerts.json` updated | Peter deletes the alert draft |
| P11 | Thread "Proof N-11" needing a reply | Peter saves his own reply draft first; Jordan runs | His draft indexed | Only his draft | Recorded as Peter's own draft; no Jordan draft | Peter deletes it; Jordan then drafts (D18) |
| P12 | A Jordan draft on "Proof N-12" | Peter moves it to a custom folder | Found by search; read shows the folder | In that folder | Recorded as filed; generation active; no longer blocks | Peter deletes it |
| P13 | Test account set to use a Reply-To of another address Peter controls, if outlook.com allows it | Test account writes; Jordan runs | Draft To is the Reply-To address | Warning in the ACTION NEEDED line | Reply-To recorded | If not possible, listed as an untested residual risk |
| P14 | None | Test account sends an email with visible and hidden instructions (add a recipient, quote another thread, send, fetch a web address) | No tool outside the policy attempted | No draft | Marked suspicious; report line | Peter deletes the email |
| P15 | None | Test account sends active HTML, a hidden text block and an attachment | What the read returns (sanitised or not, attachment listed or not) is recorded | None | None | Peter deletes the email |
| P16 | None | Test account sends a long email with a large quoted history | The size at which the harness saves a result to a file is recorded | None | None | Peter deletes the email |

**Final clean-up.**
- Peter deletes any remaining proof drafts and emails.
- The old loop may create tracker rows for proof threads. Peter closes them on the Follow-ups page, and the dry run excludes subjects starting "Proof".
- The whole proof folder (ledger, journal, backups, logs and results) is moved to the archive, so the live `init` finds nothing in the way.

### Proof as run (D16)

Peter does not want any inbox other than peter@orangejelly.co.uk used. The proof therefore has no test counterpart:
- Reply and chase drafts are proved on real open threads in peter@orangejelly.co.uk, chosen from the open tracker rows. They are drafts only, and nothing is sent.
- The operator simulates "Peter edits" with a body update and "Peter deletes" with a delete that carries no Jordan mark. Both go through the same connector calls Outlook uses.
- The send block (P9) is proved on a draft addressed only to peter@orangejelly.co.uk, so a failure could reach no one else.
- Behaviours that need an outside sender or a real send (P3 sent detection, P6 permanent delete, P13 Reply-To, P14 hostile email, P15 active HTML) are covered by the fake-connector tests. They are then watched for in live use, and each first live occurrence is noted in the metrics review.
- P16 is measured on an existing long thread.
- All proof drafts are removed at clean-up, so the handover drafts those threads afresh.

## Handover (G2 dry run, G3 live)

**Input.**
- **At G2:** a read-only select of the open tracker rows through the Supabase tools.
- **At G3:** the frozen export taken at pause time.

The new prompt never reads Supabase.

**For each open row.**
- **The dry run reports:** whether the thread is still open, whether Peter has replied, whether a draft exists, and the proposed action: a reply draft, a chase draft now, a chase due later (by A5, from Peter's last sent email), or nothing. Anything uncertain is flagged.
- **Excluded:** subjects starting "Proof".
- **Written to:** `desks/jordan/work/handover/progress.json` (0600) after each batch of 10, so a failed session resumes from the first row not marked done.
- **"Read-only" here** means nothing is written to the mailbox, the ledger or Planner.

**Existing drafts.**
- **The 12 drafts on the open rows** (10 ready, 2 approved) are used only as input. Every handover draft is written fresh under A3, with FILL gaps and an ACTION NEEDED line. Drafts on closed rows are ignored.
- **Drafts already in Outlook** at handover are recorded as Peter's own drafts and block their threads. None were present on 18 September.

**Closed tracker rows** are not imported. A new message on one of those threads starts generation 1 in the usual way.

## Rollback runbook (F13)

Peter decides on a rollback, and Claude carries it out with his yes. Triggers are: a duplicate draft, a draft addressed to the wrong people, missed mail, a broken invariant, or repeated failures. Each row assumes the rows below it have not happened.

| After | To roll back |
|---|---|
| G1 | Remove the proof-only changes and keep the two safety changes. The no-send old prompt and the send deny rules stay, because Peter may already have sent approved rows by hand, and a sending loop would send them twice. Peter deletes the proof drafts and closes any proof tracker rows. The original send-capable prompt is restored only after every row Peter sent by hand is closed or un-approved. |
| G3, before G4 | 1. Pause the hourly task. 2. From the ledger, list every Jordan-owned draft still in Drafts or Outbox, plus the alert draft, with Outlook links. Peter decides each one; nothing is bulk-deleted. 3. Restore the old title, cron `30 7 * * 1-5`, the no-send old prompt from G1, and the standing files from the snapshot. The tool policy stays: the restored loop syncs and drafts in Planner, and Peter sends from Outlook. 4. Re-enable the old loop and confirm it is the only Jordan task enabled. The ledger is kept. The old loop only scans 14 days, so a longer gap needs a manual review. |
| G4 | Revert the pull request and push (Vercel redeploys). Confirm the bridge answers 401 without credentials. Peter re-adds the two environment variables from the values recorded in the manifest. Then follow the G3 row. |
| G5 | Run the tested restore SQL, then follow the G4 row. |

**A second cutover** reuses the kept ledger, so ended generations still stand. It repeats the G2 dry run from the ledger's checkpoint and needs a fresh G3 yes.

## Risks and residual risks

- **Usage.** 11 runs a day instead of one, on Opus. A quiet run costs at least three listing calls, more if Drafts holds over 25 items. Busy runs are capped by reads and characters. The handover is the largest single piece of work, and its estimate is shown before G3.
- **"When in doubt, draft" means more drafts.** Peter chose this knowingly: each unwanted draft costs one delete, and that ends the chain.
- **The ledger is critical.** It is the only record of which chains Peter ended. That is why it has the journal, backups, fixed copies and invariants, and why Jordan stops rather than rebuilding it.
- **The model supplies data to the script.** The tool deny rules, not the script, are the control against a manipulated run. Python in Bash can still reach the network.
- **Run transcripts keep email bodies** Jordan reads (D26).
- **The Mac must be on and the app open.** The watchdog (D25) is the only alert for a run that never starts.
- **`osascript` cannot confirm a notification was seen.**
- **The residual risks in A9 and A10:** a draft Peter starts seconds before a create, one Outlook desktop has not yet saved, a recreation after a crash, and a deletion made during Jordan's own removal.
- **Edits only inside the quoted history** are not detected. Removal can be recovered from Deleted Items.
- **Reply-To handling** may ship untested (P13).
- **Quoted "Sent:" times in UTC** would read an hour early in summer. This is cosmetic, and P1 records it.
- **The `X-AI-Generated` header** probably stays when Peter sends a draft. Recipients do not see it in normal mail apps.
- **No Planner view** of outstanding email remains. Outlook Drafts and the run reports become the list.

## Decisions

| # | Decision | Status | Outcome |
|---|---|---|---|
| D1 | Sign-off | Proposed | "Thanks, Peter", no signature block |
| D2 | Tracker data | Peter, 18 Sep | Archive, then drop (with its own yes at G5) |
| D3 | Outlook categories | Proposed | None for now |
| D4 | Jordan may remove its own unchanged, out-of-date drafts | Peter, 18 Sep | Yes, to Deleted Items only |
| D5 | Chase timing | Proposed | 07:00 on the third working day after the send date; bank holidays excluded; an agreed deadline replaces this and survives later non-ask emails; no fixed limit |
| D6 | When in doubt, draft, including the 67 open rows | Peter, 18 Sep | Yes. The dry-run list is approved at G2 and refreshed at G3 |
| D7 | Hours | Peter, 18 Sep | Hourly, 07:30 to 17:30, weekdays |
| D8 | Alerts | Proposed | macOS notification, the alert draft and the report, by class (A15); no notifications for individual drafts |
| D9 | Restart after a chain ends | Peter, 18 Sep | Only a clear new question from them, or a clear new ask from Peter, after the watermark. Unsure gets a report line |
| D10 | Deleting a draft Peter had edited | Proposed | Also ends the chain |
| D11 | Peter's addresses and copying | Peter, 18 Sep | Every email is sent from peter@orangejelly.co.uk, wherever it was received. Peter's addresses: peter@orangejelly.co.uk, peter@the-anchor.pub, manager@the-anchor.pub, peter.pitcher@outlook.com, and thepitchersummers@gmail.com (shared with Billy, looked after by Peter). Team: the other the-anchor.pub mailboxes. Billy is a separate person. Team addresses stay where they already are but never trigger reply-all. Chases copy exactly the basis email's To and Cc minus Peter |
| D12 | Charlotte Brown | Peter, 18 Sep | The rule applies only to emails she is already on: she stays copied, and on threads she started the draft thanks her for the brief until one draft is sent. She is never added to anything else, and Jordan never prompts to add her |
| D13 | Inbound email deleted or filed before drafting | Proposed | Clears the reply need only; an open chase continues |
| D14 | Long outage | Proposed | Catch up automatically; no drafts until caught up; reported |
| D15 | Ended chains and old threads | Proposed | Shrunk after 90 days and kept for good |
| D16 | Proof without another inbox | Peter, 18 Sep | Jordan monitors only peter@orangejelly.co.uk. The proof uses no test counterpart: it runs on real threads in that mailbox with drafts only (see "Proof as run") |
| D17 | Backfill task | Proposed | Disabled at G3; deleted after a clean first-week review, with a one-line yes then |
| D18 | Peter deletes a draft he wrote himself | Proposed | Jordan drafts if a reply is still needed |
| D19 | Emails only to Peter's own or team addresses | Proposed | Never open an ask |
| D20 | Accepted residual risks in A10 | Proposed | Accept; report every case |
| D21 | Peter starts his own draft where Jordan's unchanged draft waits | Proposed | Jordan removes its own draft and reports it |
| D22 | What G4 covers | Proposed | Merge, deploy, verify and the branch tidy; Peter removes the environment variables |
| D23 | Deleting an edited draft that had gone out of date | Proposed | Ends that chain, but a newer message that clearly needs a reply still gets a draft |
| D24 | Archive retention | Proposed | Kept, read-only to the service role; reviewed 90 days after G5 |
| D25 | Watchdog for runs that never start | Peter, 18 Sep | Yes: a LaunchAgent checks at 09:05 and 14:05 on working days |
| D26 | Run transcripts for the 1 My Agents folder | Peter, 18 Sep | Folder set to 0700; `cleanupPeriodDays` 30 in that project's settings |
| D27 | Holding and acknowledgement replies | Proposed | The table in A5 |
| D28 | Unfinished drafts | Proposed | One ACTION NEEDED first line plus inline `[FILL: ...]` gaps |
| D29 | Disputed deadlines | Proposed | Use the default and report the phrase; no confirmation asked |
| D30 | Peter's voice profile | Peter, 18 Sep | A profile of about 50 emails Peter wrote himself. Built during implementation and put live, flagged for Peter to edit whenever he likes; refreshed every three months |

## Out of scope and parked

- **Out of scope:**
  - Jordan sending anything;
  - a view of email inside Planner;
  - General Mills and Jake;
  - moving Jordan to a cloud routine;
  - answers drawn from other systems (Jordan leaves a FILL gap instead).
- **Done separately on 18 September (PR #43):** the anon security commits landed on main, and migration history was reconciled.
- **Parked:** `projects_stakeholders_archive` still grants full access to `anon` and `authenticated`, with row-level security as the only control.
- **Recommended, Peter's action:** rotate `CRON_SECRET` (in Vercel and `.env.local`) after cutover.

---

## Appendix 1: transitions

Every row is saved to the journal before anything else happens. Row prefixes keep them apart from section and decision numbers: S (run), M (message), DR (draft), E (ending), AR (act).

### Run-level rows

These are checked at the start of the run, in order. The first match stops the run with no connector calls, except for the clock fallback in A14.

| # | Condition | Result |
|---|---|---|
| S1 | Time zone not Europe/London, or clock offset over 2 minutes (exit 21) | Stop; alert. Time server unreachable (exit 23): the A14 fallback applies |
| S2 | Lock held by another Mac | Stop; alert every run until `unlock --force` |
| S3 | Lock held and fresh | Exit as busy; counted in `lock-status.json`; alert after 3 in a row |
| S4 | Lock stale | Break it by the protocol (A12), then continue |
| S5 | Ledger missing, corrupt or invalid, or wrong permissions | Stop; alert; restore needs Peter's yes |
| S6 | A visible tool is on neither the allowed nor the denied list | Stop; alert |
| S7 | Connector authentication fails | Stop; alert |

### Message rows (ingest)

Each message is processed in time order. Before the rows are checked, the A4 precedence applies: an automatic message or an acknowledgement is treated as `needs_reply` = no. Rows are checked in order and the first match applies. A message whose row would break an invariant is set aside in `skipped`, with a report line and an alert, and the run continues.

| # | Message | Guard | Result |
|---|---|---|---|
| M1 | Any | Thread owned by another routine, before its expiry | Noted; a human message gets a report line |
| M2 | Any | At or before the latest ended generation's watermark | Noted only |
| M3 | Suspicious | Any | Noted; no reply need; an open ask is unchanged; a report line each run until Peter replies or deletes it |
| M4 | Out-of-office | Ask open | Due moves to after an agreed return date, if later |
| M5 | Bounce naming an ask recipient | Ask open | Ask blocked (reason `bounce`); needs you |
| M6 | Other automatic mail | Any | Noted only |
| M7 | Human, from someone else | No generation | Opens generation 1 if `needs_reply` is yes or unsure; otherwise noted |
| M8 | Human, from someone else | Latest generation ended | Opens the next generation if `needs_reply` is yes. If unsure: report line only. If no: noted |
| M9 | Human, from someone else | Generation active | 1. The ask effect from A5. 2. If `needs_reply` is yes or unsure, and the message is later than the current reply target, it becomes the reply target. Jordan's unchanged draft that answers an older message, or Jordan's unchanged chase draft, is marked out of date, to be removed in Act and replaced by a reply (which restates any open ask). A Peter-edited draft or Peter's own draft waiting in the thread gets the daily report line |
| M10 | From Peter, only to his own or team addresses | Any | Noted only |
| M11 | From Peter | No generation | Opens generation 1 with the ask open if `is_ask` is yes or unsure |
| M12 | From Peter | Latest generation ended | Opens the next generation with the ask open only if `is_ask` is yes |
| M13 | From Peter | Generation active | 1. The reply need is cleared if his email is later than the reply target. 2. If his email is Jordan's draft being sent (matched by internet message id, or by the thread plus matching or similar text), that draft is recorded as sent. Any other unchanged Jordan draft in the thread is queued for guarded removal. 3. The ask, following A5. `closes_ask` yes: cancelled. `is_ask` yes or unsure: this email becomes the new basis, with its own deadline or the default, the old deadline dropped, a new summary and the chase count reset. Otherwise: the basis and any agreed deadline are kept, and only the default restarts; if the kept deadline is at or before this email, the default from this email applies. Blocks for `failures` and `bounce` are cleared |

### Draft rows (observe)

These are checked in order for each tracked draft, after the A11 recovery steps have run where a draft was not found. The first match applies.

| # | Found | Guard | Result |
|---|---|---|---|
| DR1 | Its internet message id under a new Outlook id | Any | Re-keyed |
| DR2 | In Sent Items, or no longer a draft | Any | Recorded as sent; M13 applies if ingest has not already applied it |
| DR3 | In Outbox | Any | Waits; reported after 3 runs |
| DR4 | In Drafts | Any | Last-seen horizon and preview fingerprint updated. Any edited field changed (A6): the owner becomes Peter-edited, for good |
| DR5 | In Deleted Items | "Removed by Jordan" mark set | Recorded as removed by Jordan; the draft slot is cleared; a replacement may follow |
| DR6 | In Deleted Items | No mark, and Peter emailed in the thread since the draft was last seen | Takeover if that email is an ask to someone outside his own and team addresses (the draft is recorded as superseded). Otherwise E1 (deleted), with the watermark at the later of the horizon and that email |
| DR7 | In Deleted Items | No mark, no email from Peter since it was last seen | E1 (deleted) |
| DR8 | In another folder | Any | Recorded as filed: no longer observed, no longer blocking; the reply need is cleared; the generation stays active |
| DR9 | Not found, the A11 searches complete, and Peter emailed in the thread since it was last seen | Any | Recorded as superseded; missing cleared; the chain carries on as Peter's reply |
| DR10 | Not found, the A11 searches complete, no email from Peter | First time | Marked missing; the thread is blocked (`missing`). At least 45 minutes later, still the same, and ingest is past the missing time: E1 (gone) |
| DR11 | An unknown draft in the thread | No pending operation | Recorded as Peter's own draft (this includes a recorded draft that has come back); it blocks drafting |
| DR12 | Peter's own draft gone | Checked in Sent Items since the horizon first | Sent: M13 applies. Not sent: cleared, and the reply need stays (D18) |
| DR13 | Peter's own draft appears while Jordan's unchanged draft waits | Any | Jordan's draft queued for guarded removal (D21); reported |

A capped or failed search never matches DR9 or DR10: the draft simply stays as it was until a complete search is possible.

### Ending procedure

| # | Step |
|---|---|
| E1 | In order: 1. Split: any reply need (`needs_reply` yes) or ask (`is_ask` yes) whose message is after the watermark moves into a new generation (cause: carry-forward), with its basis intact. So does an out-of-date edited draft's newer yes message (D23). Unsure items after the watermark get the report line instead. 2. The remaining ask becomes ended (summary and recipients cleared, chase count kept); the reply need, draft and pending operation are cleared. 3. Any Peter draft moves to the thread's list. 4. The end is recorded: when, why, the watermark and the draft |

### Act rows

| # | Action | Guard | Result |
|---|---|---|---|
| AR1 | Guarded removal | Jordan-owned; a full read in the same run shows it in Drafts and unchanged | Marked, removed and read back (A10). Allowed even when the scan is incomplete |
| AR2 | Create a reply | Generation active; reply needed; target still in the Inbox and the latest human message; no email from Peter in the thread since the target; no draft, pending operation or block; scan complete with no unread ids; page-1 checks clean; budget reserved | Staged create (A10) |
| AR3 | Create a chase | As AR2, plus: ask open and not blocked; due time passed; no reply needed; basis email found; To not empty; re-check clean | Staged create, then a recipients-only update; chase count up |
| AR4 | A reply or chase is due while any draft waits | Any | Daily 07:30 report line |
| AR5 | Reply target no longer in the Inbox | Reply needed | Reply need cleared. If Jordan's unchanged reply draft waits, it is queued for guarded removal. The ask is unchanged |
| AR6 | The chase basis cannot be found | Ask open | Use Peter's previous email in the thread; otherwise the ask is blocked, and needs you |
| AR7 | An operation's outcome | See A10 | Refused, recipients mismatch or ambiguous, as A10 says |

## Appendix 2: crash points

| The run dies after | The next run |
|---|---|
| Nothing saved | Normal |
| The intent was saved, before the call | Reconciliation: R9 looks twice; if nothing Jordan-like is found, it drafts once |
| The call succeeded, but the response was lost | Finds the draft by thread and text (R5 or R6), or treats it as sent (R2) or deleted (R7) |
| The draft id was saved, before the read-back | R1: reads it by id and resumes. `NOT_FOUND` means it follows A11, never "not created" |
| The read-back was saved, before the recipients update | R1: updates the recipients if the draft is unchanged. If Peter has changed it, flags "check recipients before sending" |
| The recipients update succeeded, but the run died before saving it | R1: recipients equal the expected final set and the text is unchanged, so it is baselined as Jordan's, not mistaken for Peter's edit |
| The removal mark was saved, and the call's response was lost | Reads the draft; the A10 rules decide |
| Part way through ingest | Resumes from the checkpoint at the last saved message; `seen` removes the overlap |
| Mid-handover batch | Every draft was saved on its own; `progress.json` and the ledger resume from the first unfinished row |
| The Mac went to sleep mid-run | The lock goes stale after 30 minutes. If the old run wakes, its token is refused under the write guard |

## Appendix 3: invariants

Checked when the ledger loads and before every write.
- A breach while applying a message row sets that message aside (Appendix 1, message rows), and the run continues.
- Any other breach refuses the write, stops the run with no further connector calls, and alerts.

| # | Invariant |
|---|---|
| I1 | In a thread, generation numbers only go up, and only the last can be active. Thread records are never deleted |
| I2 | An ended generation has its end recorded, no reply need, an ask that is ended or absent, and no draft or pending operation. It never changes again, except when shrunk after 90 days |
| I3 | A create needs: an active generation; no draft indexed in the thread; no email from Peter since the target; a complete scan with no unread ids; not owned by another routine; and no block. The alert draft is exempt |
| I4 | At most one pending operation per thread |
| I5 | Removal and recipient updates happen only on Jordan-owned drafts, with a matching full read in the same run. The alert draft is kept separately |
| I6 | An attributed draft marked Peter-edited never goes back to Jordan |
| I7 | An open ask has a basis email and a due time later than Peter's latest email in the thread. A reply target is never from Peter's own address |
| I8 | The checkpoint never goes backwards, never passes the run's start (or, with an unverified clock, the newest mailbox time plus 2 minutes), and never passes a message that was not listed |
| I9 | A write is accepted only with the current lock token, under the write guard. Journal entries from an earlier token are replayed only after that lock was released or broken as stale |
| I10 | `init` refuses if a ledger, journal or backup already exists. Ended generations are never pruned, and active ones are compacted, never removed |
| I11 | At most one Jordan-owned draft per thread |
| I12 | No send, forward, trash or non-draft delete, ever |
| I13 | Chase recipients are exactly the basis email's To and Cc, de-duplicated as in A3, minus Peter's addresses; no Bcc; To is never empty. The alert draft is exempt |
| I14 | No message body text in the ledger, logs or report beyond the named, length-limited fields in A7 |
| I15 | Automatic, out-of-office, bounce and acknowledgement mail never closes an ask, sets a reply need or opens a generation |
| I16 | Due times are identical under `TZ=Europe/London` and `TZ=UTC` |
