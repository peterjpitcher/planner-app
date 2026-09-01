# Developer review: Customers CRM design specification

**Specification reviewed:** `docs/superpowers/specs/2026-09-01-customers-crm-design.md` (Revision 4, dated 2026-09-01)  
**Review date:** 2026-09-01  
**Review scope:** Technical design, functional completeness, security, data integrity, delivery, operations, testing and accessibility  
**Original specification changed:** No

## Overall assessment

**Readiness: Not ready for build approval.**

The product direction is clear and much of the research is sound. The specification is unusually good at calling out destructive behavior, ownership checks, phased delivery and the mismatch between NextAuth and Supabase Storage RLS. However, several core guarantees are not implementable as currently written. In particular:

- The specification promises atomic close, reopen, delete and customer-create operations, but the current Supabase JavaScript request pattern cannot make several PostgREST calls one database transaction.
- The proposed foreign keys and triggers do not enforce same-user ownership. This is especially dangerous while `projects` and `tasks` retain permissive RLS policies.
- Close/reopen behavior cannot reliably distinguish an automatic move from a later user re-file, especially after changing a closed project's customer.
- The attachment registration and deletion protocols do not prove the uploaded object's real size/type, do not bind it to an issued request, and can leave broken rows.
- The migration does not preserve existing note chronology unless `occurred_at` is explicitly backfilled from `created_at`.
- Phase 2 depends on the Phase 3 attachments table, so the phases are not independently deployable as stated.

Build work should begin only after the P0 items below are resolved in the specification. Small, isolated work such as the shared due-date input can proceed separately if it is kept outside the CRM migrations.

### Priority and status labels

- **P0 — Blocking:** Must be resolved before the affected phase is implemented.
- **P1 — High:** Must be resolved before production release.
- **P2 — Medium:** Should be resolved before implementation completes.
- **P3 — Low:** Useful improvement; can be deferred with an explicit decision.
- **Confirmed issue:** A gap, conflict or incorrect assumption supported by the specification, repository or current platform documentation.
- **Optional improvement:** A safer or simpler alternative that changes or extends the chosen design.

## Confirmed issues

### C01. Multi-row lifecycle changes have no transaction boundary

- **Relevant section:** 4.1, 7.1-7.4, 12
- **Priority:** P0
- **Type:** Architecture / data integrity
- **Status:** Confirmed issue
- **Description:** Closing, reopening and deleting now change the project, tasks, notes, attachments, close-out note and facts. The specification says these changes happen “in the same transaction,” but it places the logic in JavaScript services using the Supabase client. Separate `.update()`, `.insert()` and `.delete()` calls through PostgREST are separate transactions.
- **Rationale:** The current `PATCH /api/projects/[id]` updates the project first and cascades tasks second. It already has an explicit partial-failure response (`projectUpdated: true`). Adding more calls increases the number of inconsistent states. A service file does not create a database transaction.
- **Impact:** A close can leave the project closed while tasks remain open, notes remain on the project, facts are partly written, or the close-out note is duplicated. A delete can partly re-parent data and then fail.
- **Recommended action:** Define one database RPC per atomic operation, for example `close_project`, `reopen_project`, `delete_project_preserving_content` and `delete_customer_preserving_content`. Each RPC must lock the target row, verify `user_id`, validate the expected current state, perform all database changes, and return counts. Keep Microsoft Graph and Storage object deletion outside the transaction with a retryable outbox/status.
- **Open questions:** What should the API return when the database commits but Office 365 or Storage cleanup fails? Is an idempotency key required for repeated modal submissions?

### C02. Same-user ownership is not enforced by the proposed relationships

- **Relevant section:** 5.2-5.5, 11
- **Priority:** P0
- **Type:** Security / data integrity
- **Status:** Confirmed issue
- **Description:** New child rows have their own `user_id`, but their foreign keys point only to a parent `id`. The database therefore permits a row owned by user A to reference a customer, project, task, note or contact owned by user B. `project_contacts.user_id` can also disagree with both linked rows.
- **Rationale:** Route checks reduce risk, but service-role access bypasses RLS and mistakes in routes, migrations, RPCs or triggers remain possible. The proposed task trigger copies a customer from any project ID without checking ownership. Existing permissive `projects` and `tasks` RLS policies make this more serious.
- **Impact:** Cross-user data links, disclosure through roll-ups, destructive cascades affecting another user, and incorrect signed file access decisions.
- **Recommended action:** Add same-owner database invariants. A robust pattern is `UNIQUE (id, user_id)` on every parent and composite foreign keys such as `(customer_id, user_id) REFERENCES customers(id, user_id)`. Do the same for project/contact links and polymorphic note/attachment parents, or use constraint triggers that reject owner mismatches. Trigger and RPC code must also filter by `user_id`.
- **Open questions:** Will the permissive `projects` and `tasks` RLS policies be removed before Phase 1? If not, what compensating control is accepted?

### C03. The known permissive RLS issue should be a release dependency

- **Relevant section:** 11, 14
- **Priority:** P0
- **Type:** Security / dependency
- **Status:** Confirmed issue
- **Description:** The specification says new tables will have correct RLS but leaves the known permissive policies on `projects` and `tasks` in place. The CRM adds customer IDs to both tables and puts sensitive customer data behind their relationships.
- **Rationale:** Permissive PostgreSQL policies are ORed. The repository guidance confirms that any Supabase-authenticated JWT can currently access all project/task rows through PostgREST.
- **Impact:** Customer associations and task/customer metadata can be exposed or changed outside the NextAuth API boundary. The new task trigger can amplify a bad relationship write.
- **Recommended action:** Make removal of the permissive policies a Phase 0 release gate. Add automated cross-user tests using an authenticated Supabase JWT as well as tests through the service-role API. Revoke direct execution of new security-definer RPCs from `public`, `anon` and `authenticated`; grant only what the server actually needs, or keep them callable only through service role.
- **Open questions:** Is any client or integration still relying on direct PostgREST access to `projects` or `tasks`?

### C04. Existing lifecycle routes can bypass the new rules

- **Relevant section:** 4.1, 7, 12
- **Priority:** P0
- **Type:** Architecture / delivery
- **Status:** Confirmed issue
- **Description:** The repository has mutation handlers in both `/api/projects` and `/api/projects/[id]`. Only the `[id]` PATCH currently invokes `projectLifecycleService`; the collection PATCH and DELETE perform direct writes.
- **Rationale:** The specification says one behavior should have one implementation, but does not require removal or delegation of the duplicate routes. A caller can bypass close-out, note movement and delete safeguards.
- **Impact:** The same operation can produce different data depending on endpoint. Future code or old clients may silently skip the preservation rules.
- **Recommended action:** Choose one canonical mutation API. Remove the collection PATCH/DELETE handlers or make them call the same service/RPC. Add contract tests proving every public mutation path produces the same lifecycle result.
- **Open questions:** Are any deployed or external clients still using collection PATCH/DELETE?

### C05. Close/reopen provenance is not sufficient

- **Relevant section:** 5.4, 7.1
- **Priority:** P0
- **Type:** Functional logic / data integrity
- **Status:** Confirmed issue
- **Description:** Reopening restores rows only when `origin_project_id` matches and `customer_id` equals the project's current customer. This cannot distinguish “automatically moved on close” from “deliberately re-filed while closed.” It also fails when the project's customer changes while closed.
- **Rationale:** A moved note and a manually re-filed note share the same columns. If the project changes from Acme to Beta while closed, notes remain on Acme and will not return on reopen. If a user re-files a moved note back to the same customer, the reopen still pulls it back.
- **Impact:** The promise that notes and files return “exactly where they were” is false in valid user journeys. Data can remain with the wrong customer or move unexpectedly.
- **Recommended action:** Add explicit movement provenance, for example `lifecycle_origin_project_id`, `lifecycle_move_id` and `lifecycle_moved_at`, and clear that marker on a user re-file. Define what happens when a customer is assigned, removed or changed on an open, completed or cancelled project. Consider preventing customer changes on a closed project until it is reopened.
- **Open questions:** Should changing a closed project's customer move its lifecycle-owned notes/files to the new customer? Should assigning a customer to a project that was already closed run the close handover then?

### C06. Existing note dates will be rewritten to migration time

- **Relevant section:** 5.4, 14 Phase 2
- **Priority:** P0
- **Type:** Migration / data correctness
- **Status:** Confirmed issue
- **Description:** Adding `occurred_at timestamptz NOT NULL DEFAULT now()` gives existing notes the migration time unless an explicit backfill is performed. The specification does not include a backfill from `created_at`.
- **Rationale:** The new timeline sorts by `occurred_at`. Existing history would appear as if every note happened at deployment.
- **Impact:** Chronology and “last contact” become wrong, the attention filter becomes unreliable, and historical notes lose meaning.
- **Recommended action:** Use an expand/backfill/contract migration: add nullable `occurred_at`, set it to `created_at` for existing rows, verify zero nulls, then add the default and `NOT NULL`. Apply the same explicit decision to `updated_at`.
- **Open questions:** Should any existing note dates be corrected manually before the backfill?

### C07. Project deletion does not create the promised tombstone for already moved rows

- **Relevant section:** 5.4, 7.2
- **Priority:** P1
- **Type:** Data integrity / contradiction
- **Status:** Confirmed issue
- **Description:** Notes moved at close time have `context_label = 'From project: <name>'`. Section 7.2 says they are untouched when the project is later deleted, while the foreign key only nulls `origin_project_id`. Nothing adds “(deleted <date>)”.
- **Rationale:** `ON DELETE SET NULL` cannot update `context_label`. Once the project row is gone, the deletion date and status cannot be reconstructed from the note.
- **Impact:** The documented tombstone is not produced and the user loses the fact that the origin project was deleted.
- **Recommended action:** Before deleting the project, update every note and attachment whose `project_id` or `origin_project_id` matches it. Set the final label and any structured `origin_project_name`/`origin_deleted_at` fields inside the delete RPC.
- **Open questions:** Should tombstone data be structured columns rather than text so it can be rendered and searched consistently?

### C08. Attachment registration trusts client claims

- **Relevant section:** 8.3-8.4
- **Priority:** P0
- **Type:** Security / storage integrity
- **Status:** Confirmed issue
- **Description:** The upload URL route validates browser-supplied `size_bytes` and `mime_type`. After upload, registration only checks that an object exists. A client can upload a different size or content type, reuse a path, or submit a path not issued for that parent.
- **Rationale:** Signed upload authorizes the object transfer; it does not prove that the final object matches earlier JSON. Current Supabase JavaScript exposes `storage.info(path)`, which returns actual size and content type. `storage.exists(path)` is also available, so a bucket-wide list is not needed for a single object.
- **Impact:** The 25 MB limit, MIME allowlist and per-parent controls can be bypassed. Storage cost can grow unexpectedly and metadata may point to the wrong object.
- **Recommended action:** Create a pending attachment row before issuing the token, with server-generated path, intended parent, declared metadata, expiry and one-time state. On finalization, load exact object metadata with `info(path)`, validate actual size/type, verify the path belongs to the pending row and current user, then mark it ready. Delete invalid objects. Enforce bucket-level size and MIME limits as defense in depth.
- **Open questions:** Is extension/type agreement required? Is magic-byte inspection required for PDF, images, Office, zip, eml and msg?

### C09. The attachment delete safety claim is incorrect

- **Relevant section:** 8.4
- **Priority:** P0
- **Type:** Error handling / data integrity
- **Status:** Confirmed issue
- **Description:** The specification says deleting the object first and the row second means failure leaves a recoverable row. If object deletion succeeds and row deletion fails, the row remains but the file is already gone. The row is not recoverable.
- **Rationale:** Database and object storage cannot participate in one transaction.
- **Impact:** Users can see attachments that always fail to download, while the system reports that files are never lost.
- **Recommended action:** Use a retryable deletion state/outbox. Mark the row `deleting`, commit, delete the object, then delete or mark the row `deleted`. Retry failures. Reconciliation must detect both blob-without-row and row-without-blob cases. User-facing deletion should report “scheduled” until complete if needed.
- **Open questions:** Is temporary soft deletion/restoration required? How long should deleted file metadata be retained?

### C10. Reconciliation will miss objects and broken rows

- **Relevant section:** 8.4
- **Priority:** P1
- **Type:** Operations / storage
- **Status:** Confirmed issue
- **Description:** The weekly job says it lists the bucket and compares paths, but Supabase `list()` defaults to 100 results and lists one folder level. The path design is nested by user, parent type and parent ID. The job also only removes blobs without rows; it does not flag rows whose blobs are missing.
- **Rationale:** A non-recursive, non-paginated scan will silently stop. A whole-bucket comparison may also exceed a Vercel function duration as data grows.
- **Impact:** Orphans accumulate, missing files remain visible, and monitoring gives false confidence.
- **Recommended action:** Specify recursive pagination or, preferably, use pending/deleting attachment states so cleanup queries the database for bounded batches. Add a separate missing-object check. Persist run counts, failures and cursors. Supabase documents the 100-item default for `list()`.
- **Open questions:** What is the expected attachment volume and Vercel plan/runtime limit? Who is alerted after repeated cleanup failure?

### C11. Note deletion has no attachment lifecycle

- **Relevant section:** 5.5, 7.4, 12
- **Priority:** P1
- **Type:** Functional gap / data integrity
- **Status:** Confirmed issue
- **Description:** Attachments can belong to notes, and notes become editable/deletable, but the specification does not say what happens to a note's attachments when that note is deleted.
- **Rationale:** The foreign key uses `ON DELETE SET NULL`, so a raw delete creates unfiled files with no context label. The “file is never destroyed” principle requires an explicit behavior.
- **Impact:** Files unexpectedly enter Unfiled without explanation, or route implementations may delete them inconsistently.
- **Recommended action:** Add “Note deleted” to the lifecycle table and impact copy. Recommended default: re-parent to the note's effective customer/project/task, otherwise unfiled, preserving a tombstone. Define behavior for hard-deleting an already unfiled note.
- **Open questions:** Should deleting a note ever offer “delete its files too”?

### C12. Phase 2 depends on a Phase 3 table

- **Relevant section:** 14 Phase 2 and Phase 3
- **Priority:** P1
- **Type:** Delivery / contradiction
- **Status:** Confirmed issue
- **Description:** Phase 2 includes attachment handover on close and reopen, but the attachments table and service are created in Phase 3.
- **Rationale:** Phase 2 cannot execute attachment updates when the table does not exist, so the phases are not independently deployable as claimed.
- **Impact:** Deployment ordering is unclear and Phase 2 code may fail before Phase 3.
- **Recommended action:** Remove every attachment operation from Phase 2. Add attachment lifecycle behavior only in Phase 3, after the table exists. State that Phase 3 depends on Phase 2 customer/note lifecycle fields.
- **Open questions:** Does Phase 2's UI mention file counts before attachments exist?

### C13. `@customer` creation is not atomic and races in multi-line capture

- **Relevant section:** 9.3, 12
- **Priority:** P0
- **Type:** Concurrency / functional logic
- **Status:** Confirmed issue
- **Description:** The spec correctly requires customer creation and task creation in one request, but one request is not the same as one database transaction. `/today` currently creates up to 25 tasks in parallel. Two lines using the same new customer can race on the unique index.
- **Rationale:** One insert may win; another may receive a uniqueness error and fail its task. A customer can still be left empty if the task insert fails after customer creation.
- **Impact:** Partial failures, junk customers and confusing multi-line results.
- **Recommended action:** Implement an atomic `create_task_with_customer` RPC using normalized name, `INSERT ... ON CONFLICT ... DO UPDATE/NOTHING`, then create the task in the same transaction. Define the conflict/retry path. For multi-line capture, either add a batch RPC or group customer creation before task requests while preserving per-line results.
- **Open questions:** If two lines create the same new customer, should the success message report one customer creation or one per line?

### C14. Customer token grammar has unhandled valid text

- **Relevant section:** 9.3-9.4
- **Priority:** P1
- **Type:** Functional ambiguity / UX
- **Status:** Confirmed issue
- **Description:** Token boundaries, escaping and multiple-token behavior are not defined. Examples such as `Email joe@acme.com`, `Check @Acme,`, `Talk to @Acme @Beta`, Unicode names, apostrophes, slashes, unmatched quotes and an `@` inside ordinary text are unspecified.
- **Rationale:** The project input rejects any detected customer token before writing. A loose parser could reject normal email-address tasks or create unwanted customers.
- **Impact:** False customer creation, blocked task capture and saved names that differ from the preview.
- **Recommended action:** Specify a grammar: an `@` token starts only at the beginning or after whitespace; quoted form has defined escaping; punctuation terminates unquoted names; at most one token is accepted; malformed/multiple tokens produce a clear preview error. Add examples and tests for email addresses and punctuation.
- **Open questions:** Should unquoted new customer creation support more than one word at all? What characters are valid in customer names?

### C15. Customer-workspace token behavior is incomplete

- **Relevant section:** 9.4, 13.7
- **Priority:** P1
- **Type:** Functional ambiguity
- **Status:** Confirmed issue
- **Description:** The specification says a token on the customer workspace is accepted and harmless when it resolves to the same customer. It does not say what happens when it names or creates a different customer.
- **Rationale:** The input already has a fixed customer context. Accepting another value can contradict what the UI shows, just as on a project.
- **Impact:** A task can be filed to an unexpected customer or a junk customer can be created.
- **Recommended action:** Reject any token that does not resolve to the current customer, before creation. Treat a same-customer token as redundant and strip it with a preview note, or reject all tokens for simpler behavior.
- **Open questions:** Is there any user need to move context from inside the capture line?

### C16. Archived and inactive customer matching is undefined

- **Relevant section:** 5.1, 7.3, 9.3, 13
- **Priority:** P1
- **Type:** Functional gap
- **Status:** Confirmed issue
- **Description:** The spec does not say whether autocomplete, `@Name`, `for Name`, project pickers or search include archived, Dormant or Former customers. The unique name index still blocks creation of an archived name.
- **Rationale:** If capture excludes archived customers, `@Acme` cannot create Acme and may fail on the hidden unique row. If it includes them, a new task can silently reactivate work against an archived customer.
- **Impact:** Capture errors and hidden work linked to archived records.
- **Recommended action:** Define eligibility per surface. Recommended: show archived matches clearly, never auto-create on a conflicting archived name, and require explicit unarchive or confirmation before assigning new work.
- **Open questions:** Does assigning a project/task to Dormant or Former automatically change status to Active?

### C17. Customer archive and lifecycle status overlap without rules

- **Relevant section:** 5.1, 7.3, 13
- **Priority:** P2
- **Type:** Data model / UX
- **Status:** Confirmed issue
- **Description:** `status` includes Dormant and Former while `archived_at` separately hides a customer. Valid combinations and transitions are not defined.
- **Rationale:** A customer can be Active and archived, Former and visible, or Dormant and archived. List filters expose Active and Prospect but not Dormant or Former.
- **Impact:** Inconsistent filters, confusing automation and hard-to-test UI.
- **Recommended action:** Add a state table defining each status, whether it can receive new work, and how archive differs. Either make archive independent with clear rules, or simplify by using status alone. Add all lifecycle states to filter behavior.
- **Open questions:** What should archive do when open projects/tasks exist? Can an archived customer be opened from a linked project?

### C18. Customer/project reassignment effects are missing

- **Relevant section:** 5.4, 7.1, 10.1, 13
- **Priority:** P0
- **Type:** User journey / data integrity
- **Status:** Confirmed issue
- **Description:** The specification covers setting a customer and automatic task inheritance, but not changing or clearing a project's customer after it has notes, contacts, files, closed history or Microsoft To Do mappings.
- **Rationale:** The task trigger repoints every project task, including completed tasks. Direct project notes/files remain on the project and roll up to the new customer. Lifecycle-moved notes may remain on the old customer. Office list names change later.
- **Impact:** Historical work can jump between customers, closed notes can be stranded, and completed reports can be rewritten.
- **Recommended action:** Define assignment, reassignment and removal for open and closed projects. Show an impact preview. Decide whether historical items follow the project, remain with the old customer, or are snapshotted. Run the change through an atomic service/RPC.
- **Open questions:** Can a project ever belong to more than one customer? Is reassignment a correction or a business transfer?

### C19. Completed reporting has no historical attribution rule

- **Relevant section:** 2, 5.4, 10.2, 14 Phase 4
- **Priority:** P1
- **Type:** Reporting / data semantics
- **Status:** Confirmed issue
- **Description:** Grouping completed work by current `tasks.customer_id` means changing a project's customer repoints already completed tasks. Deleting a customer clears the ID. Historical reports will change after the work was done.
- **Rationale:** The requested question is “what did I do for them last month,” which normally needs attribution at completion time, not current ownership.
- **Impact:** Reports are not reproducible and past customer totals disappear or move.
- **Recommended action:** Decide whether reporting is current-state or historical. If historical, add a completion snapshot (`completed_customer_id`, and possibly immutable display name) or an assignment history table. Define project completion attribution too.
- **Open questions:** Should renamed customers update old report labels? How are unassigned and deleted customers displayed?

### C20. “Customer delete” behavior is ambiguous for rolled-up data

- **Relevant section:** 7.3, 13
- **Priority:** P1
- **Type:** Functional ambiguity / privacy
- **Status:** Confirmed issue
- **Description:** The customer view contains direct notes/files plus items reached through projects and tasks. Section 7.3 says notes and attachments become unfiled, but database actions only directly affect rows whose `customer_id` points to the deleted customer. Notes/files parented to surviving projects, tasks or notes remain there.
- **Rationale:** “Delete customer” can mean delete only the account row or remove all data seen on its page. The current wording supports both readings.
- **Impact:** The impact preview can mislead users, and privacy/erasure expectations may not be met.
- **Recommended action:** State explicitly that hard delete removes the customer record but preserves records through their direct parents, if that is intended. Break impact counts into direct, project-owned, task-owned and note-owned data. Use “Remove customer record” wording if associated content remains.
- **Open questions:** Is there a separate true erasure workflow? Does hard delete need recent re-authentication?

### C21. Contact uniqueness rejects legitimate people

- **Relevant section:** 5.3
- **Priority:** P1
- **Type:** Data model
- **Status:** Confirmed issue
- **Description:** The unique index allows only one contact with a given normalized name per customer and only one same-named standalone contact per user.
- **Rationale:** Two people at one company can share a name. Two standalone contacts can also share a name. A name is not an identity key.
- **Impact:** Valid contacts cannot be created; backfill may merge different people and attach the wrong details to projects.
- **Recommended action:** Remove name uniqueness as a hard constraint. Use a non-unique lookup index and a duplicate warning based on name plus email/phone. Give the user a merge flow rather than forcing deduplication in SQL.
- **Open questions:** Can one person move between customers or be linked to multiple customers? Is customer membership historical?

### C22. Stakeholder backfill assertions are underspecified

- **Relevant section:** 5.3, 14 Phase 2
- **Priority:** P1
- **Type:** Migration / data quality
- **Status:** Confirmed issue
- **Description:** “Every non-empty stakeholder string must produce exactly one project_contacts row” conflicts with case-insensitive deduplication and the link table primary key when a project contains duplicate names. The treatment of commas, blank elements, whitespace-only values and same names across customer/no-customer projects is not defined.
- **Rationale:** The current field is a `text[]` produced from comma-separated UI input, so live data may contain duplicates or formatting artifacts.
- **Impact:** The migration can fail unexpectedly or silently merge distinct people.
- **Recommended action:** Add a preflight profiling query and explicit normalization rules. Report counts for source elements, normalized distinct project/name pairs, inserted contacts, inserted links and rejected/ambiguous values. Keep a migration exceptions table or export for manual review.
- **Open questions:** Should email-like stakeholder entries be treated as names, emails or left untouched? Who approves ambiguous merges?

### C23. Primary-contact writes require atomic swap behavior

- **Relevant section:** 5.3, 12
- **Priority:** P2
- **Type:** Data integrity / API
- **Status:** Confirmed issue
- **Description:** The partial unique index correctly allows at most one primary contact, but changing the primary can fail if the new row is set true before the old row is cleared. `is_primary = true` is also allowed on standalone contacts even though it has no defined meaning.
- **Rationale:** Two client PATCH calls are not atomic.
- **Impact:** Intermittent uniqueness errors and inconsistent UI.
- **Recommended action:** Provide a `set_primary_contact(customer_id, contact_id)` RPC that clears and sets within one transaction. Add a check that standalone/archived contacts cannot be primary, or define that behavior.
- **Open questions:** Is zero primary contact allowed? What happens when the primary contact is archived or moved?

### C24. Field validation and safe rendering rules are incomplete

- **Relevant section:** 5.1-5.5, 8.4, 12
- **Priority:** P1
- **Type:** Security / validation
- **Status:** Confirmed issue
- **Description:** Most new text fields have no maximum length or normalization. `website` has no scheme rule; facts allow blank values; emails and phones have no bounds; attachment names and MIME strings have no bounds. The UI will render website links and copy contact values.
- **Rationale:** The existing project uses explicit validation limits. An unvalidated `website` can use an unsafe scheme such as `javascript:` if placed directly in `href`. Very large text also harms search indexes and response sizes.
- **Impact:** Unsafe navigation, broken layouts, oversized payloads and inconsistent matching.
- **Recommended action:** Define server and database limits for every field. Allow only `http:`/`https:` website URLs, render external links with safe attributes, normalize whitespace, reject control characters, and use 409 for normalized-name conflicts. Add a non-blank check for fact values.
- **Open questions:** Are internationalized domain names, extensions without MIME, and international phone formats required?

### C25. Sensitive information is invited without a protection rule

- **Relevant section:** 1.1, 5.2, 11
- **Priority:** P0
- **Type:** Security / privacy
- **Status:** Confirmed issue
- **Description:** The problem statement lists “a portal login” as a customer fact. Facts, notes and contacts are stored as plain text and searchable. There is no encryption, redaction, secret classification, audit or instruction not to store passwords.
- **Rationale:** A login can include a password, recovery code or API key. Service-role compromise, logs, backups and search responses would expose it.
- **Impact:** Credential compromise and a much higher security/privacy burden than a planning app should carry.
- **Recommended action:** Add explicit wording: “Do not store passwords, API keys, recovery codes or other secrets in customer facts, notes or files.” If credential storage is genuinely required, design a separate encrypted vault workflow with masked display, recent re-authentication and audit logging.
- **Open questions:** Does “portal login” mean only a username/URL, or credentials too? What privacy obligations apply to customer/contact data?

### C26. API contracts are only a route list

- **Relevant section:** 12
- **Priority:** P1
- **Type:** API design / delivery
- **Status:** Confirmed issue
- **Description:** Request/response schemas, identifiers, pagination, validation errors, conflict codes and idempotency are missing. Several paths are ambiguous: PATCH/DELETE facts need a fact ID; PATCH/DELETE contacts need a contact ID; project-contact PUT could mean replace-all or add-one; `/api/notes/unfiled` claims to return files too but no re-file endpoint is listed.
- **Rationale:** These choices affect component state, caching, ownership checks and test design.
- **Impact:** Developers will invent incompatible contracts during implementation and miss ownership checks on nested resources.
- **Recommended action:** Add compact endpoint contracts or JSON schemas. Use resource paths such as `/api/customers/[customerId]/facts/[factId]` and `/api/contacts/[contactId]`. Define 400/401/403/404/409/413/429 responses, pagination cursors, and idempotency behavior.
- **Open questions:** Does the overview endpoint return normalized resources or duplicated nested objects? How is re-filing notes/files represented?

### C27. Timeline ordering and pagination are not deterministic

- **Relevant section:** 5.4-5.6, 12, 13.8
- **Priority:** P1
- **Type:** Data query / functional detail
- **Status:** Confirmed issue
- **Description:** The timeline merges notes and attachments, sorts by `occurred_at`, and keeps pinned items at the top. Attachments have no `occurred_at`. There is no tie-breaker, page size or cursor, and pinning can move an item across already loaded pages.
- **Rationale:** Offset pagination over a changing merged union will duplicate or skip rows. A global pinned set can also dominate every page.
- **Impact:** Missing/duplicated timeline entries and unstable UI.
- **Recommended action:** Define two sections: pinned items, then chronological stream. Give attachments an event time rule (`created_at` or their own `occurred_at`). Use a stable cursor such as `(event_at, entity_type, id)` and state how source filters affect it. Cap/paginate pinned items separately.
- **Open questions:** Does editing `occurred_at` move an item immediately? Are future dates allowed? Is the input a London date or exact timestamp?

### C28. Search will not meet the stated search behavior

- **Relevant section:** 2, 5.6, 12, 14 Phase 4
- **Priority:** P1
- **Type:** Search / performance
- **Status:** Confirmed issue
- **Description:** English full-text search is proposed for free text, names, emails, phone numbers, websites and account identifiers. PostgreSQL English tokenization is not enough for partial names, punctuation-heavy email/phone/URL values or typo matching. Ranking, prefix behavior, archived scope and pagination are not defined.
- **Rationale:** The same feature also needs near-miss matching for `@Name`, but no `pg_trgm` or application algorithm is specified.
- **Impact:** “Search across every note, customer, fact and contact” will appear broken for common CRM data.
- **Recommended action:** Define search acceptance examples. Use a combined approach: full text for notes/summary, normalized `ILIKE` or trigram indexes for names/labels/email/phone, exact normalized matching for identifiers. Return typed, ranked, paginated results scoped by `user_id`.
- **Open questions:** Should archived and unfiled items be included by default? Is typo tolerance required in global search or only capture hints?

### C29. Customer overview metrics lack definitions

- **Relevant section:** 12, 13
- **Priority:** P2
- **Type:** Analytics / functional detail
- **Status:** Confirmed issue
- **Description:** `open_project_count`, `open_task_count`, `last_contact_at` and “Needs attention” are named but not formally defined.
- **Rationale:** The task model has multiple active and closed states. A timeline note, email, attachment or document may or may not count as contact. Backdated notes can move the date.
- **Impact:** List badges, filters and API counts disagree.
- **Recommended action:** Define exact status sets using existing constants, which parent levels are included, which note sources count as contact, how null history behaves, and the Europe/London date boundary. Put the rule in one SQL view/RPC or service.
- **Open questions:** Does a plain internal note count as customer contact? Does an attachment upload count?

### C30. Office 365 adoption is ambiguous for duplicate and truncated names

- **Relevant section:** 10.1, 16
- **Priority:** P0
- **Type:** Integration / data loss risk
- **Status:** Confirmed issue
- **Description:** Adoption by composed name and then bare project name is unsafe when two projects share a name or when truncation produces the same display name. “First match wins” can attach the wrong remote list. Truncating the customer first also does not handle a project name that alone exceeds 100 characters.
- **Rationale:** The database does not require unique project names. Microsoft documents `displayName` as a string but does not publish the 100-character limit used by the spec. An arbitrary truncation can create collisions.
- **Impact:** Tasks can sync to the wrong Microsoft list or duplicate lists can be created. This is more severe than a cosmetic rename.
- **Recommended action:** Never adopt an ambiguous name automatically. If multiple candidates exist, keep the mapping unresolved and surface it. Define truncation for both parts and add a stable short suffix derived from project ID when truncation occurs, or prove the real live limit before adding a cap. Test throttling and resumable bulk rename.
- **Open questions:** Are duplicate project names present in production? Can a stable project identifier be stored in a Graph extension or list metadata?

### C31. Office 365 privacy and rollout effects are missing

- **Relevant section:** 10.1, 14 Phase 1
- **Priority:** P1
- **Type:** Integration / privacy / deployment
- **Status:** Confirmed issue
- **Description:** The first sync after deployment performs a bulk rename that sends customer names to Microsoft and may make many Graph PATCH calls. There is no consent/notice, feature flag, rate-limit plan, progress reporting or rollback.
- **Rationale:** Customer names may be sensitive. Microsoft Graph throttling or a partial run can leave mixed naming until later syncs.
- **Impact:** Unintended data disclosure to a connected third party, throttling and inconsistent lists.
- **Recommended action:** Add a rollout gate and one-time migration summary. Confirm the user accepts customer names in Microsoft To Do. Make renames retryable and measurable, handle 429 `Retry-After`, and do not treat mixed names as a failed CRM deployment.
- **Open questions:** Should users be able to disable the customer prefix while keeping task sync?

### C32. Closed-project task restoration is not provenance-safe

- **Relevant section:** 7.1, 7.6, 17
- **Priority:** P1
- **Type:** Existing lifecycle risk
- **Status:** Confirmed issue
- **Description:** The spec says cancelled tasks return to backlog on reopen “as today.” Current code restores every cancelled task in the project, not only tasks cancelled by the project-close cascade.
- **Rationale:** There is no marker recording the previous task state or why it was cancelled.
- **Impact:** Tasks intentionally cancelled before the project closed can be revived. The new CRM work would preserve and further rely on an inaccurate lifecycle assumption.
- **Recommended action:** Record cascade provenance and, ideally, previous state in the same close transaction. Restore only rows changed by that close operation. If keeping current behavior, state it as a known limitation rather than “previously cancelled by the cascade.”
- **Open questions:** Should restored tasks return to their original state/section or always backlog?

### C33. Existing data has no customer adoption journey

- **Relevant section:** 2, 5.3, 14 Phase 1-2
- **Priority:** P1
- **Type:** Migration / user journey
- **Status:** Confirmed issue
- **Description:** New customer IDs cannot be inferred from existing stakeholder text, so all existing projects and tasks remain customerless until manually edited. The spec adds a picker but no guided migration, bulk assignment or progress view.
- **Rationale:** The main value depends on linking current work. Stakeholder backfill creates standalone contacts when projects have no customer, which may later need manual reassignment too.
- **Impact:** The first release may appear empty and users may duplicate customers or leave most history outside customer views.
- **Recommended action:** Add a post-Phase-1 onboarding flow: create/select a customer, bulk assign projects, preview inherited tasks, and show remaining unassigned projects/contacts. Delay stakeholder backfill until customer assignment is reasonably complete, or support safe contact reassignment.
- **Open questions:** Can current stakeholder names seed suggested customer names? How many live projects require manual assignment?

### C34. Migration and rollback sequencing is missing

- **Relevant section:** 14, 17
- **Priority:** P0
- **Type:** Deployment / migration
- **Status:** Confirmed issue
- **Description:** Each phase mixes schema, triggers, code and destructive data movement without an expand/backfill/contract deployment order, feature flags, rollback rules or backups. Rolling application code back after notes have moved can make those notes invisible to old queries.
- **Rationale:** Old `ProjectNotes` only queries `project_id`; moved notes have that field null. Dropping new columns or reverting the app after movement breaks visibility.
- **Impact:** A failed deploy can look like data loss even if rows remain. Destructive migrations cannot be safely rolled back.
- **Recommended action:** Define forward-compatible release steps for every phase: schema expand, backfill and verify, dual-compatible code deploy, feature flag enable, observation window, then contract cleanup. Take a production database backup before lifecycle migrations. Treat note movement and stakeholder drop as forward-only; use a corrective migration, not rollback.
- **Open questions:** What is the accepted maintenance window? Is preview/staging connected to a representative Supabase clone?

### C35. The verification plan does not match the repository

- **Relevant section:** 17
- **Priority:** P1
- **Type:** Testing / delivery
- **Status:** Confirmed issue
- **Description:** The spec refers to 289 tests and requires typecheck. The repository currently has 31 Vitest files and 432 passing tests, and no typecheck script. Database triggers, constraints, migrations and Storage are not covered by the current unit-test setup.
- **Rationale:** `npm test -- --reporter=dot` passed 432 tests during this review. `npm run lint` passed. `package.json` has no typecheck command and the app is plain JavaScript.
- **Impact:** The stated release gate cannot be run as written, and mocked tests can pass while the actual database/storage design fails.
- **Recommended action:** Replace stale counts with commands, not expected totals. Remove “typecheck” or add a real `tsc --allowJs --checkJs`/JSDoc check. Add local Supabase integration tests that apply migrations and exercise RPCs/triggers/constraints, API route tests with two users, Storage integration tests, Graph contract mocks, and browser E2E for critical journeys.
- **Open questions:** Will CI run a local Supabase stack? Is a production-like Microsoft test account available?

### C36. Accessibility requirements are absent

- **Relevant section:** 9, 13, 17
- **Priority:** P1
- **Type:** Accessibility / UX
- **Status:** Confirmed issue
- **Description:** The new design relies on autocomplete, drag-to-reorder facts, drag/drop upload, status dots, source icons, inline editing, two independent scroll regions and modal steps, but gives no keyboard, screen-reader, focus or color requirements.
- **Rationale:** These patterns commonly fail without explicit acceptance criteria.
- **Impact:** Keyboard and assistive-technology users may be unable to create customers, reorder facts, upload files, understand state or recover from errors.
- **Recommended action:** Add WCAG 2.2 AA acceptance criteria: ARIA combobox behavior, keyboard alternative for reorder/upload, text labels in addition to color/icons, focus return after mobile push/modals, announced async results/progress, visible focus, minimum touch targets, and no focus loss on inline save failure. Add axe checks plus manual keyboard/screen-reader tests.
- **Open questions:** Is drag reorder necessary in the first release? Which screen readers/browsers are supported?

### C37. Customer overview and timeline need a query/performance design

- **Relevant section:** 5.4-5.6, 12, 13
- **Priority:** P1
- **Type:** Performance / architecture
- **Status:** Confirmed issue
- **Description:** The overview returns counts, open and closed projects, a task union, facts, contacts, attachments and timeline page one. The spec does not show whether this is one RPC, many queries, correlated counts or client fan-out. Some indexes omit `user_id`, although every service query scopes by user.
- **Rationale:** The current API already paginates tasks/projects. A large nested overview can exceed response limits and create slow plans or N+1 requests.
- **Impact:** Slow customer selection, stale partial sections and expensive search/roll-up queries.
- **Recommended action:** Write representative SQL and run `EXPLAIN (ANALYZE, BUFFERS)` on production-like volume. Set page sizes and response budgets. Add indexes that match real predicates/order, including user scope where needed. Consider loading independent sections in parallel rather than blocking the whole workspace on one overview response.
- **Open questions:** Expected maximum customers, projects, tasks, notes, contacts and files per user/customer? Required customer-switch response time?

### C38. Cache invalidation and concurrent editing are not defined

- **Relevant section:** 12, 13
- **Priority:** P2
- **Type:** Client state / concurrency
- **Status:** Confirmed issue
- **Description:** New mutations affect customer lists, project lists, task views, counts, search, unfiled badges and Office naming. The specification only says `apiClient` gets methods and a cached capture list. It does not define invalidation or stale-write handling.
- **Rationale:** Existing `dedupedFetch` uses manual key clearing and task events. Customer rename/create/archive in another tab can leave capture autocomplete stale. Two edits can overwrite each other.
- **Impact:** Wrong autocomplete results, stale counts and lost edits.
- **Recommended action:** Define cache keys and invalidation events for every mutation. Add `updated_at` preconditions/ETags for destructive or high-value edits and return 409 on stale writes. Refresh the customer-name cache after uniqueness conflicts and on window focus.
- **Open questions:** Is multi-tab use expected? Is last-write-wins acceptable for summary, facts and notes?

### C39. Monitoring and support behavior are missing

- **Relevant section:** 8.4, 10, 14, 16, 17
- **Priority:** P1
- **Type:** Monitoring / operations
- **Status:** Confirmed issue
- **Description:** The design adds high-risk lifecycle RPCs, file storage, background reconciliation, search and a bulk Graph rename but no success metrics, alerts, audit records or support diagnostics.
- **Rationale:** Existing code often logs warnings. Serverless console output alone will not prove that notes were moved, orphans were removed or list adoption remained safe.
- **Impact:** Silent data inconsistency can persist until a user notices it.
- **Recommended action:** Define structured events and counters: lifecycle operation ID/counts, failed/partial external cleanup, pending uploads by age, missing/orphan blobs, reconciliation cursor/result, Graph rename/adoption ambiguity, search latency and API error rate. Alert on repeated cron/RPC failures. Do not log signed URLs, note content, customer facts or filenames unnecessarily.
- **Open questions:** What monitoring platform is available? Who owns alerts and data repair?

### C40. Storage backup, quota and malicious-content policy are missing

- **Relevant section:** 8
- **Priority:** P1
- **Type:** Security / operations / cost
- **Status:** Confirmed issue
- **Description:** A 25 MB per-file and 50-per-parent cap still allows large total storage. There is no per-user quota, retention/backup/restore statement, malware policy or user guidance for zip/eml/msg files.
- **Rationale:** MIME is client-controlled unless independently checked. Database backups do not by themselves establish a tested restore plan for Storage objects. “Nothing is lost” requires recovery beyond application-level cascades.
- **Impact:** Cost growth, unsafe downloads and permanent loss after provider/user error.
- **Recommended action:** Set and monitor per-user/total quotas. Document whether Storage objects are backed up and test restore. Consider malware scanning or clearly state that files are stored/downloaded without scanning. Force downloads with the original filename rather than inline rendering for risky types.
- **Open questions:** What Supabase plan/quota is in use? What recovery point and recovery time are acceptable?

### C41. Attachment UX and failure handling are incomplete

- **Relevant section:** 8.3-8.4, 13.9
- **Priority:** P2
- **Type:** UX / error handling
- **Status:** Confirmed issue
- **Description:** Drag/drop and the three-step upload flow do not define progress, cancel, retry, duplicate names, multiple files, token expiry, network loss after upload, parent deletion during upload or an upload that completes after navigation.
- **Rationale:** These are normal direct-upload outcomes, especially for 25 MB files.
- **Impact:** Users retry and create duplicates, believe a file is saved when it is only a blob, or lose track of failed uploads.
- **Recommended action:** Define upload states (`pending`, `uploading`, `finalizing`, `ready`, `failed`), visible progress, retry/cancel, keyboard file selection and resumable behavior expectations. Finalization must be idempotent. Handle 404 parent and expired token explicitly.
- **Open questions:** Are parallel multi-file uploads required? Is 25 MB reliable enough without TUS on expected connections?

### C42. Delivery phases are too large and lack acceptance gates

- **Relevant section:** 14
- **Priority:** P1
- **Type:** Delivery planning
- **Status:** Confirmed issue
- **Description:** Phase 1 contains a capture refactor, schema/triggers, full customer CRUD and page, project assignment, parser grammar, auto-creation and Office 365 rename. Phase 2 contains the most destructive migration plus a large CRM record UI. “Score 4” does not provide effort, dependency, owner or exit criteria.
- **Rationale:** Each phase has several independent high-risk changes and rollback paths.
- **Impact:** Long review cycles, difficult fault isolation and pressure to deploy partially verified behavior.
- **Recommended action:** Break work into deployable slices with explicit gates. Example: 0 security/RPC foundations; 1A shared input only; 1B customer schema/CRUD behind flag; 1C assignment/roll-ups; 1D capture token; 1E Office rename. Do the same for note lifecycle and attachments. Each slice needs migration order, acceptance tests, observability and rollback/forward-fix instructions.
- **Open questions:** What delivery deadline and developer capacity are assumed? Can feature flags remain in place through an observation period?

## Optional improvements and simplifications

### O01. Keep notes on closed projects and re-parent only on delete

- **Relevant section:** 6, 7.1
- **Priority:** P2
- **Type:** Simplification
- **Status:** Optional improvement
- **Description:** The customer view already rolls up open and closed project notes. Physically moving every note on close adds provenance, reverse moves, customer-change edge cases and transactional risk without changing what the user can see.
- **Rationale:** Keeping the note on the closed project preserves its true origin automatically. Only project deletion needs re-parenting to avoid loss.
- **Impact:** Much smaller Phase 2, fewer writes, simpler reopen and lower data-risk. It changes confirmed decision 9, so it needs product approval.
- **Recommended action:** Consider changing the rule to: “Closing keeps notes on the project and surfaces them in the customer timeline; deleting re-parents them.” Keep the close-out note directly on the customer.
- **Open questions:** Is physical ownership important for any workflow beyond visibility?

### O02. Use pending attachment rows as the upload authorization record

- **Relevant section:** 8.3-8.4
- **Priority:** P1
- **Type:** Simplification / hardening
- **Status:** Optional improvement
- **Description:** Creating a pending row before the signed URL removes the need to trust a client-returned path and makes cleanup database-driven.
- **Rationale:** It provides one ID for progress, finalization, retries and support, and avoids full bucket scans for the common orphan case.
- **Impact:** Less reconciliation complexity and stronger binding between user, parent and object.
- **Recommended action:** Add `status`, `upload_expires_at`, `ready_at`, `last_error` and perhaps `checksum` to attachments. Generate a random storage key with no filename; preserve the original name only in metadata.
- **Open questions:** Should failed/pending rows be visible to the user?

### O03. Require explicit selection before creating a customer from task capture

- **Relevant section:** 9.3
- **Priority:** P2
- **Type:** Simplification / UX
- **Status:** Optional improvement
- **Description:** Automatic creation from any unmatched `@word` creates parser, typo, archive, race and deletion complexity.
- **Rationale:** An autocomplete option such as `Create “Northgate”` is still fast but makes the action explicit and supports multi-word names naturally.
- **Impact:** Fewer junk customers and a simpler grammar. It changes confirmed decision 8.
- **Recommended action:** Consider making Enter select an existing match, with a distinct keyboard-accessible “Create customer” option for unmatched text.
- **Open questions:** Is zero-dialog creation more important than data quality?

### O04. Do not drop `projects.stakeholders` in Phase 4 automatically

- **Relevant section:** 5.3, 14 Phase 4
- **Priority:** P3
- **Type:** Migration simplification
- **Status:** Optional improvement
- **Description:** Dropping the safety copy creates little user value and removes the easiest recovery source after a lossy backfill.
- **Rationale:** A dormant, read-only column has low cost in a small app.
- **Impact:** Longer recovery window and less risky delivery.
- **Recommended action:** Keep it for at least one release cycle with a verified export, then schedule a separate cleanup decision.
- **Open questions:** Is there a schema-cleanliness reason that requires an early drop?

### O05. Add a customer merge workflow before relying on auto-create

- **Relevant section:** 5.1, 9.3
- **Priority:** P2
- **Type:** Data quality
- **Status:** Optional improvement
- **Description:** Near-miss hints reduce typos but do not repair duplicates or renamed/trading-name records.
- **Rationale:** Once projects, tasks, notes, facts, contacts and files exist under two customers, delete-to-unfiled is not an acceptable merge.
- **Impact:** Better long-term CRM quality.
- **Recommended action:** Add a server-side merge operation that previews and atomically reassigns all relationships, resolves primary contacts/facts, and archives or deletes the source record.
- **Open questions:** Is duplicate cleanup needed for first release or can auto-create wait?

### O06. Split the overview into independently loadable sections

- **Relevant section:** 12, 13
- **Priority:** P2
- **Type:** Performance / resilience
- **Status:** Optional improvement
- **Description:** A single overview endpoint makes first paint depend on the slowest section and increases cache invalidation scope.
- **Rationale:** Projects, tasks, facts, contacts, timeline and files change at different rates and already have natural loading boundaries.
- **Impact:** Faster visible header/content and isolated retry states, at the cost of more requests.
- **Recommended action:** Return header and summary counts first, then load timeline/files/tasks in parallel with their own pagination.
- **Open questions:** Is reducing request count or reducing time-to-first-use more important for expected data volume?

### O07. Use random storage keys without the original filename

- **Relevant section:** 8.3
- **Priority:** P2
- **Type:** Privacy / simplification
- **Status:** Optional improvement
- **Description:** The proposed path contains a sanitized original filename, which may contain customer names, invoice numbers or other sensitive text.
- **Rationale:** The filename is already stored in the database and can be supplied as the signed download name.
- **Impact:** Less PII in storage URLs and provider logs; shorter, simpler paths.
- **Recommended action:** Use `{user_id}/{attachment_id-or-random-uuid}` as the immutable key. Keep the original display filename only in `attachments.file_name`.
- **Open questions:** Is human-readable bucket inspection considered important?

### O08. Add an audit trail for destructive and re-parenting actions

- **Relevant section:** 7, 8, 11
- **Priority:** P2
- **Type:** Operability / security
- **Status:** Optional improvement
- **Description:** `context_label` explains some moved rows but does not record who performed an operation, exact before/after parents, counts or failures.
- **Rationale:** Hard delete, merge, close/reopen and file deletion are the hardest operations to diagnose.
- **Impact:** Faster support and safer repair, with modest storage cost.
- **Recommended action:** Add a compact `lifecycle_events` table containing operation ID, user ID, entity, action, timestamp, before/after summary and result counts. Do not copy note/fact/file contents into it.
- **Open questions:** How long should audit events be retained?

## Required specification changes before approval

1. Define database RPCs and idempotency for atomic close, reopen, project delete, customer delete, reassignment and task-plus-customer creation.
2. Add same-user database constraints and make the existing permissive RLS cleanup a Phase 0 gate.
3. Redesign attachment authorization/finalization/deletion around real object metadata and retryable states.
4. Define all customer reassignment, archive, closed-project and direct-versus-rolled-up deletion journeys.
5. Add the existing-note `occurred_at = created_at` backfill and a forward-compatible migration/rollback plan.
6. Resolve the Phase 2/Phase 3 dependency contradiction.
7. Replace name-only Office 365 adoption with an ambiguity-safe strategy and define the bulk rename rollout.
8. Define historical customer attribution for completed reports.
9. Complete API schemas, timeline/search semantics, validation limits and accessibility acceptance criteria.
10. Replace the verification section with executable repository commands plus database, Storage, Graph and E2E test layers.

## Unresolved decisions

- Whether close should physically move notes/files or only surface them through the customer roll-up.
- What changing or clearing a project's customer does to open work, closed history and lifecycle-moved records.
- Whether completed reports use current or completion-time customer attribution.
- Whether archived/Dormant/Former customers can receive new tasks and projects.
- Whether `@Name` auto-creates immediately or requires selecting an explicit create option.
- Whether customer hard delete means “remove the customer row” or full erasure of everything visible on the customer page.
- How contacts with the same name, contacts who move companies, and cross-customer project contacts are represented.
- Whether uploaded files are scanned, backed up and recoverable, and what quotas apply.
- Whether customer names may be sent to Microsoft To Do by default.

## Major risks

1. **Partial lifecycle commits:** highest data-integrity risk.
2. **Cross-user relationships and permissive RLS:** highest security risk.
3. **Incorrect attachment trust/deletion model:** highest file-loss and storage-abuse risk.
4. **Closed-project reassignment and weak provenance:** highest functional correctness risk.
5. **Name-based Office 365 adoption:** highest integration risk.
6. **Forward-incompatible rollback after note movement:** highest deployment risk.
7. **No database/storage integration tests:** highest verification risk.

## Recommended next steps

1. Hold a short design decision session for the unresolved lifecycle and historical-attribution questions.
2. Produce a Revision 5 that resolves only the P0/P1 findings; do not expand feature scope.
3. Implement and test a Phase 0 database foundation: RLS cleanup, same-user constraints, RPC transaction pattern and local Supabase integration-test harness.
4. Ship the shared due-date input as a separate low-risk change.
5. Build customer CRUD and project assignment behind a feature flag before adding close-time movement, attachments or Office renaming.
6. Run the signed-upload spike against the real Supabase project, but test final metadata validation and deletion recovery as part of the spike, not only token creation.
7. Re-review the revised spec and migration plan before any production data movement.

## Evidence checked

- Current project architecture and guidance in `CLAUDE.md` and `AGENTS.md`.
- Current project/task/note schema and migrations in `supabase/migrations/`.
- Current project, task, note, lifecycle and Office 365 routes/services/components.
- Current test suite: **31 files, 432 tests passed** on 2026-09-01.
- Current lint command: passed with no warnings/errors on 2026-09-01.
- [Vercel Functions request/response payload limit](https://vercel.com/docs/functions/limitations): 4.5 MB, supporting direct-to-storage uploads.
- [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control): service keys bypass RLS and must not be exposed.
- [Supabase Storage object ownership](https://supabase.com/docs/guides/storage/security/ownership): service-key uploads have no owner, supporting the spec's need for server-side ownership metadata.
- [Supabase Storage file info](https://supabase.com/docs/reference/javascript/file-buckets-info): exact object metadata, including size and content type, is available for finalization checks.
- [Supabase Storage list](https://supabase.com/docs/reference/javascript/file-buckets-list): list defaults to 100 items and requires pagination/folder handling.
- [Microsoft Graph `todoTaskList`](https://learn.microsoft.com/en-us/graph/api/resources/todotasklist?view=graph-rest-1.0): `displayName` is documented as a string, with no maximum shown in the resource documentation.
