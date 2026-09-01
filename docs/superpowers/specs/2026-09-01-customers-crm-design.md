# Customers: Design Spec

**Date:** 2026-09-01
**Status:** Revision 6, all decisions resolved, ready for a Phase 0 implementation plan
**Scope:** Add a customer record to Planner 2.0, so projects, tasks, dated notes and file attachments all hang off the customer you are working with, nothing of value is lost when a project is closed or deleted, and task capture works the same way everywhere
**Complexity:** 5 (XL), broken into four independently deployable phases

**Revision history**
- **R2:** notes stay single parent but project close and delete now preserve their value (section 7). People folded out of `projects.stakeholders` into a shared `contacts` registry (section 5.3). Office 365 list names become "Customer: Project" (section 10.1).
- **R3:** task capture unified across `/today` and `/projects`, with natural language due dates on both and a customer token in the capture line (section 9, new). A live timezone bug in the project page task input is fixed as part of it.
- **R4:** `@Name` now creates a customer that does not exist, while `for Name` still only matches existing ones (section 9.3). Closing a project now asks for close-out notes every time and **moves every note on the project onto the customer's record**, reversibly (section 7.1).
- **R6:** the five open decisions are answered. Stakeholders now convert to **customers as well as people** through a triage screen, and the column is dropped (5.3, 14). The pre-existing reopen bug **is** fixed as part of this work, with cascade provenance on tasks (5.9, 7.1). No historical backfill of completed-report attribution. Bulk customer assignment runs before the stakeholder conversion. 2 GB storage cap confirmed.
- **R5:** revised against `docs/superpowers/reviews/2026-09-01-customers-crm-design-review.md`. The substantive changes: every multi-row lifecycle operation moves into a database RPC so it is one real transaction (7.8); a Phase 0 lands the RLS cleanup and same-owner constraints before anything else (14, 5.7); the attachment protocol is rebuilt around a pending row and real object metadata (8.3); `occurred_at` gets an explicit backfill so existing history is not rewritten (5.4); close and reopen get proper movement provenance (7.1); project customer reassignment and completed-report attribution are defined (7.7, 10.3); the capture token grammar is pinned down (9.3); Office 365 list adoption stops guessing by name (10.1). Section 19 lists what the review raised that is deliberately **not** being done, and why.

---

## 1. The problem

Today the app has no idea who a project is for. The only trace of a customer is `projects.stakeholders`, a `text[]` of free-text names edited as a comma separated string. It cannot be searched, it does not roll up, and nothing else in the app reads it.

That leaves five gaps against what you asked for:

1. **No repository of customer information.** Notes exist, but only against a project, a task or an idea. There is nowhere to put the mixed, random things a customer sends you that are not about one project: an account number, the URL of their portal, a new address, an org chart, "they've moved offices".

   Earlier revisions of this document used "a portal login" as an example. That wording is withdrawn. **Facts, notes and files are stored as plain text and are searchable. Passwords, API keys, recovery codes and other secrets must never go in them.** See section 5.8.
2. **No single view per customer.** To see everything open for one customer you have to remember which projects are theirs and open each one.
3. **No attachments anywhere.** The codebase has zero file upload code and no Supabase Storage buckets. Verified by grep across `src/` and `supabase/migrations/`.
4. **Closing or deleting a project loses what you learned.** `notes.project_id` is `ON DELETE CASCADE`, so **deleting a project permanently destroys every note on it, today, with no way back**. Closing a project keeps the notes but strands them on a finished job, where nothing surfaces them again. Both are addressed in section 7.
5. **Task capture behaves differently on every page.** `/today` parses natural language due dates. `/projects` hardcodes the due date to today and cannot set one at all. Neither can name a customer. Section 9.

---

## 2. What you will be able to do

When this is done:

- Open `/customers`, pick a customer, and see, on one screen: their open projects, every open task for them (whether it sits on a project or not), a dated timeline of everything you have logged, their key facts, their people, and their files.
- Log a note against a customer in seconds, paste a whole email into it, and stamp it with when it actually happened rather than when you typed it.
- Attach a file to a customer, a project, a task or a note, and get it back later.
- Be asked, every single time you close a project, whether there are any close-out notes. Every note on that project then **moves onto the customer's record**, so what you learned sits with the customer rather than with a finished job.
- Reopen a closed project and get its notes back on the project, exactly where they were.
- Delete a project without losing its notes or files. They move up to the customer.
- Type `Send the proposal next Friday` when adding a task **on a project**, and get a task due next Friday, exactly as `/today` already does.
- Type `Chase the invoice for Acme on Thursday` on `/today`, and get a task due Thursday against Acme, matched against customers you already have.
- Type `@Northgate` for a customer that does not exist yet, and have it created on the spot.
- Search across every note, customer, fact and contact from one box.
- Set a customer on a project once, and have every task under that project inherit it automatically.
- See customer prefixed list names in Microsoft To Do, so "Website Rebuild" becomes "Acme: Website Rebuild".
- Run the completed report grouped by customer, so you can answer "what did I do for them last month".

---

## 3. Research: repositories reviewed

Five open source systems were reviewed for their data model, plus the Supabase Storage docs for the file handling. What is worth copying, and what is not:

### twentyhq/twenty (open source CRM, TypeScript + Postgres)

Standard objects are People, Companies, Opportunities, Notes and Tasks. Notes and Tasks do not carry a single foreign key to their parent. They link through explicit target rows (`noteTargets`, `taskTargets`), so one note can be attached to a company, a person and an opportunity at once. Creating a note with a `companyId` or `personId` causes the target row to be created for you.

- **Take:** the separation of Company (the account) from Person (the human), and the principle that the customer view is a roll up of records that point at the customer rather than records the customer owns.
- **Leave:** the target join tables. See section 6. Also leave the custom object metadata engine and the schema-per-workspace machinery, which exist to serve multi-tenant teams and are pure cost for a single user app.

Source: [Twenty data model docs](https://docs.twenty.com/user-guide/data-model/overview), [twentyhq/twenty](https://github.com/twentyhq/twenty), and the target field behaviour visible in [issue #21164](https://github.com/twentyhq/twenty/issues/21164).

### monicahq/monica (personal CRM, Laravel + Vue)

The closest match to what you described, because it is built around remembering things about people rather than around a sales pipeline. It pairs a rich structured profile per contact (name, dates, relationship type, how you met) with a free stream of notes, reminders, tasks and life events, plus document uploads. Contact pages are composed of modules, so the page is a set of stacked sections rather than one form. Contacts live in vaults and the schema uses UUID primary keys with soft deletes.

- **Take:** structured facts sitting alongside a free stream. This is the key insight for "random things they send me". Some of it is an event ("they emailed on Tuesday"), some of it is a standing fact ("their PO system needs a cost centre code"). Those want different homes. Also take the modular page, which matches the existing `ProjectWorkspace` shape, and soft delete so nothing is lost.
- **Leave:** vault multi-tenancy, the template engine, emotions, loans, and the Uploadcare dependency.

Source: [monicahq/monica](https://github.com/monicahq/monica), [Monica architecture wiki](https://deepwiki.com/monicahq/monica).

### EspoCRM (PHP CRM)

Attachments are a single entity with `parentType` and `parentId`, plus a `role` field ("Attachment", "Inline Attachment", "Export File") and a `field` naming which field on the parent it came through. One Attachment table therefore serves email attachments, stream note attachments and documents. Stream notes use the same `parentType`/`parentId` pair.

- **Take:** one attachments table serving every parent type, rather than a table per parent. The `role` idea is worth a lightweight version if inline images ever matter.
- **Leave:** the string based `parentType` discriminator. Postgres can do better, see section 5.5.

Source: [EspoCRM attachments docs](https://docs.espocrm.com/development/attachments/), [EspoCRM stream API docs](https://docs.espocrm.com/development/api/stream/).

### SuiteCRM / SugarCRM

The same polymorphic parent pattern, `parent_type` plus `parent_id` on `notes`, hardcoded across the product. It confirms the pattern survives twenty years of use. It also shows the failure mode: SuiteCRM does not use database foreign keys at all and enforces relationships in PHP, and because the field names are hardcoded you can only ever have one flex relate field per module.

- **Take:** confirmation that a polymorphic parent is durable.
- **Leave:** application level referential integrity. This app already relies on real foreign keys and a check constraint (`check_note_parent`) for exactly this, and that is the better pattern.

Source: [SuiteCRM database schema](https://docs.suitecrm.com/developer/database-schema/), [SugarCRM notes table schema](https://apidocs.sugarcrm.com/schema/13.0.1/ent/tables/notes.html).

### Supabase Storage

Private bucket, path prefixed by user id, short lived signed URLs for download, signed upload URLs so the browser uploads directly rather than through the server.

- **Take:** all of the above, with one critical adaptation described in section 8.
- **Leave:** RLS based storage policies. They are the documented Supabase answer and they do not work here.

Source: [Storage access control](https://supabase.com/docs/guides/storage/security/access-control), [standard uploads](https://supabase.com/docs/guides/storage/uploads/standard-uploads), [Vercel body size limits](https://vercel.com/docs/functions/limitations).

---

## 4. Design principles for this change

Carried over from how the app is already built:

1. **Business rules live in `src/services/`.** Every caller gets the same behaviour. No cascade logic in components.
2. **Derived columns are owned by database triggers, never by application code.** This is already true of `completed_at`, `cancelled_at` and `entered_state_at`. `tasks.customer_id` joins that list.
3. **Every route re-checks the NextAuth session and verifies row ownership.** RLS is effectively bypassed because every route uses the service role client.
4. **Deletes must state what they destroy, and destroy as little as possible.** `ProjectDeleteModal` already does the first half. Section 7 does the second.
5. **Nothing is ever silently lost.** Archive rather than delete. Re-parent rather than cascade.
6. **One behaviour, one implementation.** Where two pages do the same job differently, they get merged rather than kept in sync by hand. Section 9. This also means one canonical mutation route per operation: the duplicate collection level `PATCH` and `DELETE` on `/api/projects` are removed in Phase 0 (section 12).
7. **Anything that changes more than one row at a time is one database transaction.** Separate `.update()` and `.insert()` calls through the Supabase client are separate PostgREST requests and therefore separate transactions. A JavaScript service function is not a transaction boundary. Every lifecycle operation in section 7 is a single Postgres RPC. Section 7.8.

---

## 5. Data model

### 5.1 New table: `customers`

```sql
CREATE TABLE public.customers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name          text NOT NULL,
  status        text NOT NULL DEFAULT 'Active',
  area          text,
  website       text,
  summary       text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  archived_at   timestamptz,
  CONSTRAINT customers_status_check
    CHECK (status IN ('Active', 'Prospect', 'Dormant', 'Former')),
  CONSTRAINT customers_name_not_blank
    CHECK (length(btrim(name)) > 0)
);

CREATE UNIQUE INDEX customers_user_name_unique
  ON public.customers (user_id, lower(btrim(name)));
CREATE INDEX customers_user_status_idx
  ON public.customers (user_id, status) WHERE archived_at IS NULL;
```

Notes on the choices:

- `status` is a four value lifecycle, deliberately not the five value project status. A customer is not a project and should not borrow its vocabulary.
- `area` reuses the existing free-text area dimension that tasks and projects already carry, so the customer list can be filtered by the same job or brand split you already use. `/api/areas` will be extended to include customer areas.
- `summary` is a single free-text block for the one paragraph you would tell someone about this customer. Structured facts go in `customer_facts`.
- `archived_at` gives a soft archive. Archiving hides a customer from the list without touching their projects, tasks, notes or files. Hard delete is a separate, confirmed action, covered in section 7.3.
- The unique index is case insensitive and trims whitespace, so you cannot end up with "Acme", "acme " and "ACME" as three customers. It is also what makes the `@customer` capture token in section 9 safe to resolve.

**`status` and `archived_at` do different jobs and both are needed.** `status` says what the relationship is. `archived_at` says whether you want to see them. The rules:

| State | Shows in the list by default | Can take new projects and tasks | Matched by `@Name` and `for Name` |
|---|---|---|---|
| Active | Yes | Yes | Yes |
| Prospect | Yes | Yes | Yes |
| Dormant | Yes | Yes | Yes |
| Former | No, "All" filter only | Yes, with a confirmation | Yes, flagged in the preview |
| Any status, archived | No, "Archived" filter only | **No** | Shown in autocomplete, greyed, selecting one prompts to unarchive |

Archiving a customer with open projects or tasks is refused, with a count and a link. Archive means "this is finished", so finishing it first is the point. The filter pills therefore become: All, Active, Prospect, Dormant, Former, Needs attention, Archived.

### 5.2 New table: `customer_facts`

This is the Monica lesson: standing facts are not stream entries.

```sql
CREATE TABLE public.customer_facts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  label       text NOT NULL,
  value       text NOT NULL,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_facts_label_not_blank CHECK (length(btrim(label)) > 0)
);

CREATE INDEX customer_facts_customer_idx
  ON public.customer_facts (customer_id, sort_order);
```

A deliberately dumb label and value list. It gives you arbitrary structured fields (VAT number, PO portal URL, invoicing email, parking instructions) without building a custom field engine. That is Twenty's custom fields at roughly 5 percent of the cost, and it is the right trade for a single user app.

### 5.3 New tables: `contacts` and `project_contacts`, replacing `projects.stakeholders`

**Decision confirmed: retire `stakeholders`.** Each existing name becomes either a **customer** or a **person**, your choice per name (section 5.3b), and the column is then dropped (section 5.3c). This section covers the people half.

The registry is called `contacts`, not `customer_contacts`, because it has to serve projects that have no customer. `customer_id` is therefore nullable: a contact can belong to a customer, or stand alone.

```sql
CREATE TABLE public.contacts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  name        text NOT NULL,
  role        text,
  email       text,
  phone       text,
  notes       text,
  is_primary  boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contacts_name_not_blank CHECK (length(btrim(name)) > 0)
);

CREATE INDEX contacts_user_name_idx
  ON public.contacts (user_id, lower(btrim(name)));
CREATE INDEX contacts_customer_idx
  ON public.contacts (customer_id) WHERE archived_at IS NULL;
CREATE UNIQUE INDEX contacts_one_primary
  ON public.contacts (customer_id)
  WHERE is_primary AND archived_at IS NULL AND customer_id IS NOT NULL;

CREATE TABLE public.project_contacts (
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, contact_id)
);

CREATE INDEX project_contacts_contact_idx ON public.project_contacts (contact_id);
```

`contacts.customer_id` is `ON DELETE SET NULL`, not cascade. Deleting a customer must not delete the people. They become standalone contacts and stay reachable through search and through any project they are linked to.

The partial unique index on `is_primary` means the database, not the UI, guarantees at most one primary contact per customer. Changing which contact is primary goes through a `set_primary_contact(customer_id, contact_id)` RPC that clears the old and sets the new in one transaction, because two separate `PATCH` calls would transiently violate the index. `is_primary` is rejected on standalone and archived contacts, where it has no meaning.

**Contact names are deliberately not unique.** An earlier revision had a unique index on the normalised name. That was wrong: two people at one company can share a name, and a name is not an identity. Instead there is a plain lookup index, and the UI warns on a probable duplicate (same name plus a matching email or phone) while still letting you save. Merging two contacts is a manual action, not something SQL forces.

### 5.3b Converting `stakeholders`: some are customers, some are people

**A blind migration would be wrong.** The `stakeholders` column is free text typed into a comma separated box over a long period. Some of those entries are company names, which should become **customers**. Some are people, which should become **contacts**. No rule can tell them apart reliably, and guessing would either invent junk customers or bury real customer names as contacts.

So the conversion is a **triage screen**, not a silent migration. It runs at the end of Phase 1, together with the bulk customer assignment, because those are the same job: working out who your existing work is for.

**Preflight, run first and shown on the screen.** Before anything is written, a profiling query reports what is actually in the column, so the conversion starts from facts rather than assumptions:

```sql
SELECT count(*) FILTER (WHERE stakeholders IS NOT NULL AND array_length(stakeholders,1) > 0) AS projects_with_stakeholders,
       count(DISTINCT lower(btrim(s)))                                                        AS distinct_names,
       count(*) FILTER (WHERE btrim(s) = '')                                                  AS blank_entries,
       count(*) FILTER (WHERE s LIKE '%,%')                                                   AS entries_containing_commas,
       count(*) FILTER (WHERE s LIKE '%@%')                                                   AS entries_looking_like_emails
FROM public.projects, unnest(coalesce(stakeholders, '{}')) AS s;
```

**Normalisation rules**, applied before the names are shown to you:
- Trim, collapse internal whitespace, drop blank and whitespace-only entries.
- Split on commas, because the UI wrote comma separated text into array elements and some elements contain commas.
- Deduplicate case insensitively across the whole user, not per project.
- An entry containing `@` is offered as a person with the address pre-filled into their email, not as a customer.

**The screen.** One row per distinct name, showing which projects use it. Three choices:

| Choice | What happens | Phase |
|---|---|---|
| **Customer** | Creates a customer with that name. Every project carrying that stakeholder is assigned to it, unless you have already given that project a different customer, in which case the row is flagged for you to resolve | 1 |
| **Person** | Creates a contact, linked to those projects through `project_contacts`. Attached to the project's customer where it has one, standalone otherwise | 2 |
| **Skip** | Nothing is written. The name stays untouched in the column until the drop | 1 |

**The two halves land in different phases, because they have to.** `contacts` does
not exist until Phase 2, so the Person choice has nowhere to write in Phase 1.
Rather than delay the whole screen, Phase 1 ships the **Customer** and **Skip**
choices, which is the half that matters first: it is what makes `/customers`
non-empty and what the bulk project assignment depends on. Phase 2 adds the
Person choice to the same screen once `contacts` exists.

No state is needed to bridge them. A name you do not mark as a customer in Phase
1 simply stays in `stakeholders`, untouched, and is still there for the Person
pass in Phase 2. The Phase 4 drop gate counts a name as triaged once it has been
marked customer, marked person, or explicitly skipped.

A "Customer" choice that collides with a customer you already created links to the existing one instead of failing. Names are pre-sorted with the most-used first, since those are most likely to be real customers.

**Nothing is written until you confirm**, and the whole conversion runs in one transaction with counts reported afterwards: names triaged, customers created, contacts created, project links created, rows flagged for resolution.

### 5.3c Dropping the column

**`projects.stakeholders` is dropped**, as decided, but not in the same migration and not blindly. The order is:

1. Phase 1: the triage screen writes customers and contacts. The column is untouched.
2. Phase 2: the UI stops reading `stakeholders` and reads `project_contacts` instead. The column is still there, still populated.
3. Phase 4: a migration that first copies the raw data to a small archive table, then drops the column:

```sql
CREATE TABLE public.projects_stakeholders_archive AS
  SELECT id AS project_id, user_id, stakeholders, now() AS archived_at
  FROM public.projects
  WHERE stakeholders IS NOT NULL AND array_length(stakeholders, 1) > 0;

ALTER TABLE public.projects DROP COLUMN stakeholders;
```

The archive table is a few rows of text and costs nothing. It exists because a `DROP COLUMN` cannot be undone, and because the triage is a judgement call that might need revisiting months later. Delete it whenever you are satisfied, as its own decision.

The drop is **gated on every distinct name having been triaged or explicitly skipped**. If any remain untouched, the migration reports them and stops. It is also preceded by the function and view audit the workspace rules require for any dropped column.

Phone numbers should be normalised to E.164 per the workspace standard. `libphonenumber-js` is not currently a dependency. Recommendation: store as typed for now, since these are your own notes and not a messaging integration. Add the library only if these numbers ever feed an integration.

### 5.4 Linking projects, tasks and notes to a customer

**Projects.**

```sql
ALTER TABLE public.projects
  ADD COLUMN customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL;
CREATE INDEX projects_customer_idx ON public.projects (customer_id);
```

`ON DELETE SET NULL` matches the existing `tasks.project_id` behaviour. Deleting a customer must never destroy a project.

**Tasks.**

```sql
ALTER TABLE public.tasks
  ADD COLUMN customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL;
CREATE INDEX tasks_customer_state_idx ON public.tasks (customer_id, state);
```

This column is needed because tasks can exist with no project (`tasks.project_id` is nullable), and "chase Acme for the signed contract" is a real customer task with no project behind it. It is also what the `@customer` capture token in section 9 writes to.

The ownership rule, and it must be written into `CLAUDE.md` alongside the `completed_at` rule:

> `tasks.customer_id` is application writable **only when `project_id IS NULL`**. When a task has a project, a database trigger overwrites `customer_id` from `projects.customer_id`. The application must never send both.

Enforced by a trigger, mirroring `fn_task_state_cleanup`:

```sql
CREATE OR REPLACE FUNCTION public.fn_task_customer_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.project_id IS NOT NULL THEN
    SELECT p.customer_id INTO NEW.customer_id
    FROM public.projects p WHERE p.id = NEW.project_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_task_customer_sync
  BEFORE INSERT OR UPDATE OF project_id, customer_id ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.fn_task_customer_sync();
```

And the reverse direction, so changing a project's customer repoints its tasks:

```sql
CREATE OR REPLACE FUNCTION public.fn_project_customer_cascade()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN
    UPDATE public.tasks
    SET customer_id = NEW.customer_id
    WHERE project_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_project_customer_cascade
  AFTER UPDATE OF customer_id ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.fn_project_customer_cascade();
```

**Deliberate consequence:** when a project is deleted, `tasks.project_id` becomes null via the existing `ON DELETE SET NULL`. The trigger only writes `customer_id` when `project_id IS NOT NULL`, so the task keeps the customer it already had. The task survives as unassigned but still attached to the customer. That is the desired behaviour and it is tested for.

Why a real column rather than a view: the Today view, the Plan board, the autopilot pool, planning candidates and the daily digest all select flat rows from `tasks`. A column means every one of those can filter or display by customer with an index and no rework. A view would force a join into every one of those paths.

**Notes.** Extend the existing exclusive parent to include the customer, and add the fields the timeline needs:

```sql
-- Step 1, expand. occurred_at and updated_at are NULLABLE here on purpose.
ALTER TABLE public.notes
  ADD COLUMN customer_id        uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  ADD COLUMN contact_id         uuid REFERENCES public.contacts(id)  ON DELETE SET NULL,
  ADD COLUMN origin_project_id  uuid REFERENCES public.projects(id)  ON DELETE SET NULL,
  ADD COLUMN lifecycle_move_id  uuid,
  ADD COLUMN lifecycle_moved_at timestamptz,
  ADD COLUMN occurred_at        timestamptz,
  ADD COLUMN source             text NOT NULL DEFAULT 'note',
  ADD COLUMN pinned             boolean NOT NULL DEFAULT false,
  ADD COLUMN context_label      text,
  ADD COLUMN updated_at         timestamptz;

-- Step 2, backfill. Without this every existing note would claim to have
-- happened at deployment time, because the timeline sorts by occurred_at.
UPDATE public.notes SET occurred_at = created_at WHERE occurred_at IS NULL;
UPDATE public.notes SET updated_at  = created_at WHERE updated_at  IS NULL;

-- Step 3, verify. Fail the whole migration rather than ship wrong history.
DO $$
DECLARE bad bigint;
BEGIN
  SELECT count(*) INTO bad FROM public.notes
   WHERE occurred_at IS NULL OR updated_at IS NULL;
  IF bad > 0 THEN
    RAISE EXCEPTION 'occurred_at/updated_at backfill left % rows null', bad;
  END IF;
END $$;

-- Step 4, contract.
ALTER TABLE public.notes
  ALTER COLUMN occurred_at SET DEFAULT now(),
  ALTER COLUMN occurred_at SET NOT NULL,
  ALTER COLUMN updated_at  SET DEFAULT now(),
  ALTER COLUMN updated_at  SET NOT NULL;

ALTER TABLE public.notes ADD CONSTRAINT notes_source_check
  CHECK (source IN ('note','email','call','meeting','message','document','other'));

ALTER TABLE public.notes DROP CONSTRAINT IF EXISTS check_note_parent;
ALTER TABLE public.notes ADD CONSTRAINT check_note_parent CHECK (
  (CASE WHEN project_id  IS NOT NULL THEN 1 ELSE 0 END
 + CASE WHEN task_id     IS NOT NULL THEN 1 ELSE 0 END
 + CASE WHEN idea_id     IS NOT NULL THEN 1 ELSE 0 END
 + CASE WHEN customer_id IS NOT NULL THEN 1 ELSE 0 END) <= 1
);

CREATE INDEX notes_customer_occurred_idx
  ON public.notes (customer_id, occurred_at DESC);
CREATE INDEX notes_origin_project_idx
  ON public.notes (origin_project_id) WHERE origin_project_id IS NOT NULL;
CREATE INDEX notes_pinned_idx
  ON public.notes (customer_id) WHERE pinned;
CREATE INDEX notes_unfiled_idx
  ON public.notes (user_id, created_at DESC)
  WHERE project_id IS NULL AND task_id IS NULL
    AND idea_id IS NULL AND customer_id IS NULL;
```

The counting form of the check constraint is worth adopting even though it changes the existing shape, because the current nested `OR` form becomes unreadable at five parents and has already been rewritten once when `idea_id` was added. It still permits zero parents, which is what makes an unfiled note legal (see section 7).

`occurred_at` is the date and time stamp you asked for. It defaults to now, so nothing changes for quick capture, but it can be backdated when you are logging something from last week. **The timeline sorts by `occurred_at`, not `created_at`.** `created_at` stays as the audit trail of when the row was written and is never edited.

`contact_id` answers "who did this come from", which is the difference between a log and a record.

**Four columns record where a note came from when it moves, and each does a different job.** An earlier revision used only `origin_project_id` plus a text label, and that was not enough to tell an automatic move apart from a deliberate re-file. It is now:

| Column | Job |
|---|---|
| `origin_project_id` | Real foreign key to the project the note was moved off. Makes the move reversible and lets the project page keep showing its notes after closure. |
| `lifecycle_move_id` | The id of the close operation that moved it. **Non-null means "this row is currently owned by a lifecycle move and has not been touched since."** |
| `lifecycle_moved_at` | When that move happened. Diagnostics and support. |
| `context_label` | The tombstone, for example `From project: Acme Website Rebuild (deleted 2026-09-01)`. Set when the origin can no longer be pointed at, most obviously when the project is hard deleted and `origin_project_id` goes null via the foreign key. |

`lifecycle_move_id` is the one that matters, and it is why the reopen in section 7.1 is now correct. **Any user edit or re-file of a note clears `lifecycle_move_id` to null.** So:

- A note the close moved, untouched since: `lifecycle_move_id` is set, reopen takes it back.
- A note the close moved, which you then deliberately re-filed to a different customer: `lifecycle_move_id` is null, reopen leaves it alone.
- A note the close moved, which you re-filed back to the same customer on purpose: `lifecycle_move_id` is null, reopen leaves it alone. The previous design got this wrong because it matched on `customer_id`, which cannot tell those two cases apart.
- A note you wrote directly on the customer: `lifecycle_move_id` was never set, reopen never touches it.

All four are nullable, all four are written only by the RPCs in section 7.8, and none is ever typed by hand.

`notes` has no `updated_at` today and notes are not editable in the UI at all. Both are fixed here, with the standard `update_updated_at_column` trigger.

**`VALIDATION.NOTE_MAX` is currently 1000 characters.** That is far too short for pasting an email thread. Raise it to 20000. The note input in `ProjectNotes.jsx` is a single line `<input>` with Enter to save, which also has to become a textarea with Cmd or Ctrl plus Enter to save and Enter for a newline.

### 5.5 New table: `attachments`

```sql
CREATE TABLE public.attachments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  customer_id   uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  project_id    uuid REFERENCES public.projects(id)  ON DELETE SET NULL,
  task_id       uuid REFERENCES public.tasks(id)     ON DELETE SET NULL,
  note_id       uuid REFERENCES public.notes(id)     ON DELETE SET NULL,
  origin_project_id  uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  lifecycle_move_id  uuid,
  lifecycle_moved_at timestamptz,
  storage_path  text NOT NULL UNIQUE,
  file_name     text NOT NULL,
  mime_type     text,
  size_bytes    bigint,
  status        text NOT NULL DEFAULT 'pending',
  upload_expires_at timestamptz,
  ready_at      timestamptz,
  deleting_at   timestamptz,
  last_error    text,
  context_label text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attachments_status_check
    CHECK (status IN ('pending', 'ready', 'deleting', 'failed')),
  CONSTRAINT attachments_ready_has_size
    CHECK (status <> 'ready' OR (size_bytes IS NOT NULL AND size_bytes > 0)),
  CONSTRAINT check_attachment_parent CHECK (
    (CASE WHEN customer_id IS NOT NULL THEN 1 ELSE 0 END
   + CASE WHEN project_id  IS NOT NULL THEN 1 ELSE 0 END
   + CASE WHEN task_id     IS NOT NULL THEN 1 ELSE 0 END
   + CASE WHEN note_id     IS NOT NULL THEN 1 ELSE 0 END) <= 1
  ),
  CONSTRAINT attachments_size_positive CHECK (size_bytes IS NULL OR size_bytes > 0)
);

CREATE INDEX attachments_customer_idx ON public.attachments (customer_id, created_at DESC);
CREATE INDEX attachments_project_idx  ON public.attachments (project_id, created_at DESC);
CREATE INDEX attachments_task_idx     ON public.attachments (task_id, created_at DESC);
CREATE INDEX attachments_note_idx     ON public.attachments (note_id);
```

Real nullable foreign keys plus a check constraint, rather than EspoCRM's `parentType` string. Same flexibility, real referential integrity, and behaviour the database enforces.

Every parent is `ON DELETE SET NULL`, never cascade. **A file is never destroyed as a side effect of deleting something else.** The application decides what happens, and it says so first. See section 7.

**The row exists before the file does.** `status` runs `pending` to `ready`, or to `failed`, and `deleting` on the way out. The row is created when the upload URL is issued, which makes it the authorisation record: it holds the server-generated path, the intended parent, the declared metadata and an expiry. Nothing about the upload is then taken on the client's word. Section 8.3 explains why this replaces the previous "check the object exists" approach, which could be fooled.

Only `ready` rows are shown in the UI, counted in impact previews, or returned by the API. `size_bytes` is null until finalisation, because until the object is on disk the server has not measured it.

### 5.6 Search

```sql
ALTER TABLE public.notes
  ADD COLUMN content_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce(content, ''))) STORED;
CREATE INDEX notes_content_tsv_idx ON public.notes USING GIN (content_tsv);
```

A generated column means the index can never drift from the content. `customers`, `customer_facts` and `contacts` get a similar generated column so one search box covers everything you know about a customer.

**English full text search alone is not enough**, and pretending otherwise would ship a search box that looks broken. Postgres tokenises `joe.bloggs@acme-group.co.uk` and `+44 7700 900123` in ways that defeat the searches you would actually type, and it cannot do partial names or near misses at all. So:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX customers_name_trgm_idx ON public.customers USING GIN (lower(name) gin_trgm_ops);
CREATE INDEX contacts_name_trgm_idx  ON public.contacts  USING GIN (lower(name) gin_trgm_ops);
CREATE INDEX customer_facts_value_trgm_idx
  ON public.customer_facts USING GIN (lower(value) gin_trgm_ops);
```

The search endpoint uses full text for note bodies and customer summaries, trigram for names, fact labels and fact values, and exact normalised matching for emails and phone numbers (lower-cased, and digits-only for phones). Trigram is also what powers the "did you mean Acme?" hint on the `@` capture token, which had no implementation before.

### 5.7 Same-owner constraints

Every new child row carries its own `user_id`, but a plain foreign key only points at an `id`. Nothing in the database stops a row owned by one user referencing a customer owned by another. Route checks catch this in practice, but every route uses the service role client, so RLS is not a backstop and a bug in a route, migration, trigger or RPC has nothing underneath it.

This is a one person application, so the realistic threat is my own bugs rather than another user. That still justifies the cheap version of the fix, on the new customer links only:

```sql
ALTER TABLE public.customers ADD CONSTRAINT customers_id_user_unique UNIQUE (id, user_id);
ALTER TABLE public.projects  ADD CONSTRAINT projects_id_user_unique  UNIQUE (id, user_id);
ALTER TABLE public.tasks     ADD CONSTRAINT tasks_id_user_unique     UNIQUE (id, user_id);

ALTER TABLE public.projects
  DROP CONSTRAINT IF EXISTS projects_customer_id_fkey,
  ADD CONSTRAINT projects_customer_fkey
    FOREIGN KEY (customer_id, user_id)
    REFERENCES public.customers(id, user_id) ON DELETE SET NULL;
```

The same composite form is applied to `tasks.customer_id`, `notes.customer_id`, `attachments.customer_id`, `customer_facts.customer_id`, `contacts.customer_id` and both sides of `project_contacts`. The database then physically cannot link a customer to another user's project.

`fn_task_customer_sync` also gains `AND p.user_id = NEW.user_id` on its lookup, so the trigger cannot copy a customer across an ownership boundary even if a row somehow gets there.

### 5.8 Field validation, and what must never be stored

**Nothing goes in a customer record, a fact, a note or a file that you would not want sitting in plain text in a database, in its backups, and in search results.** Concretely: no passwords, no API keys, no recovery codes, no card numbers. A portal URL and a username are fine. The credential is not. This is stated in the UI as placeholder text on the facts editor, not just in this document.

The app has no encryption at rest beyond what Supabase provides, no secret classification, no masked display and no audit trail. Building those is a different project. Saying plainly what the feature is not for is the proportionate answer for a personal planner.

Every new field gets an explicit limit, following the existing `VALIDATION` block in `src/lib/constants.js`:

| Field | Limit | Notes |
|---|---|---|
| `customers.name` | 1 to 120 | Trimmed, whitespace collapsed, control characters rejected |
| `customers.summary` | 2000 | |
| `customers.website` | 500 | **`http:` and `https:` only.** Rendered with `rel="noopener noreferrer"` |
| `customer_facts.label` | 1 to 80 | |
| `customer_facts.value` | 1 to 2000 | Non-blank, so a fact cannot be a label with nothing behind it |
| `contacts.name` | 1 to 120 | |
| `contacts.role` | 120 | |
| `contacts.email` | 320 | Format checked, lower-cased for matching |
| `contacts.phone` | 40 | Stored as typed, digits-only copy used for search |
| `contacts.notes` | 2000 | |
| `notes.content` | 20000 | Raised from 1000 |
| `attachments.file_name` | 255 | Original preserved, path uses a generated key |
| `attachments.mime_type` | 255 | Must be on the allowlist |

The `website` scheme rule is not pedantry. An unvalidated value dropped into an `href` accepts `javascript:`, and this field is rendered as a link on the customer header.

A name that collides with an existing customer after normalisation returns **409**, not 400, so the client can offer to open the existing record instead.

### 5.9 Cascade provenance on tasks, and the reopen bug

**This fixes a bug that already exists in the app**, pulled into scope deliberately rather than left for later.

Today, reopening a cancelled project runs this:

```js
.update({ state: STATE.BACKLOG })
.eq('project_id', projectId)
.eq('user_id', userId)
.eq('state', STATE.CANCELLED)
```

It restores **every** cancelled task on the project, not only the ones the close cascade cancelled. A task you binned by hand two months before closing the project comes back to your backlog on reopen. The code comment in `projectLifecycleService.js` already concedes the cause: "the original is not recorded".

Two columns fix it, following the same pattern as the note provenance in 5.4:

```sql
ALTER TABLE public.tasks
  ADD COLUMN lifecycle_move_id   uuid,
  ADD COLUMN lifecycle_prev_state text;

CREATE INDEX tasks_lifecycle_move_idx
  ON public.tasks (lifecycle_move_id) WHERE lifecycle_move_id IS NOT NULL;
```

`close_project` stamps both on every task its cascade actually changes, recording the state the task was in. `reopen_project` then restores **only** rows carrying that close's `lifecycle_move_id`. Any later edit to a task clears the marker, so a task you touched while the project was closed is left alone, exactly as with notes.

**Tasks still land in backlog, not their previous state.** `lifecycle_prev_state` is recorded for diagnostics and for a future choice, but the restore target does not change. The existing comment gives the reason and it is still right: a task that was in Today when the project was cancelled three months ago is stale, and backlog is the landing spot that forces an explicit decision. Changing that would be a second, unrequested behaviour change.

**Backfill for projects already closed.** Projects closed before this ships have no markers, so a strict reopen would restore nothing, which is worse than today's behaviour. The migration therefore stamps a synthetic move id on the cancelled tasks of every currently-Cancelled project:

```sql
WITH closed AS (
  SELECT id, user_id, gen_random_uuid() AS move_id
  FROM public.projects WHERE status = 'Cancelled'
)
UPDATE public.tasks t
SET lifecycle_move_id = c.move_id
FROM closed c
WHERE t.project_id = c.id AND t.user_id = c.user_id AND t.state = 'cancelled';
```

This inherits the old imprecision for those projects, because the information to do better was never recorded. It is deliberate: existing data keeps today's behaviour, and everything closed from now on is correct. Stated here so it is not mistaken for a complete fix of historical data.

---

## 6. Note parenting: single parent, confirmed

**Decision confirmed: a note has at most one parent.** No `note_targets` join table.

This is safe because of three things working together:

1. **The customer view rolls up.** It shows notes from the customer, from every project of theirs (open **and** closed), and from their tasks. Filing a note on a project never hides it from the customer.
2. **Closing a project does not bury its notes.** Section 7.1.
3. **Deleting a project does not destroy its notes.** They move up to the customer. Section 7.2.

Without points 2 and 3, single parenting would quietly lose value, which is exactly the risk you flagged. With them, the single parent costs nothing and buys a check constraint the database can enforce, instead of integrity living in application code (the SuiteCRM failure mode).

It also stays reversible. A `note_targets` join table can be added later and backfilled from the existing parent columns without rewriting any existing row.

---

## 7. Closing out and deleting: nothing is lost

This section exists because of a real hazard in the current schema, not a hypothetical one.

**Today, `notes.project_id` is `ON DELETE CASCADE`. Deleting a project permanently destroys every note attached to it.** `ProjectDeleteModal` warns about this, which is better than nothing, but a warning is not a safeguard.

### 7.1 Project closed (Completed or Cancelled)

Nothing is deleted, but without this the knowledge goes quiet. Four changes.

**1. You are always asked for close-out notes.**

`ProjectStatusChangeModal` already confirms the status change and lists the tasks it will cascade. It gains a final step that appears **every time** a project moves to Completed or Cancelled, with no way to turn it off:

- *"Anything worth remembering about this?"* A textarea. If filled it writes a **pinned note**, with `source = 'note'`, `occurred_at = now()`, and `context_label = 'Close-out: <project name>'`. It lands on the **customer** when the project has one, and on the project itself when it does not.
- *"Anything to add to their key facts?"* An inline label and value row, repeatable, writing straight to `customer_facts`. Shown only when the project has a customer.
- Both fields are skippable. The modal never blocks the status change. Empty means empty, not a blank note.

Cancelled gets the prompt too, with different wording ("Anything worth remembering about why this stopped?"). A cancelled project is often the one most worth capturing, and it costs nothing to ask.

**2. Every note on the project moves onto the customer's record.**

When the project has a customer, closing it runs this in `projectLifecycleService`, in the same transaction as the task cascade:

```sql
-- inside close_project(), one transaction, v_move_id := gen_random_uuid()
UPDATE public.notes
SET customer_id        = v_customer_id,
    project_id         = NULL,
    origin_project_id  = p_project_id,
    lifecycle_move_id  = v_move_id,
    lifecycle_moved_at = now(),
    context_label      = 'From project: ' || v_project_name
WHERE project_id = p_project_id
  AND user_id    = v_user_id;
```

`lifecycle_move_id` stamps the batch. That is what makes the reopen in step 4 correct rather than approximate.

The identical statement runs for `attachments`, but **only from Phase 3 onwards**, because that is when the table exists. Phase 2 ships the note half. Section 14 states the dependency rather than pretending the phases are independent.

The notes now genuinely belong to the customer. They are not a view, not a roll up, and they survive the project being deleted later.

When the project has **no** customer the notes stay exactly where they are, and the modal says so plainly: "These 9 notes will stay on the project. Set a customer to keep them on their record."

**3. Closing does not empty the project page.**

Moving the notes off would make a completed project look like it never had any, which is its own kind of loss. `ProjectNotes` therefore queries `project_id = X OR origin_project_id = X`, so a closed project still shows every note it ever had, read-only, with a small "now on Acme Ltd's record" badge. The note is visible from both sides and owned by one.

**4. Reopening puts them back.**

The lifecycle table already supports reopening a Completed or Cancelled project. Reopening reverses the move exactly:

```sql
-- inside reopen_project(), one transaction
UPDATE public.notes
SET project_id         = p_project_id,
    customer_id        = NULL,
    origin_project_id  = NULL,
    lifecycle_move_id  = NULL,
    lifecycle_moved_at = NULL,
    context_label      = NULL
WHERE origin_project_id  = p_project_id
  AND lifecycle_move_id IS NOT NULL
  AND user_id            = v_user_id;
```

**The condition is `lifecycle_move_id IS NOT NULL`, not a match on `customer_id`.** An earlier revision used the customer, which cannot tell "the close moved this and nobody has touched it" apart from "I deliberately re-filed this while the project was closed". It also broke outright if the project's customer changed while it was closed, stranding the notes on the old customer forever.

Any user edit or re-file clears `lifecycle_move_id`, so the rule is simply: **reopen takes back exactly the rows the close moved and that you have not since touched.** Everything else is left alone.

**The same rule now applies to tasks**, which fixes a pre-existing bug rather than avoiding a new one:

```sql
UPDATE public.tasks
SET state              = 'backlog',
    lifecycle_move_id  = NULL,
    lifecycle_prev_state = NULL
WHERE project_id        = p_project_id
  AND user_id           = v_user_id
  AND state             = 'cancelled'
  AND lifecycle_move_id = v_close_move_id;
```

The current code omits the `lifecycle_move_id` condition, so it revives tasks you cancelled by hand long before the project closed. Section 5.9 has the detail and the backfill for projects that are already closed.

The close-out note written in step 1 is **not** moved back. It was written about the customer, not the project, and it stays with them.

**5. The customer view surfaces closed work.**

The customer has a **"Closed projects"** section, collapsed by default, showing name, outcome and `completed_at`. The timeline shows the moved notes with a badge linking back to the project they came from.

### 7.2 Project deleted

Foreign key changes, applied in Phase 2 for notes and Phase 3 for attachments:

```sql
ALTER TABLE public.notes DROP CONSTRAINT notes_project_id_fkey;
ALTER TABLE public.notes ADD CONSTRAINT notes_project_id_fkey
  FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;
```

`ON DELETE SET NULL` is the safety net, so even a raw database delete can no longer destroy notes. The intended path is explicit, in `projectLifecycleService.deleteProject`, and runs **before** the project row is deleted:

1. If the project has a customer: every note and attachment on it is re-parented to that customer, with `context_label` set to `From project: <name> (deleted <date>)`.
   **This must also rewrite the rows that moved earlier at close time.** Those already carry `context_label = 'From project: <name>'` with no deletion date, and `ON DELETE SET NULL` can only null `origin_project_id`, it cannot update a text column. So the RPC updates every row matching `project_id = p OR origin_project_id = p` **before** deleting the project, stamping the final label and clearing `lifecycle_move_id` (there is nothing left to reopen into). Skipping this step means the note silently loses the fact that its project was deleted, which is the exact loss the tombstone exists to prevent.
2. If the project has no customer: notes and attachments become **unfiled** (all parent columns null). They stay searchable and are listed in an "Unfiled" section, described below. The delete modal states this plainly.
3. The delete modal offers an explicit "delete these too" option for people who genuinely want them gone. It is never the default.

`ProjectDeleteModal` and `getProjectImpact` are rewritten to say what will be **kept and where it goes**, not just what will be destroyed. For example: "12 notes and 3 files will move to Acme Ltd. 8 tasks will become unassigned."

### 7.3 Customer archived or deleted

- **Archived** (`archived_at` set): hidden from the customer list. Nothing else changes. Fully reversible.
- **Deleted**: this **removes the customer record, it does not erase everything you can see on their page.** That distinction was ambiguous in earlier revisions and it matters, because the customer view shows a roll up. The button is labelled "Remove customer record" for that reason.
  - Projects and tasks survive with `customer_id` set to null.
  - Contacts become standalone (`customer_id` null), not deleted.
  - Notes and attachments **whose own `customer_id` points at this customer** become unfiled, with `context_label` recording the customer name.
  - Notes and attachments that belong to a surviving project, task or note **stay exactly where they are**. They simply stop appearing under a customer that no longer exists.
  - Facts are the one thing destroyed, because a fact has no meaning without its customer.
- The delete impact endpoint breaks the counts down by where the data actually lives, so the modal can say "8 notes filed directly on this customer will become unfiled. 34 notes on their projects will stay on those projects." A single merged number would mislead.
- There is no separate full erasure workflow. If you need every trace gone, delete the projects first, then the customer.

### 7.4 Task deleted

- Notes on a task are destroyed, unchanged from today. Tasks are deleted routinely and task notes are usually a line of working detail. Making every deleted task leave an unfiled note would turn the unfiled list into noise. This is a deliberate decision, not an oversight, and the delete confirmation states the count.
- **Attachments on a task are never destroyed.** They re-parent to the task's project, or to its customer if it has no project, or become unfiled. A file is always worth more than the task it was attached to.

### 7.4b Note deleted

Notes become editable and deletable in Phase 2, and attachments can hang off a note from Phase 3, so this needs stating rather than falling through to the raw foreign key.

- **Attachments on a deleted note are never destroyed.** They re-parent up the same chain as a task: to the note's customer if it had one, else its project, else its task, else unfiled, with a `context_label` recording the note it came from.
- The delete confirmation names the count before you commit: "This note has 2 files. They will move to Acme Ltd."
- There is no "delete the files too" option. Deleting the file is a separate, deliberate action on the file itself.

### 7.5 Unfiled notes and files

Unfiled means every parent column is null, which the check constraint permits. They get a real home rather than becoming invisible:

- The `/customers` page, with no customer selected, shows an **"Unfiled" panel** alongside the attention dashboard, listing unfiled notes and files newest first with their `context_label`.
- Each row has a one click "file to customer" picker.
- They are included in search results from Phase 4.
- A count badge appears on the Customers nav item when anything is unfiled, so it cannot sit there unnoticed.

### 7.6 Summary of close and delete behaviour

| Event | Its tasks | Its notes | Its attachments | Its contacts |
|---|---|---|---|---|
| **Project closed** | Cascaded to done or cancelled, as today | **Move to the customer**, still shown on the project, reversible on reopen | Same as notes | Unchanged |
| **Project reopened** | Only tasks *this close* cancelled return to backlog, `done` stay done. Fixes a live bug, see 5.9 | Move back to the project, except the close-out note | Move back | Unchanged |
| Task deleted | n/a | Destroyed, count shown first | Re-parented to project, then customer, then unfiled | n/a |
| Project deleted | Survive as unassigned, keep their customer | Re-parented to customer, else unfiled | Re-parented to customer, else unfiled | Unlinked, contacts survive |
| Customer deleted | Survive, customer cleared | Direct ones unfiled, project-owned ones stay put | Same as notes | Become standalone |
| Note deleted | n/a | The note itself goes | Re-parented up the chain, never destroyed | n/a |

### 7.7 Changing or clearing a project's customer

Setting a customer for the first time is easy. Changing one on a project that already has history is not, and it was undefined in earlier revisions. It happens for two quite different reasons and the app cannot tell them apart, so it asks.

**Open project.** Changing the customer shows an impact preview first, then applies in one RPC:

- All its tasks repoint, including completed and cancelled ones, via the existing trigger.
- Notes and files sitting directly on the project are unaffected, because they belong to the project. They simply roll up under the new customer.
- The Office 365 list name changes on the next sync.
- Completed report history does **not** move. See 10.3.

**Closed project.** Refused, with a message: reopen it first. A closed project's notes have been moved onto the old customer and are stamped with `lifecycle_move_id`. Allowing the customer to change underneath that would strand them somewhere no reopen can reach. Reopening pulls the notes back onto the project, at which point changing the customer is the simple open-project case, and closing again hands them to the right customer. That is three clicks instead of one, and it is the only version that cannot lose track of a note.

**Clearing the customer** (setting it to none) is allowed on an open project and behaves like changing it to nothing: tasks lose their customer, notes and files stay on the project.

**Assigning a customer to a project that is already closed** is likewise refused with the same "reopen first" message, for the same reason.

### 7.8 Every lifecycle operation is one database transaction

This is the single most important correction in Revision 5.

Sections 7.1 to 7.7 describe operations that change the project, its tasks, its notes, its attachments, a close-out note and possibly some facts. Earlier revisions said this happened "in the same transaction" while placing the logic in a JavaScript service using the Supabase client. **That is not true.** Each `.update()` and `.insert()` is a separate PostgREST request and therefore a separate transaction. A service function is not a transaction boundary.

The existing code already shows the symptom: `PATCH /api/projects/[id]` updates the project, then cascades tasks, and has an explicit partial-failure response carrying `projectUpdated: true`. Adding note movement, attachment movement, a close-out note and facts to that pattern multiplies the number of half-done states.

So each operation becomes one `SECURITY DEFINER` Postgres function:

| RPC | Replaces |
|---|---|
| `close_project(p_project_id, p_user_id, p_status, p_closeout_note, p_facts)` | Status change, task cascade, note and file handover, close-out note, facts, all at once |
| `reopen_project(p_project_id, p_user_id, p_status)` | Status change, task restoration, note and file return |
| `delete_project_preserving_content(p_project_id, p_user_id, p_destroy_content)` | Tombstone stamping, re-parenting, then the delete |
| `delete_customer_preserving_content(p_customer_id, p_user_id)` | Unfiling direct rows, standalone-ing contacts, dropping facts, then the delete |
| `reassign_project_customer(p_project_id, p_user_id, p_customer_id)` | Section 7.7 |
| `create_task_with_customer(p_user_id, p_name, p_due_date, p_customer_name, p_customer_id, p_project_id)` | Section 9.3 capture, resolve-or-create plus task insert |
| `set_primary_contact(p_customer_id, p_contact_id, p_user_id)` | Section 5.3 |

Every one of them must:

1. `SELECT ... FOR UPDATE` the target row, so two concurrent submissions serialise instead of interleaving.
2. Verify `user_id` matches inside the function. The caller is the service role, so the function cannot rely on RLS.
3. Validate the expected current state and raise if it does not hold, which makes a double-submitted modal a no-op rather than a duplicate.
4. Return counts, so the UI can report what actually happened rather than what it hoped would happen.
5. Be declared `SET search_path = public` and have `EXECUTE` revoked from `public`, `anon` and `authenticated`. These functions bypass RLS by design and must be reachable only through the service role.

**What stays outside the transaction:** Microsoft Graph calls and Supabase Storage object deletion. Neither can join a Postgres transaction. Both are made retryable instead. Storage deletion uses the `deleting` status from section 5.5. Graph list renames are best effort on the next sync, exactly as today.

The API returns the RPC's counts on success. If the database commits but the external cleanup fails, the response is still a success and the failure is recorded for the next reconciliation pass, because the durable state is correct and retrying the whole close would be worse.

---

## 8. Attachments architecture

This is the part of the design with a genuine constraint that rules out the obvious approach.

### 8.1 Why Supabase Storage RLS cannot be used here

Auth in this app is **NextAuth.js, not Supabase Auth**. There is no Supabase JWT for the logged in user, and every route already uses the service role client. Inside a Supabase Storage RLS policy, `auth.uid()` would therefore be `NULL`, and the standard documented policy (`auth.uid()::text = (storage.foldername(name))[1]`) would deny everything or, if written loosely, allow everything.

**Storage security must therefore rest entirely on the NextAuth session check plus an explicit `user_id` ownership check in the API route**, exactly as the rest of the app already works. Concretely:

- The bucket is **private** and gets **no policies at all** for `anon` or `authenticated`. Only the service role key can read or write it.
- The anon key must never be used to touch the bucket from the browser.

### 8.2 Why uploads cannot go through the API route

Vercel functions have a hard 4.5 MB request and response body limit, returning `413 FUNCTION_PAYLOAD_TOO_LARGE` above it. It is an infrastructure limit and cannot be raised in `vercel.json`. A single customer PDF will breach it.

### 8.3 The upload and download flow

**The row is created first, and it is the authorisation record.** An earlier revision issued a signed URL, then trusted the client's declared size and type and merely checked that some object existed at the path it sent back. That is not enough: a signed upload authorises a transfer, it does not promise the finished object matches the JSON that requested it. A client could declare 1 MB and upload 500 MB, declare a PDF and upload anything, or hand back a path that was never issued to it. The 25 MB cap and the MIME allowlist would both be decorative.

**Upload, three steps:**

1. `POST /api/attachments/upload-url` with `{ parent_type, parent_id, file_name, mime_type, size_bytes }`.
   The route checks the NextAuth session, verifies the caller owns the parent row, checks the declared size and type against the allowlist and the per-parent and per-user quotas, then **inserts an `attachments` row with `status = 'pending'`**, a server-generated `storage_path`, the intended parent, and `upload_expires_at = now() + 1 hour`. It calls `createSignedUploadUrl(path)` and returns `{ attachment_id, path, token }`. The client never chooses the path.
2. The browser uploads directly to Supabase Storage with `uploadToSignedUrl(path, token, file)`. This bypasses Vercel entirely, so the 4.5 MB limit does not apply.
3. `POST /api/attachments/[id]/finalise`. The route re-checks the session and that the pending row belongs to this user, refuses if `upload_expires_at` has passed or `status` is not `pending`, then calls **`storage.info(path)`** to read the object's **actual** size and content type. It compares them against the allowlist and the cap. If they pass, it writes the real `size_bytes`, sets `status = 'ready'` and `ready_at`. If they fail, it deletes the object, sets `status = 'failed'` with `last_error`, and returns 422.

   `storage.info()` and `storage.exists()` are both available in the installed `@supabase/storage-js` 2.91.1, so this needs no new dependency.

Finalisation is idempotent: calling it twice on a `ready` row returns the same result rather than erroring, because a flaky network retry is normal.

**Download:**

`GET /api/attachments/[id]/url` checks the session, checks `attachments.user_id` matches and `status = 'ready'`, then returns a `createSignedUrl(path, 60)` with a `download` option set to the original `file_name`. Sixty second expiry, generated per click, never stored. Forcing the download rather than inline rendering means a file type that slipped the allowlist still cannot render in a browser context.

**Storage path convention:**

```
{user_id}/{attachment_id}
```

Two deliberate choices here. The `user_id` prefix is forward compatibility: if the app ever moves to Supabase Auth, the standard folder based RLS policy can be added with no data migration. **The original filename is not in the path**, because filenames routinely contain customer names and invoice numbers, and paths appear in provider logs. The display name lives in `attachments.file_name` and is applied at download time.

Because parents change under re-parenting (section 7), **the storage path is never rewritten when an attachment moves.** The path is an immutable address keyed on the row id; the parent columns are the truth about where it belongs.

### 8.4 Orphans, limits and validation

**Deletion is a two phase commit, not an ordering trick.** An earlier revision claimed that deleting the object first and the row second meant a failure left a recoverable row. That was wrong: if the object delete succeeds and the row delete then fails, the row survives pointing at a file that is already gone, and every download from it fails forever. The database and object storage cannot share a transaction, so ordering alone cannot fix this. Instead:

1. Set `status = 'deleting'` and `deleting_at = now()`. Commit. The row disappears from the UI immediately.
2. Delete the storage object.
3. Delete the row.

A failure at step 2 or 3 leaves a `deleting` row that the reconciliation pass retries. Nothing is ever shown to you that cannot be downloaded, and nothing is silently stranded.

**Reconciliation** runs weekly at `/api/cron/reconcile-attachments`, guarded by `CRON_SECRET` like the existing crons, and writes its result to the existing `cron_runs` table so a repeated failure is visible rather than buried in serverless logs. It is **database driven, not a bucket scan**, which matters: `storage.list()` returns 100 objects by default and lists a single folder level, so the naive "list the bucket and compare" design in the previous revision would have silently stopped after 100 rows and never recursed. Instead it queries bounded batches:

| Pass | Query | Action |
|---|---|---|
| Stale pending | `status = 'pending' AND upload_expires_at < now()` | Delete any object, delete the row |
| Stuck deleting | `status = 'deleting' AND deleting_at < now() - 1 hour` | Retry object delete, then row delete |
| Missing object | `status = 'ready'`, sampled batch, `storage.exists(path)` | Flag, do not auto-delete. A missing file is a bug to look at, not something to tidy away |

Only the third pass touches storage broadly, and it is a bounded sample rather than a full scan, so it cannot outgrow a Vercel function timeout.

**Quotas and what this feature is not.** A 25 MB per file and 50 per parent cap still allows unbounded totals, so there is a per-user cap of 2 GB, checked at step 1 and surfaced on the files section. **Uploaded files are not scanned for malware.** They are your own files in a single user app, and saying so plainly is better than implying a protection that does not exist. Supabase Storage objects are not covered by the database backup, so a deleted object is gone: that is stated in the delete confirmation.

**Limits and validation:**

| Rule | Value | Why |
|---|---|---|
| Max file size | 25 MB | Comfortably above a slide deck, well below the point where signed uploads need TUS |
| MIME allowlist | PDF, images (not SVG), Office documents, CSV, plain text, zip, eml and msg | Positive allowlist, not a denylist |
| Blocked explicitly | `text/html`, `image/svg+xml`, executables | Both can carry script. They would run on the Supabase origin, not the app origin, but there is no reason to host them |
| Max per parent | 50 | A guard rail, raise if it bites |
| Filename | Sanitised in the path, original preserved in `file_name` | The path is a UUID prefixed slug, so a hostile filename cannot traverse |

### 8.5 Unverified assumption

There is a known Supabase issue where `createSignedUploadUrl` called with the **service role** key produces a token with a null owner, and reports have linked that to RLS violations on the subsequent upload. Because this design has no storage policies at all (service role only), it should not be affected, but this has not been proven against the live project.

**This needs a spike before Phase 3 starts, and the spike must cover the whole round trip, not just token creation.** It has to prove, against the real Supabase project: issuing a signed upload URL from the service role, uploading to it from a browser, reading back accurate size and content type with `storage.info()`, generating a working signed download URL with a forced filename, and deleting the object. A spike that only proves the token can be minted would miss the two places this design actually depends on.

If signed upload URLs turn out not to work from the service role, the fallback is a route that proxies uploads under 4 MB with a documented size cap, which is worse but workable. Phases 1, 2 and 4 do not depend on this.

### 8.6 Upload states in the interface

A direct browser upload of a 25 MB file has more failure modes than a form post, and each one needs a defined outcome rather than a spinner that never resolves.

| State | What you see |
|---|---|
| `pending`, uploading | Progress bar with a cancel button. Cancel deletes the pending row |
| `finalizing` | Brief, "checking file" |
| `ready` | The file appears in the list |
| `failed` | Inline error naming the reason (too large, type not allowed, token expired) with a retry button |

Specific cases: an expired token retries from step 1 rather than failing outright. A parent deleted mid-upload fails finalisation with a clear message and cleans up. Navigating away mid-upload leaves a pending row that reconciliation removes within the hour. Duplicate filenames are allowed, because the path is keyed on the row id, so two files called `invoice.pdf` do not collide. Files can be chosen with the keyboard through a normal file input, not only by dragging.

---

## 9. Task capture: one input on both pages

### 9.1 What is wrong today

There are two completely separate task capture components with different behaviour:

| | `/today` (`QuickTaskList.jsx`) | `/projects` (`AddTaskInput.jsx`) |
|---|---|---|
| Input | Textarea, one task per line, up to 25 | Single line, one task |
| Due date | Parsed from the text by `parseQuickTaskDate` | **Hardcoded to today. Cannot be set at all** |
| Live preview of the parsed date | Yes | No |
| Date basis | `getLondonDateKey()`, correct | `format(new Date(), 'yyyy-MM-dd')`, **machine local, wrong** |
| Customer | Not possible | Not possible |
| Project | Always null | The selected project |
| Partial failure | Failed lines stay in the box | Typed text kept on error |

Two problems fall out of that, and one of them is a live bug:

- **You cannot set a due date when adding a task to a project.** Everything lands due today. This is your first request.
- **`AddTaskInput` uses raw `new Date()`.** The workspace standard forbids this and requires `getLondonDateKey()`. Near midnight, or across a BST boundary, or from a machine on another timezone, it writes the wrong due date. It has simply not been noticed because the value is always "today" anyway.

### 9.2 The fix: one shared component, not a copied parser

Both pages move to a single `QuickTaskInput` in `src/components/shared/`, with a `mode` prop:

- `mode="single"`: one line, inline, submits on Enter. Used by `ProjectWorkspace` and the new customer workspace.
- `mode="multi"`: textarea, up to 25 lines, submits on the button. Used by `/today`.

Everything else is shared: the parser, the live preview, the 255 character name limit, the partial failure handling, and the London date basis. `QuickTaskList.jsx` becomes a thin wrapper rendering `QuickTaskInput` in multi mode, so its existing tests keep passing unchanged.

The reason to merge rather than copy the parser into `AddTaskInput`: the date grammar is genuinely subtle. It uses chrono-node with the GB locale and forward dates, only accepts a date at the **end** of a line (so "Discuss Friday trading" keeps its words), excludes recurrence tails (so "water the plants every Monday" is not a due date), and adds hand written special cases for "the day after tomorrow", "a week today", "next Friday", "end of week" and "end of month". Two copies of that will drift, and the drift will be silent.

### 9.3 Naming a customer in the capture line

`parseQuickTaskDate` is generalised into `parseQuickTask(input, { baseDateKey, customers })`, returning `{ name, dueDate, customerId, customerName, createsCustomer, warning }`. `createsCustomer` is what the preview reads to show "New customer: X" before you commit.

There are two forms, and **they behave differently on purpose**, because one is a deliberate command and the other is ordinary English.

#### `@Name` is a command. It creates the customer if it does not exist.

Typing `@` is an explicit act. Nobody types `@Northgate` by accident. So:

- If `Northgate` matches an existing customer (case insensitively), the task links to it.
- If it matches nothing, **a new customer named `Northgate` is created** with `status = 'Active'` and no other fields, and the task links to it.

The safeguard is visibility, not a dialogue box. The live preview shows `New customer: Northgate` in a distinct style before you press Enter, and the success message afterwards reads "Task added. Created customer Northgate", with the name as a link to their new page. Creating one by mistake costs one click to delete, and a brand new customer has nothing in it to lose.

**Near-miss protection.** If the typed name is one or two characters away from an existing customer, the preview adds a quiet hint: `New customer: Acmme. Did you mean Acme?`. It does not block, it does not autocorrect, it just shows you. The case-insensitive unique index from section 5.1 already prevents an exact duplicate.

**The grammar, precisely.** Left loose, this parser would create a customer called `acme.com` the first time you typed a task containing an email address. So:

1. **An `@` token starts only at the beginning of the line or immediately after whitespace.** `Email joe@acme.com about the quote` contains no token, because that `@` follows a letter. This single rule removes the largest false-positive class.
2. **Unquoted, the name runs to the next whitespace**, minus any trailing punctuation. `Check @Acme,` resolves "Acme" and leaves the comma in the task name.
3. **Quoted, `@"..."` runs to the closing quote**, which may contain spaces. An unclosed quote is not a token: the text is left alone and the preview says so.
4. **Longest existing-customer match wins over rule 2.** `@Acme Ltd` finds "Acme Ltd" when that customer exists, and creates "Acme" when it does not.
5. **At most one token per line.** `Talk to @Acme @Beta` is a preview error ("more than one customer named"), not a guess and not two customers. The task is not created.
6. Names may contain letters, digits, spaces, `&`, `.`, `'`, `-` and `/`. Anything else terminates an unquoted name.

Because the preview always shows exactly what will be created and what the task will be called, a wrong guess is visible before it happens rather than after.

**Autocomplete.** A filtered list appears after `@`, so in practice you pick an existing customer rather than typing one out. Creation is what happens when you keep typing past the end of the list.

#### `for Name` is prose. It only ever matches customers you already have.

This is the phrasing you described ("do this for x on y date"). It is deliberately restricted to **exact matches on existing customer names, and never creates anything**, because "for" is far too common a word to trust.

`Buy flowers for the wedding tomorrow` must not invent a customer called "the wedding". It will not: "the wedding" is not in your list, so the words stay in the task name and no customer is set. Silently.

That asymmetry is the whole design. The sigil means you meant it, so the app acts. The plain word might be an accident, so the app only recognises what it already knows.

#### Order and examples

Strip the customer token first, then parse the date from what remains. Both are removed from the saved task name.

| Typed | Saved name | Due | Customer |
|---|---|---|---|
| `Send the proposal @Acme next Friday` | Send the proposal | next Friday | Acme, existing |
| `do this for Acme on 12 September` | do this | 12 September | Acme, existing |
| `Chase invoice @Acme` | Chase invoice | today | Acme, existing |
| `Kick-off call @Northgate tomorrow` | Kick-off call | tomorrow | **Northgate, created** |
| `Scope the work @"Northgate Group"` | Scope the work | today | **Northgate Group, created** |
| `Buy flowers for the wedding tomorrow` | Buy flowers for the wedding | tomorrow | none, and nothing created |
| `Sort this for the accountant` | Sort this for the accountant | today | none, and nothing created |
| `Discuss Friday trading` | Discuss Friday trading | today | none |
| `Email joe@acme.com about the quote` | Email joe@acme.com about the quote | today | none, the `@` follows a letter |
| `Talk to @Acme @Beta` | not created | n/a | preview error, more than one token |

#### Archived and Former customers

Autocomplete shows archived customers, greyed, below the active ones. Selecting one, or typing `@ArchivedName` directly, does **not** silently file new work against something you have archived. The preview says "Acme Ltd is archived" and the submit unarchives it first, with that stated in the success message.

`@` never creates a customer whose name collides with an archived one, because the unique index in 5.1 is not filtered by `archived_at`. Without this rule the insert would fail with a confusing uniqueness error against a record you cannot see. `Former` customers match normally and are flagged in the preview.

#### The multi-line race

`/today` submits up to 25 lines with `Promise.allSettled`, in parallel. Two lines naming the same new customer would both try to insert it, one would win, and the other would fail its whole task on a uniqueness error.

Capture therefore resolves customers **before** creating tasks: the client collects the distinct new customer names across all lines, creates them in one request, then submits the tasks. Server side, `create_task_with_customer` uses `INSERT ... ON CONFLICT (user_id, lower(btrim(name))) DO NOTHING` followed by a select, so even a genuine collision resolves to the existing row instead of failing. The success message reports one creation per customer, not one per line.

Because customer creation and task creation happen in the same RPC transaction (section 7.8), a task that fails to insert cannot leave a new empty customer behind.

### 9.4 The project page rejects a customer token, on purpose

On a project's task input (`mode="single"` with a `projectId`), a customer token is **rejected with a message**, not silently ignored:

> "Tasks on a project take the project's customer. Set it on the project instead."

This is not a UI preference. `fn_task_customer_sync` (section 5.4) overwrites `customer_id` from the project whenever `project_id` is set, so accepting the token would promise something the database undoes on write. The interface must not lie about what was saved.

**Critically, the rejection happens before creation.** An `@NewName` typed on a project's task input must not create a customer that is then immediately discarded by the trigger. The token is detected, the submit is refused with the message above, and nothing is written. This is the one place where `@` does not create.

On the customer workspace, the input already has a customer. A token that resolves to **that same customer** is redundant: it is stripped, and the preview notes it. A token naming or creating a **different** customer is rejected before creation, with "This adds a task for Acme Ltd. Use their page to add a task for someone else." Silently filing a task under a customer whose page you are not on, or creating one from a page dedicated to another, are both worse than a refusal.

### 9.5 Bug fixed along the way

`AddTaskInput`'s `format(new Date(), 'yyyy-MM-dd')` becomes `getLondonDateKey()`, matching `/today` and the workspace date standard. Called out explicitly because it is a behaviour change, not just a refactor: tasks added late in the evening currently get the wrong due date.

### 9.6 What is not included

Setting the **project** from the capture line (a `#project` token on `/today`) is a natural extension of the same parser and is deliberately not built. It was not asked for, and the parser is designed so it can be added later without restructuring.

---

## 10. Impact on existing features

### 10.1 Office 365 list naming

**Decision confirmed: Microsoft To Do list names become "Customer: Project".**

`office365SyncService` currently derives the remote list name from `project.name` alone, in three places (create at line 508, rename at line 533, recreate after a 404 at line 537). A single `buildListDisplayName(project, customer)` helper replaces all three:

- With a customer: `"Acme Ltd: Website Rebuild"`.
- Without a customer: `"Website Rebuild"`, unchanged.
- The separator lives in one constant so it can be changed in one place.

**This is a bulk rename.** The sync already calls `updateTodoList` with the derived name on every pass, so the first sync after deploy renames every list belonging to a project that has a customer. That is the intended outcome and you have confirmed it. Three things must be handled so it is safe:

1. **Adoption must stop guessing.** `listRemoteLists` matches remote lists by lowercased `displayName` and takes the **first match**, then adopts it when there is no local mapping. Two problems, and the second is worse than the first:
   - After the rename, a project with no mapping looks for "Acme Ltd: Website Rebuild", does not find the existing "Website Rebuild", and creates a duplicate. So adoption tries the composed name and then falls back to the bare project name.
   - **Project names are not unique in this database.** Two projects called "Website Rebuild" produce two identical bare names, and "first match wins" will silently attach one project's sync to the other project's list. Tasks then sync into the wrong list. That is data going to the wrong place, not a cosmetic problem.

   **The rule is therefore: adopt only on an unambiguous match.** If the fallback name matches more than one remote list, or more than one local project claims it, adopt nothing, leave the mapping unresolved, record it, and surface it on the integrations page for a manual choice. Creating a fresh list is also acceptable. Guessing is not.
2. **Length.** Microsoft documents `todoTaskList.displayName` as a string and publishes no maximum, so the 100 character cap in earlier revisions was invented. It stays as a defensive cap, but truncation now appends a short stable suffix derived from the project id (`... #a3fd`) whenever it actually truncates, because two long project names under the same customer would otherwise truncate to the same string and collide. A project name that alone exceeds the cap is truncated too, rather than only the customer part.
3. **The bulk rename is throttled and resumable.** The first sync after deploy issues a Graph `PATCH` for every project with a customer. Graph throttles with `429` and a `Retry-After` header, which the rename path must honour rather than treating as a failure. A partial run leaves some lists renamed and some not, which is **not** an error state: the next sync finishes the job. The sync result records how many were renamed, how many were skipped and how many adoptions were left ambiguous.
4. **Renaming a customer renames their lists.** No trigger is needed: the next sync recomputes the display name from current data and pushes it, best effort, exactly as it already does for project renames.

Note that this sends your customer names to Microsoft. You have decided that explicitly (decision 2), and as the only user of this app there is nobody else to ask, so there is no consent gate. It is recorded here so the choice is visible rather than implied.

### 10.2 Everything else

| Area | Change | Risk |
|---|---|---|
| `AddTaskInput`, `QuickTaskList` | Both replaced by the shared `QuickTaskInput`. Timezone bug fixed | Medium, it touches both capture paths, so tests come first |
| `quickTaskDateParser.js` | Generalised into `parseQuickTask` with customer resolution | Medium, existing parser tests must all still pass unchanged |
| `CreateProjectModal`, `ProjectWorkspace` | Customer picker with type to create. Stakeholders text field replaced by a contact picker | Low |
| `/api/projects` | `customer_id` in update fields and both selects. `stakeholders` removed from the write path in Phase 2 | Low |
| `/api/areas` | Include customer areas in the deduplicated list | Low |
| `ProjectDeleteModal`, `getProjectImpact` | Rewritten to show what is kept and where it goes, plus attachment counts | Medium, it is the safeguard for section 7.2 |
| `ProjectStatusChangeModal` | Close-out prompt on every close, plus the note handover to the customer | Medium, it moves rows so it needs the reopen path tested with it |
| `ProjectNotes.jsx` query | Widened to `project_id = X OR origin_project_id = X`, so a closed project still shows its notes | Low, but skipping it makes closed projects look empty |
| `projectLifecycleService` | Note and attachment move on close, reverse on reopen, re-parent on delete | Medium, it is the core of section 7 |
| `ProjectNotes.jsx` | Textarea instead of single line input, editable and deletable notes, source and date controls | Low |
| `completed-report` | Optional group by customer | Low |
| `dailyTaskEmailService` | Show customer name on task lines | Low, but it is a 34k line service so keep the change surgical |
| `TaskCard` | Customer chip when the task has one and no project | Low |
| `office365SyncService` | See 10.1 | **High**, adoption fallback is mandatory |
| `validators.js` | `validateProject` stakeholder rules removed, `validateNote` raised to 20000, new `validateCustomer` and `validateContact` | Low |

### 10.3 Completed reports need attribution at completion time

One of the stated goals is "what did I do for them last month". Grouping by the current `tasks.customer_id` cannot answer that reliably, because that column moves:

- Reassigning a project's customer repoints **every** task on it, including tasks completed months ago under the old customer.
- Deleting a customer nulls it, so past work vanishes from the report entirely.
- Last month's report therefore gives a different answer this month, which makes it useless for the one thing it is for.

So completion attribution is snapshotted, not derived:

```sql
ALTER TABLE public.tasks
  ADD COLUMN completed_customer_id   uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  ADD COLUMN completed_customer_name text;
```

Both are stamped by `fn_task_state_cleanup`, the same trigger that already owns `completed_at` and `cancelled_at`, at the moment a task enters a closed state. They are never written by application code, and never updated afterwards.

`completed_customer_name` is a plain text copy on purpose. It is what keeps a historical report readable after the customer is deleted, where the foreign key would go null. If you rename a customer, old reports keep the name you used at the time. That is the correct behaviour for a record of what happened.

The completed report groups by `completed_customer_id` where it is set, falling back to `completed_customer_name`, and shows tasks completed before this feature existed under "Unattributed". It does not backfill history, because the information to do it correctly does not exist.

Project-level completion uses the same idea: `projects.completed_customer_id` and `completed_customer_name`, stamped when the project closes.

---

## 11. Security

Every new table gets RLS enabled with correct per-user policies:

```sql
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY customers_own ON public.customers
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
```

**Explicitly do not copy the `projects` and `tasks` policy pattern.** Those two tables still carry a permissive `ALL` policy for `authenticated` with `USING (true) WITH CHECK (true)` alongside their correct per-user policies. Permissive policies OR together, so that pair means any Supabase authenticated JWT can read and write every row through PostgREST with the public anon key. This is already documented as a known issue in `CLAUDE.md` and verified against the live database. New tables must not repeat it.

**Removing those two policies is now a Phase 0 gate, not a background concern.** It was acceptable to leave them while `projects` and `tasks` held task names and due dates. This change puts customer identity on both tables and hangs customer facts, contacts, notes and files off their relationships. The new `fn_task_customer_sync` trigger will also happily act on a row written directly through PostgREST. Shipping customer data on top of a known open door is not a trade worth making, and the fix is a short migration:

```sql
DROP POLICY IF EXISTS "Authenticated users can manage all projects" ON public.projects;
DROP POLICY IF EXISTS "Authenticated users can manage all tasks"    ON public.tasks;
```

Both tables keep their correct per-user policies. Nothing in this application reads or writes through PostgREST with the anon key, so nothing should break, and Phase 0 verifies that with a test that authenticates as a Supabase JWT and confirms it can no longer see another user's rows.

**The lifecycle RPCs bypass RLS by design** and must not be callable by anyone but the server:

```sql
REVOKE EXECUTE ON FUNCTION public.close_project(uuid, uuid, text, text, jsonb)
  FROM public, anon, authenticated;
```

The same for every function in section 7.8. They are `SECURITY DEFINER`, they take a `p_user_id`, and they verify it internally, so an exposed one would be a full data breach rather than an inconvenience.

Beyond RLS, the real protection is the same as everywhere else in this app: NextAuth session check plus an explicit `user_id` ownership check in every route, because every route uses the service role client.

Attachment specifics are in section 8.

---

## 12. API surface

All routes follow the existing pattern: rate limit keyed on user id after the auth check, NextAuth session check, explicit `user_id` ownership check, service layer, service role Supabase client.

| Method and path | Purpose |
|---|---|
| `GET /api/customers` | List, with `?include_archived=`, `?status=`, `?area=`, `?q=`. Returns derived `open_project_count`, `open_task_count`, `last_contact_at` |
| `POST /api/customers` | Create |
| `GET /api/customers/[id]` | Single customer with facts and contacts |
| `PATCH /api/customers/[id]` | Update, including archive and unarchive |
| `DELETE /api/customers/[id]` | Hard delete, requires confirmation |
| `GET /api/customers/[id]/impact` | Delete impact: projects and tasks unassigned, notes and files unfiled, facts destroyed, contacts made standalone |
| `GET /api/customers/[id]/overview` | The single view payload: open projects, closed projects, tasks, timeline page one, attachments, facts, contacts |
| `GET /api/customers/[id]/timeline` | Paginated merged stream of notes and attachments across the customer and their projects (open and closed) and tasks |
| `POST /api/customers/[customerId]/facts` | Create a fact |
| `PATCH/DELETE /api/customers/[customerId]/facts/[factId]` | Edit or remove one fact |
| `POST /api/customers/[customerId]/facts/order` | Reorder, takes the full ordered id list |
| `PATCH /api/customers/[customerId]/primary-contact` | Calls `set_primary_contact`, see 5.3 |
| `PATCH /api/customers/[customerId]/customer` | Reassign, calls `reassign_project_customer`, see 7.7 |
| `GET/POST /api/contacts` | People registry, filterable by customer |
| `PATCH/DELETE /api/contacts/[contactId]` | Edit or archive one contact |
| `PUT /api/projects/[id]/contacts` | Replace the whole contact set for a project |
| `DELETE /api/projects/[id]/contacts/[contactId]` | Unlink one |
| `GET /api/unfiled` | Unfiled notes **and** files. Renamed from `/api/notes/unfiled`, which was misleading |
| `POST /api/unfiled/refile` | Move one unfiled note or file to a customer |
| `POST /api/attachments/upload-url` | Creates the pending row, returns the signed URL, see 8.3 |
| `POST /api/attachments/[id]/finalise` | Validates the real object and marks it ready |
| `GET /api/attachments` | List by parent, `ready` rows only |
| `GET /api/attachments/[id]/url` | Short lived signed download URL |
| `DELETE /api/attachments/[id]` | Delete object then row |
| `GET /api/search?q=` | Full text across notes, customers, facts, contacts |

`/api/notes` gains `customer_id`, `occurred_at`, `source`, `pinned`, `contact_id` on create, and gains `PATCH` and `DELETE` for `/api/notes/[id]`, which do not exist today.

`/api/projects` gains `customer_id` in `PROJECT_UPDATE_FIELDS` and in both `select()` lists.

`/api/tasks` accepts `customer_id` on create, and **rejects it with a 400 when `project_id` is also present**, matching the rule in section 5.4 rather than letting the trigger silently win.

It also accepts **`customer_name` as an alternative to `customer_id`**, which is what the `@Name` capture token sends. The route resolves it case insensitively and creates the customer if there is no match, then creates the task, **in one request**. Doing it as two client calls (`POST /api/customers` then `POST /api/tasks`) would leave a new empty customer behind whenever the task creation failed, which is exactly the kind of half-done state this app avoids elsewhere. The response returns `createdCustomer` so the UI can show the "Created customer Northgate" link.

`customer_name` is rejected with a 400 alongside `project_id`, for the reason in section 9.4.

**One canonical mutation route per operation, enforced in Phase 0.** `src/app/api/projects/route.js` currently exports a collection level `PATCH` (line 166) and `DELETE` (line 235) that write directly and never touch `projectLifecycleService`. Only `/api/projects/[id]` does. Verified against the repository on 2026-09-01. That means there is already a path that skips the task cascade, and after this change it would also skip close-out capture, note movement and the delete safeguards, producing different data depending on which URL was called.

Those two collection handlers are removed in Phase 0. `GET` and `POST` stay. A contract test asserts every mutation path produces the same lifecycle result, so this cannot quietly come back.

New services: `src/services/customerService.js` (customer record, roll ups, delete impact) and `src/services/attachmentService.js` (storage paths, signed URLs, finalisation, re-parenting, reconciliation). `projectLifecycleService` becomes a thin caller of the RPCs in section 7.8 rather than an orchestrator of separate writes.

**Error contract**, uniform across the new routes: `400` invalid input, `401` no session, `403` not yours, `404` missing, `409` name conflict after normalisation or a stale write, `413` file too large, `422` finalisation failed validation, `429` rate limited. Destructive and high-value edits take an `If-Unmodified-Since`-style `updated_at` precondition and return `409` on a stale write, so two tabs cannot silently overwrite each other.

`apiClient` gains the matching methods, plus `getCustomersForCapture()` (a small cached name and id list feeding the `@` autocomplete), following the existing `dedupedFetch` caching conventions.

---

## 13. The customer view

`/customers`, using the same two panel layout as `/projects`, because that page was redesigned to this shape deliberately and it works.

**Left panel**, roughly 280px, full height:

- New customer button
- Search box (name, facts, contacts)
- Filter pills: All, Active, Prospect, Needs attention, Archived. "Needs attention" means no logged contact in 30 days and at least one open project.
- Area dropdown, matching the projects page behaviour
- Customer list. Each row: name, status dot, open project count, and "last contact" as a relative date

**Right panel**, stacked sections, scrolling independently:

1. **Header.** Name, status, area, website, all inline editable in the existing `EditableField` style. Action menu: archive, delete.
2. **Key facts.** The `customer_facts` list, label on the left and value on the right, inline add and edit, drag to reorder. Collapsed to the first five with a "show all" toggle when long.
3. **Summary.** The one paragraph free-text block.
4. **Contacts.** Compact rows, primary flagged. Click to copy email or phone.
5. **Open projects.** Cards showing name, status, due date and open task count. Click through to `/projects?id=`.
6. **Closed projects.** Collapsed by default, showing name, outcome and completion date.
7. **Tasks.** Grouped by state with the same `STATE_GROUPS` headers `ProjectWorkspace` uses, reusing `TaskCard` and the shared `QuickTaskInput` in single mode. Shows the union of tasks directly on the customer and tasks reaching it through a project. A task added here with no project set gets `customer_id` directly.
8. **Timeline.** The merged stream. Notes plus attachment events, newest `occurred_at` first, with source icons, the contact it came from, `context_label` badges, and pinned items held at the top. Includes notes from closed projects. Filter chips by source. Add box is a textarea with an optional backdated date and a source picker, defaulting to today and "note".
9. **Files.** Flat attachment list with drag and drop upload, name, size, date and download.

**Empty state** with no customer selected: the attention dashboard, matching the existing `ProjectDashboard` pattern, plus the **Unfiled panel** from section 7.5.

**Mobile:** list first, workspace as a full screen push, matching the existing responsive behaviour. Sections stack.

**Navigation:** `Customers` is added to `Sidebar.jsx` (`navigation` array, `Users` icon from lucide-react) between Projects and Ideas, with a count badge when anything is unfiled. It is **not** added to `TabBar.jsx`, which is deliberately limited to five primary tabs.

---

## 14. Delivery phases

Complexity is 5 (XL), so this must be broken up. A **Phase 0** now comes first: it fixes the foundations this design assumes but the repository does not yet have, and none of it is customer specific.

### Phase 0: Foundations (score 3)

Nothing user visible. Everything here is a precondition for the rest being correct.

1. Drop the permissive `USING (true)` policies on `projects` and `tasks` (section 11), with a cross-user test proving the anon key can no longer read another user's rows.
2. Remove the collection level `PATCH` and `DELETE` from `/api/projects/route.js` so there is one canonical mutation path (section 12).
3. Stand up the local Supabase integration test harness that applies real migrations, so triggers, constraints and RPCs can be tested at all (section 17).
4. Establish the RPC transaction pattern with one function end to end, and the `REVOKE EXECUTE` convention.
5. Correct the stale test count in `CLAUDE.md`.

**Phase 0 must land before Phase 1.** Everything after it assumes a real transaction boundary and a closed PostgREST door.

**Migration discipline, every phase.** Expand, backfill, verify, deploy dual-compatible code, then contract in a later release. Never a schema change and a breaking code change in one step. This matters most in Phase 2: the moment notes move, the old `ProjectNotes` query (`project_id` only) stops seeing them, so **the widened query must deploy before the movement is enabled**, behind a flag. Rolling application code back after notes have moved would make them look deleted when the rows are fine. Note movement and the stakeholder drop are forward-only: the recovery path is a corrective migration, not a rollback. Take a database backup before Phase 2 and Phase 3.

**Getting your existing data in.** Customer ids cannot be inferred from stakeholder text, so on the day Phase 1 ships, every existing project is customerless and `/customers` is empty. That would make a working feature look broken.

Phase 1 therefore ends with one screen doing two jobs, because they are really the same job:

- **Stakeholder triage.** Every distinct stakeholder name, marked as a customer, a person, or skipped. Section 5.3b.
- **Bulk project assignment.** Every project without a customer, with a picker. Choosing "Customer" for a stakeholder assigns its projects automatically, so most of this fills itself in.

The order matters and is now fixed: **triage and assignment run in Phase 1, before the Phase 2 contact work.** Doing it the other way round would attach every person to a project with no customer, landing them all as standalone contacts needing a second manual pass.

Then four delivery phases, each independently deployable with no broken intermediate state.

### Phase 1: Customers, linkage and capture (score 4)

Ordered as separate commits, because the first is independently valuable and carries no customer dependency:

1. **Shared `QuickTaskInput`.** Merge `AddTaskInput` and `QuickTaskList`, giving the project page natural language due dates and fixing the `new Date()` timezone bug. Sections 9.1, 9.2, 9.5.
2. `customers` table. `projects.customer_id` and `tasks.customer_id` with both triggers.
3. `customerService`, `/api/customers` CRUD plus overview.
4. `/customers` page with list, header, summary, open projects, closed projects and tasks. Customer picker on project create and edit. Sidebar entry. `/api/areas` extension.
5. **Customer token in capture.** `parseQuickTask` with customer resolution, `@Name` creating a customer that does not exist, `for Name` matching only existing ones, the `@` autocomplete, the `customer_name` path on `POST /api/tasks`, and the project page rejection. Sections 9.3, 9.4.
6. Office 365 list naming with the ambiguity-safe adoption (section 10.1).
7. **The stakeholder triage and bulk assignment screen** (sections 5.3b, 14 preamble). This is the last item on purpose: it needs customers, the picker and the API to exist first, and everything after it depends on your existing work being linked up.

Deployable and useful on its own: you can see everything open for a customer, capture against them by typing, and your existing projects are actually attached to somebody.

### Phase 2: The record, and nothing lost (score 4)

Notes migration (`customer_id`, `contact_id`, `occurred_at`, `source`, `pinned`, `context_label`, `updated_at`, rewritten check constraint, `project_id` foreign key changed to `SET NULL`). `customer_facts`. `contacts` and `project_contacts`, populated from the Phase 1 triage rather than a blind backfill. Timeline roll up. Note editing and deletion. Textarea note input. `NOTE_MAX` raised to 20000. Close-out prompt on every project close, the **note** handover to the customer, the reverse on reopen, and the widened `ProjectNotes` query so closed projects still show their notes (section 7.1). Note re-parenting on project delete, with the rewritten `ProjectDeleteModal`. Unfiled panel. `close_project`, `reopen_project`, `delete_project_preserving_content` and `delete_customer_preserving_content` RPCs.

**The reopen bug fix ships here too** (section 5.9): `tasks.lifecycle_move_id` and `lifecycle_prev_state`, the backfill for already-cancelled projects, and the corrected restore in `reopen_project`. It belongs in this phase because `close_project` and `reopen_project` are written here, and stamping the marker is a few lines inside a function that is being written anyway. Doing it separately would mean touching both RPCs twice.

**No attachment handling in this phase.** Earlier revisions had Phase 2 moving attachments on close, while the `attachments` table is created in Phase 3, so the phases were not independently deployable as claimed. Phase 2 ships the note half only. **Phase 3 depends on Phase 2** and extends the same RPCs to cover files.

Deployable on its own: the customer becomes a record, and project close and delete stop losing value.

### Phase 3: Attachments (score 4)

**Preceded by the signed upload URL spike from section 8.5.** Bucket creation, `attachments` table, `attachmentService`, the three upload routes, download route, delete path, attachment re-parenting on project, task and customer delete, UI on customer, project, task and note, delete impact updates, reconciliation cron.

Deployable on its own.

### Phase 4: Find, report, and tidy up (score 2)

Full text and trigram search indexes, `/api/search`, the search box, unfiled items in search results, completed report grouped by customer using the snapshotted attribution from 10.3.

Then, as its own migration: archive `projects.stakeholders` to `projects_stakeholders_archive` and drop the column (section 5.3c). **Gated on every distinct stakeholder name having been triaged or explicitly skipped in Phase 1**, and preceded by the function and view audit the workspace rules require. The migration reports and stops rather than dropping data nobody has looked at.

---

## 15. Out of scope

Stated so the boundary is explicit:

- Email ingestion. No "forward to this address and it files itself". A large separate build.
- Office 365 contact or calendar sync into customers. Only the list naming changes.
- Opportunities, pipeline, deal stages or revenue. This is a record, not a sales CRM.
- Multi user, sharing or permissions.
- Custom field definitions beyond the `customer_facts` label and value pair.
- Notes targeting more than one record, see section 6.
- Rich text or markdown in notes. Plain text with preserved line breaks.
- Changing what happens to notes when a **task** is deleted, see section 7.4.
- A `#project` token in the capture line, see section 9.6.

---

## 16. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Office 365 adoption attaches a project to the **wrong** remote list | **High if not handled** | Project names are not unique. Adoption now refuses on any ambiguous match rather than taking the first. Section 10.1. This is the highest risk item in the change, and it is data going to the wrong place, not cosmetics |
| A lifecycle operation half commits | **High if not handled** | Every multi-row operation is one Postgres RPC with a row lock and an internal ownership check. Section 7.8. This is the correction Revision 5 exists for |
| Existing note history is rewritten to deployment time | **High if not handled** | `occurred_at` ships nullable, is backfilled from `created_at`, is verified to have zero nulls, and only then becomes `NOT NULL`. The migration fails rather than shipping wrong history. Section 5.4 |
| Attachment caps are decorative because the client declares them | Medium | The pending row is the authorisation record and `storage.info()` measures the real object at finalisation. Section 8.3 |
| A deleted file leaves a row that can never download | Medium | `deleting` status, commit, then delete the object, then the row. Retried by reconciliation. Section 8.4 |
| Completed reports change after the fact | Medium | Attribution is snapshotted at completion by the existing trigger, not derived from the current customer. Section 10.3 |
| Merging the two capture components regresses `/today` | Medium | `QuickTaskList`'s existing tests must pass unchanged against the merged component before anything else lands. It ships as commit one, on its own |
| The `for X` customer form creates false positives | Medium | Only exact matches against real customer names are accepted, and it never creates. Unmatched text is left in the task name, never dropped |
| A typo in `@Name` creates a junk customer | Medium | Preview shows `New customer: X` before commit, with a "did you mean" hint on near misses. Success message links to the new record. A new empty customer is one click to delete |
| Notes moved on close do not come back on reopen | Medium | `origin_project_id` is a real foreign key, not a text label, and the reverse is a single indexed update. Round-trip tested |
| A closed project looks like it never had notes | Medium | `ProjectNotes` queries `origin_project_id` as well. Called out separately because it is easy to miss and looks like data loss |
| Stakeholder conversion loses or mis-sorts a name | Medium | It is a triage screen you confirm, not a silent migration, with a preflight profile of the real data. The column stays populated until Phase 4, and its contents are archived to a table before the drop. Section 5.3b |
| The Phase 4 drop removes names nobody looked at | Medium | The migration is gated on every distinct name being triaged or explicitly skipped, and reports and stops otherwise. Section 5.3c |
| Signed upload URLs misbehave from the service role | Medium | Spike before Phase 3. Fallback is a proxied upload with a 4 MB cap. Phases 1, 2 and 4 unaffected |
| `tasks.customer_id` trigger fights application writes | Medium | Ownership rule documented in `CLAUDE.md`, the API rejects the combination with a 400, trigger tested directly |
| Orphaned blobs accumulate | Medium | Reconciliation cron with a 24 hour grace period, plus delete-object-before-row |
| Unfiled items become a junk drawer | Medium | Nav count badge, dedicated panel with a one click re-file, included in search |
| Changing `notes.project_id` to `SET NULL` masks a bug as an unfiled note | Low | The service re-parents explicitly first. The foreign key is only the safety net |
| Rewriting `check_note_parent` breaks existing notes | Low | The new constraint is strictly more permissive than the old one. Validate row counts before and after inside the transaction |
| Customer view slows with many notes | Low | Timeline is paginated, indexes are on `(customer_id, occurred_at DESC)` |

---

## 17. Verification

**The gate is these commands, not a number.** Earlier revisions cited "289 tests" from `CLAUDE.md` and required a typecheck. Both were wrong, verified on 2026-09-01: the suite is **31 files and 432 tests**, and there is **no typecheck script** because the app is plain JavaScript with no TypeScript at all. Quoting a total also rots on every commit.

```bash
npm run lint && npm test && npm run build
```

Plus `npx supabase db push --dry-run` before any migration. `CLAUDE.md` needs its stale figure corrected in Phase 0.

**The current suite cannot verify most of this design.** It is Vitest with mocked Supabase clients, so it cannot exercise a trigger, a check constraint, a `SECURITY DEFINER` RPC, an RLS policy or a Storage round trip, which is exactly where the risk in this change lives. A mocked test that passes while the real trigger is wrong is worse than no test. Three layers get added:

| Layer | Covers | Added in |
|---|---|---|
| Local Supabase integration tests, applying real migrations | Triggers, constraints, RPCs, RLS, the backfills | Phase 0 |
| Route tests with two distinct user ids | Ownership checks on every new route | Phase 1 |
| Storage integration tests against a real bucket | Upload, finalise, download, delete, reconciliation | Phase 3 |

Specific coverage on top of that:

**Task capture**
- Every existing `quickTaskDateParser` test passes unchanged against `parseQuickTask`.
- A task added on a project page with "next Friday" in the text is due next Friday, not today.
- `AddTaskInput`'s replacement uses the London date key, verified by faking a non-London timezone near midnight.
- `@Acme` resolves to the customer and is stripped from the name.
- `for Acme` resolves only when "Acme" is a real customer.
- `Buy flowers for the wedding tomorrow` keeps "for the wedding" in the name and sets no customer.
- `Discuss Friday trading` sets no due date and no customer.
- `@Northgate` with no such customer **creates** it and links the task.
- `@Acme Ltd` matches the existing "Acme Ltd" rather than creating "Acme".
- `@Acme Ltd` with no match creates "Acme" and leaves "Ltd" in the task name.
- `@"Northgate Group"` creates a multi-word customer.
- `for Northgate` with no such customer creates **nothing** and leaves the words in the task name.
- `Sort this for the accountant` sets no customer and creates nothing.
- A customer token on a project's input is rejected with a message, creates nothing, and writes nothing.

**Triggers and constraints**
- Task with a project takes the project's customer. Task without one keeps its own.
- Changing a project's customer repoints its tasks.
- Deleting a project leaves its tasks with the customer intact.
- `POST /api/tasks` with both `project_id` and `customer_id` returns 400.
- A note with two parents is rejected. A note with zero parents is accepted.
- An attachment with two parents is rejected.

**Nothing lost**
- Deleting a project with a customer moves its notes to that customer with a `context_label`.
- Deleting a project without a customer leaves its notes unfiled, not destroyed.
- Deleting a customer leaves projects, tasks and contacts intact.
- Deleting a task re-parents its attachments and does not destroy them.
- The delete impact preview count matches exactly what actually happens.
- The close-out prompt appears on **every** move to Completed and to Cancelled, not just some.
- An empty close-out textarea writes no note.
- Closing a project with a customer moves every one of its notes and attachments to that customer, with `origin_project_id` set.
- The closed project's page still lists those notes, read-only.
- Reopening the project moves them all back and clears `origin_project_id`.
- A note re-filed to a different customer while the project was closed is **not** yanked back on reopen.
- The close-out note itself stays on the customer when the project is reopened.
- Closing a project with no customer leaves its notes on the project and still shows the prompt.

**Roll ups**
- The customer task union counts a project task once, not twice.
- The customer timeline includes notes from Completed and Cancelled projects.

**Office 365**
- A project with a customer produces "Customer: Project".
- A project without one produces the bare name.
- Adoption finds a pre-existing list named with the bare project name after the rename.
- A composed name over 100 characters truncates the customer portion, not the project name.

**Stakeholder backfill**
- Every non-empty stakeholder string produces exactly one `project_contacts` row.
- Duplicate names across projects for the same customer produce one contact, not many.

**Attachment security**
- Finalising a row whose object was never uploaded is rejected.
- An object uploaded larger than declared is rejected at finalisation and the object is deleted.
- An object whose real content type is not on the allowlist is rejected, whatever was declared.
- Finalising an expired pending row is rejected.
- Finalising twice returns the same result rather than erroring.
- Requesting a download URL for another user's attachment is rejected.
- A `deleting` row whose object delete failed is retried and cleared by reconciliation.

**Transactions and ownership**
- A `close_project` that fails partway leaves the project open, the tasks untouched and no note moved.
- Two concurrent close submissions produce one close, not two close-out notes.
- Every lifecycle RPC rejects a `p_user_id` that does not own the target row.
- `EXECUTE` on every lifecycle RPC is denied to `anon` and `authenticated`.
- After Phase 0, a Supabase-authenticated JWT with the anon key cannot read another user's `projects` or `tasks` rows.

**Migration**
- After the Phase 2 migration, every pre-existing note has `occurred_at = created_at`, and none is the migration timestamp.
- The migration aborts if any row would be left null.

**Reopen provenance (section 5.9)**
- A task cancelled by hand before the project closed is **not** restored on reopen.
- A task cancelled by the close cascade **is** restored, to backlog.
- A task edited while the project was closed is left alone on reopen.
- `lifecycle_prev_state` records the state the task was actually in.
- After the backfill, reopening a project that was already cancelled restores its tasks as it does today.

**Stakeholder triage (section 5.3b)**
- The preflight counts match the live column, including blanks, embedded commas and email-like entries.
- Marking a name "Customer" creates one customer and assigns every project carrying that stakeholder.
- Marking a name "Customer" when a project already has a different customer flags the row instead of overwriting it.
- The same name on ten projects produces one customer, not ten.
- An entry containing `@` is offered as a person with the email pre-filled.
- Skipped names write nothing and block the Phase 4 drop.
- The Phase 4 migration refuses to drop the column while any name is untriaged.
- The archive table contains every non-empty stakeholder array before the drop.

**Reassignment and reporting**
- Changing an open project's customer repoints its tasks and leaves completed attribution alone.
- Changing a closed project's customer is refused.
- A task completed under Acme still reports under Acme after the project moves to Beta.
- A task completed under a customer who is later deleted still reports under their name.

---

## 18. Decisions confirmed

| # | Decision | Outcome |
|---|---|---|
| 1 | Can a note sit against two records at once? | **No.** Single parent, with roll up and re-parenting so nothing is lost. Sections 6 and 7 |
| 2 | Should Microsoft To Do list names become "Customer: Project"? | **Yes.** Section 10.1. The concern about the bulk rename was raised and overruled. Adoption fallback is mandatory |
| 3 | Should `projects.stakeholders` be folded into contacts? | **Yes.** Section 5.3. Backfilled in Phase 2, column dropped in Phase 4 |
| 4 | Is 25 MB the right file size cap? | **Yes.** Section 8.4 |
| 5 | How many phases? | **All four.** Section 14 |
| 6 | Same due date logic when adding tasks on a project? | **Yes.** One shared component, not a copied parser. Section 9.2 |
| 7 | Name a customer when adding a task on `/today`? | **Yes.** Section 9.3 |
| 8 | Should `@Name` create a customer that does not exist? | **Yes.** `@` is a deliberate command, so it creates. `for Name` is ordinary English, so it only ever matches what already exists and never creates. Section 9.3 |
| 9 | Should closing a project hand its notes to the customer? | **Yes.** Asked for close-out notes every time, and every note on the project moves onto the customer's record. Reversible on reopen, and still visible on the closed project. Section 7.1 |
| 10 | Where do multi-row lifecycle changes run? | **In one Postgres RPC per operation.** A JavaScript service is not a transaction. Section 7.8 |
| 11 | When does the permissive RLS on `projects` and `tasks` get fixed? | **Phase 0, before any customer work.** Section 11 |
| 12 | Current or historical customer on completed reports? | **Historical, snapshotted at completion.** Section 10.3 |
| 13 | Can a closed project's customer be changed? | **No, reopen first.** The only version that cannot strand a moved note. Section 7.7 |
| 14 | Does deleting a customer erase everything on their page? | **No, it removes the customer record.** Content on surviving projects stays put. Section 7.3 |
| 15 | Can `@Name` file work against an archived customer? | **Only by unarchiving it**, stated in the preview. Section 9.3 |
| 16 | Drop `projects.stakeholders`? | **Yes**, in Phase 4, after archiving the raw data and only once every name has been triaged. Section 5.3c |
| 17 | What do existing stakeholders become? | **Customers or people, your choice per name**, through a triage screen. Not a silent conversion to contacts. Section 5.3b |
| 18 | Backfill completed-report attribution for past work? | **No.** Attribution starts the day it ships. Older completed tasks show as "Unattributed". Section 10.3 |
| 19 | Bulk assignment before or after the stakeholder conversion? | **Same screen, in Phase 1, before the Phase 2 contact work.** Section 14 |
| 20 | Fix the pre-existing reopen bug as part of this? | **Yes.** Cascade provenance on tasks, shipped in Phase 2 alongside the RPCs it lives in. Section 5.9 |

---

## 19. Raised in review, deliberately not doing

The independent review raised 42 findings. Most are folded in above. These are the ones being declined or scoped down, with the reason, so the decision is on the record rather than looking like an oversight.

| Raised | Decision |
|---|---|
| Full WCAG 2.2 AA acceptance criteria, axe checks, screen reader test matrix | **Scoped down.** This is a single user application with one known user on known browsers. What is kept is the part that would fail *anyone*: a keyboard path for reordering facts and for choosing files, so no function is drag-only, and text labels alongside every status colour. The conformance programme is not proportionate |
| Malware scanning of uploads | **Declined.** You are uploading your own files. Section 8.4 states plainly that files are not scanned, which is more honest than implying a protection that does not exist |
| Consent gate before sending customer names to Microsoft | **Declined.** You are the only user and you made that decision explicitly. A consent dialogue addressed to yourself is theatre. The throttling and resumability concerns from the same finding **are** taken, section 10.1 |
| Monitoring platform, alert routing, on-call ownership | **Scoped down.** No such platform exists here. What is kept: reconciliation and lifecycle RPC results write to the existing `cron_runs` table so repeated failures are visible |
| `EXPLAIN (ANALYZE, BUFFERS)` on production-like volume, response budgets | **Scoped down.** One user with hundreds of rows, not millions. What is kept: indexes carry `user_id` where it is a real predicate, and the timeline is cursor paginated |
| Composite same-owner foreign keys on every table | **Scoped down** to the new customer links, section 5.7. That is where the destructive paths are |
| Splitting Phase 1 into five sub-slices | **Scoped down** to Phase 0 plus the existing commit ordering inside each phase. More slices than that is process for its own sake at this size |
| Keep notes on closed projects, re-parent only on delete (O01) | **Declined.** It contradicts your decision 9, which was explicit. The reviewer's underlying worry was that the move was not reversible, and that is fixed properly by `lifecycle_move_id` in 5.4 and 7.1 rather than by abandoning the feature |
| Require selecting an explicit "create customer" option (O03) | **Declined.** It contradicts your decision 8. The typo risk it worried about is handled by the trigram near-miss hint and the preview, section 9.3 |
| Customer merge workflow (O05) | **Deferred**, not declined. It is genuinely useful once duplicates exist, but nothing needs it on day one and it is a self-contained addition later |
| Audit trail table for destructive actions (O08) | **Deferred.** `lifecycle_move_id` already gives enough to diagnose a bad move. A full events table is worth revisiting if something actually goes wrong |

**The pre-existing reopen bug is now in scope, not deferred.** Revision 5 listed it here as a known limitation. You decided to fix it, so it moved into section 5.9 and Phase 2. Reopening a cancelled project currently restores every cancelled task on it rather than only the ones the close cascade cancelled, verified in `projectLifecycleService.js` where the update filters on `.eq('state', STATE.CANCELLED)` and nothing else.

---

## 20. Nothing open

Every decision is resolved. Section 18 records all twenty.

Two of them went against my recommendation and are built as you asked, not as I suggested:

- **Dropping `stakeholders`.** I argued for keeping the column as a safety copy. You want it gone, so it goes in Phase 4, with the raw data archived to a small table first and the drop gated on every name having been triaged. The archive is one line of SQL and means the decision stays reversible without leaving a confusing column in the schema.
- **Fixing the reopen bug now.** I argued for keeping it separate to avoid widening the change. Folding it in turns out to be cheaper than I assumed: `close_project` and `reopen_project` are being written from scratch in Phase 2 anyway, so stamping the marker is a few lines inside functions that are already being touched. Doing it later would mean editing both twice.

The next artefact is a Phase 0 implementation plan.
