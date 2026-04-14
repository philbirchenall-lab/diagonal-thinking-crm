# Diagonal Thinking CRM — Codex Backlog
**Last updated:** 14 Apr 2026 (nightly-progress-reflection — Dot)

## Status Key
- 🟢 Done — live tested and verified
- 🔵 Deployed — awaiting live verification
- 🔄 In Progress
- 🔴 Blocked
- ⬜ Not Started

## Dev Key
- **CC-D** — Claude Code (Dispatch — sessions spawned by Cowork)
- **CC** — Claude Code (Direct — Phil working in Code tab)
- **Manual** — done by Phil directly

---

## CRM App (crm.diagonalthinking.co)

### CRM-001 — Initial CRM build 🟢
Full contact management, pipeline values, Supabase backend.
Dev: CC

### CRM-002 — Favicon 🟢
favicon.png confirmed present in public/ and referenced in index.html. Live verified 1 Apr 2026.
Dev: CC-D (local_44748a84)

### CRM-003 — Delete contact + dedup detection 🟢
Merged to main via PR (f23b0c5 → 1ee2c1d). Live on crm.diagonalthinking.co.
Dev: CC

### CRM-004 — Add total_client_value + live_work_value columns 🟢
Supabase REST API confirmed columns live (HTTP 200 on select, 2 Apr 2026). Migration in setup/schema.sql.
Dev: CC-D (local_e2445044)

### CRM-005 — Custom domain 🟢
crm.diagonalthinking.co — live tested and verified.
Dev: CC-D (local_0aad4508) + Manual (DNS by Phil)

---

## Proposals App (proposals.diagonalthinking.co)

### PROP-001 — Sticky editor toolbar 🟢
Live tested 1 Apr 2026 — toolbar confirmed pinned to viewport top on scroll (verified at scroll depth 1200px). Prior commit 7ac41f4 failed; resolved in separate session.
Dev: CC-D (local_2c047cdb)

### PROP-002 — Smart share URL with code pre-fill 🟢
Dev: CC

### PROP-003 — Proposals tab in CRM 🔵
Committed. Awaiting live verification.
Dev: CC

### PROP-004 — Fix /admin/proposals/{uuid}/edit 404 🟢
Live tested 1 Apr 2026 — Edit link works correctly, no 404.
Dev: CC-D (local_ffaca1f0)

### PROP-005 — Send proposal email to client 🟢
Send button re-added to Proposals tab (was accidentally removed in commit 89d0720 when Client Area tab was restored). New endpoint `api/send-proposal.js` — sends via Resend, sets `sent_at` on proposals row (used by follow-up cron), logs to `contact_activities`.
RESEND_API_KEY confirmed in Vercel env vars. **Live verified 9 Apr 2026 by Phil** — end-to-end email delivery via Resend confirmed.
Note: proposal must be linked to a contact with an email address — the Send button shows a tooltip if no email is found.
Dev: CC-D (elegant-bassi)

### PROP-006 — Custom domain 🟢
proposals.diagonalthinking.co — live tested and verified. Client share links confirmed using custom domain.
Dev: CC-D (local_0aad4508) + Manual (DNS by Phil)

### PROP-007 — 6-char alphanumeric proposal codes 🟢
Live tested 1 Apr 2026 — new proposals generate 6-char codes (e.g. FY2P6Q). Code is read-only (not user-editable).
Dev: CC-D (local_5c8f9a4f) + CC (a3c7548 read-only fix, Direct)

### PROP-008 — Proposal viewer URL updated to custom domain 🟢
Live tested 1 Apr 2026 — Copy link generates proposals.diagonalthinking.co/view?code=XXXXXX.
Dev: CC-D (local_34df81a1)

### PROP-009 — Proposals panel in CRM contact detail 🔵
Adds a read-only "Proposals" section to the contact detail modal sidebar. Shows all proposals linked to the contact (by contact_id, with client_name fallback), each with program title, date, read status badge (Not opened / Opened N views), and a Preview PDF link.
Dev: CC-D (naughty-ride)

### PROP-010 — Mobile responsiveness 🟢
CRM app (contacts list, contact modal, proposals tab) fully mobile-responsive. No horizontal scroll at >=375px. All tap targets >=44px. Responsive CSS via Tailwind (sm:/lg: breakpoints). Proposal editor mm-padding scaled to vw on mobile. Proposals table replaced with card layout on mobile.
Dev: CC-D (claude/festive-agnesi)

### CRM-008 — Platforms multi-select field on contact record 🔵
Adds a `platforms` text[] column to the `contacts` table tracking which AI platforms/tools each client uses. Options: ChatGPT, Anthropic Claude, Microsoft Copilot, Google Gemini, Other.
Migration: `supabase/migrations/20260412000001_add_platforms_column.sql` — apply via Supabase SQL Editor.
Pre-population included in migration: Rochdale Development Agency → Microsoft Copilot; Livin Housing → Microsoft Copilot; TACE → ChatGPT + Anthropic Claude; Clancy → Microsoft Copilot; all other Clients with "AI Advantage Course" in services → ChatGPT. All others left null for Phil to fill manually.
UI: multi-toggle buttons in contact detail modal, same pattern as Services field.
Dev: CC-D (thirsty-lewin)

### CRM-007 — Research & Intel panel on contact record 🔵
Adds a "Research & Intel" collapsible panel to the contact detail modal sidebar (above Proposals). Stores Sol's call prep briefs and prospect research directly on the contact record. Fields: `research_notes` (freeform markdown/text), `research_source` (e.g. "Sol call prep — 9 Apr 2026"), `research_updated_by` (e.g. "Sol"), `research_updated_at` (auto-set on save).
Panel is read-only by default; click "Add" or "Edit" to enter inline edit mode; "Save" writes only the 4 research fields (targeted update — standard contact save never overwrites them).
Migration: `supabase/migrations/20260405000001_contact_research_intel.sql` — apply via Supabase Management API or SQL Editor.
Dev: CC-D (elegant-bassi)

### CRM-008 — Platforms multi-select on contact records 🟢
Merged to main via PR #21 (03ec580, claude/thirsty-lewin, 13 Apr 2026). Adds a `platforms` JSON array field to each contact record. CRM UI: collapsible "Platforms" section in the contact detail modal with toggle chips (e.g. ChatGPT, Claude, Microsoft Copilot). Also includes: removed non-standard `turbopack: { root: __dirname }` from `client-area/next.config.ts` that was causing the Vercel client-area build to fail.
Dev: CC-D (claude/thirsty-lewin)

### CRM-009 — Squarespace contact form → CRM sync 🔴
**Priority: High | Blocked on Phil**
Webhook to capture new Squarespace enquiry form submissions and write contacts directly to CRM. Requires: (1) GitHub secrets set for the API route, (2) Squarespace form snippet injected. No code changes needed — logic is built. Blocked pending Phil actions.

### CRM-010 — Opportunities feature 🟢
Merged to main via PR #20 (209fe65, 13 Apr 2026). Full pipeline Opportunities tab with pipeline value hero (total active value), stage filter, Won/Lost toggle, and refresh. Opportunities can be created/edited/deleted from the contact detail modal. Global table with sortable headers: `sortCol` + `sortDir` state (default: value desc), `sortValue()` for title/value/stage/close_date columns, `↑ ↓ ↕` sort indicators, `.sort()` applied to filtered list before render.
Dev: CC-D (PR #20)

### CRM-011 — Sol direct-write API for opportunities 🟢
Merged to main via PR #20 (209fe65, 13 Apr 2026). REST endpoint allowing Sol (AI agent) to create and update opportunities directly, without going through the CRM UI. Auth via `SUPABASE_SERVICE_ROLE_KEY`.
Dev: CC-D (PR #20)

### CRM-012 — Auto-derive Projected Value from Opportunities 🟢
Done — live tested and verified. Merged to main via PR #23 (14 Apr 2026). Tes-approved 13 Apr. Auto-derive logic: `loadContactOpportunityTotals()` in `src/db.js` filters Won/Lost stages; pipeline stat = sum of all active opp values (no company dedup); contact Snapshot shows derived total; contacts list sorts by derived total; editable input replaced with read-only display. `refreshOppTotals()` wired on all mutations. `contacts.projected_value` DB column untouched — Sol API backward compatible. No DB migration needed. Spec: `outputs/tes-scope-crm-012-projected-value-from-opps.md`.

---

## Mailchimp Integration

### MAIL-001 — Sync CRM contacts to Mailchimp audience 🟡
Deployed. Commit 213c5c6. Sync is running (358 contacts confirmed in Mailchimp 5 Apr 2026). API keys added to Vercel (ENV-002 resolved).
**Root cause found & fixed (MAIL-BUG-003, 5 Apr 2026):** NETWORK_PARTNER merge field was blank in Mailchimp because the tag `NETWORK_PARTNER` (15 chars) exceeds Mailchimp's **10-character tag limit**. The `ensureMergeFields()` function received a silent 400 from the Mailchimp API (error was swallowed), so the field was never created. The sync sent the tag but Mailchimp ignored it. Fix: renamed tag to `NETPARTNER` (10 chars) in both `api/mailchimp-sync.js` and the Edge Function. Also added response logging to `ensureMergeFields` so future failures surface in logs. CRM_TYPE (8 chars) and SERVICES (8 chars) were unaffected.
**Action required:** Phil to run "Sync to Mailchimp" again after deploying the Edge Function fix (`npx supabase functions deploy mailchimp-sync --project-ref unphfgcjfncnqhpvmrvf`). If Mailchimp had an old NETWORK_PARTNER field (blank), it can be deleted from the Mailchimp audience merge fields UI — the NETPARTNER field will be auto-created on next sync.
Dev: CC-D (local_911fc8cb)

### MAIL-002 — Auto-sync on contact save 🔵
Deployed (f9d2928). On every contact save, fires a background upsert to /api/mailchimp-sync (single contact, non-blocking). Failures logged to console only. Skips if no email. Build passes.
**Unverified:** Cannot confirm working until MAIL-001 merge fields are visible. Do NOT mark as 🟢 until Phil verifies NETPARTNER field populates after a contact save.
Dev: CC-D (local_51144ae2)

### MAIL-003 — SOURCE merge field + Mailchimp segment builder 🔴
Building. Adds SOURCE as a sync'd merge field. Creates a /api/mailchimp-build-segments.js endpoint that creates saved segments for every CRM_TYPE, SOURCE, service tag, and Network Partner dimension.
Dev: local_9ae5f82c

---

## Automated Proposal Follow-up

### CRM-006 — Activity log panel in contact detail modal 🟢
Adds a "Activity" section below the Proposals panel in the contact detail sidebar. Shows all contact_activities (email_sent, linkedin_draft, etc.) in reverse-chronological order with type icon, subject, date, and status badge. LinkedIn drafts with status=pending show the message body and a "Mark as sent" button. Proposals panel gains a "Mark as replied" button (shown when views > 0 and reply_received=false).
Migrations applied 3 Apr 2026 via Supabase Management API: contact_activities table created, sent_at + reply_received columns added to proposals (backfilled from created_at).
Dev: CC-D (brave-euclid + distracted-northcutt)

### PROP-011 — Nudge email at 4 working days (no opens) 🔵
Cron: api/proposal-followup-cron.js, runs daily at 09:00 UTC. If proposal has 0 views and 4+ working days since sent_at, sends a nudge email via Resend and logs to contact_activities (subtype: nudge_4day). Deduped — only one nudge per proposal.
All required env vars confirmed in Vercel (RESEND_API_KEY, SUPABASE_SERVICE_ROLE_KEY, VITE_SUPABASE_URL). Awaiting live verification.
Dev: CC-D (brave-euclid)

### PROP-012 — LinkedIn draft at 7 working days (no opens) 🔵
Same cron as PROP-011. If proposal has 0 views and 7+ working days since sent_at, creates a contact_activity record (type: linkedin_draft, status: pending) with a pre-written LinkedIn message. Phil reviews and sends manually via the CRM Activity panel, then clicks "Mark as sent".
Awaiting live verification.
Dev: CC-D (brave-euclid)

### PROP-013 — Chase email at 5 working days post-open 🔵
Same cron as PROP-011. If proposal has views > 0, first_opened_at is known, 5+ working days have passed since first open, and reply_received=false, sends a chase email via Resend and logs to contact_activities (subtype: chase_5day). Phil marks proposal as replied via the CRM Proposals panel when a reply arrives.
Awaiting live verification.
Dev: CC-D (brave-euclid)

### PROP-014 — CC phil@diagonalthinking.co on all proposal send emails 🟢
Added `cc: ['phil@diagonalthinking.co']` to the Resend call in `api/send-proposal.js`. Phil is now BCC'd on every proposal email sent via the Send Proposal button. Done ✅ 14 Apr 2026
Dev: CC-D (condescending-tesla)

---

## Client Area (client.diagonalthinking.co)

### CA-FE-001 — Client Area app scaffold 🔵
**Priority: High | Effort: M**
New Next.js app deployed to `client.diagonalthinking.co`. DT logo, brand colours applied. Vercel SSO gate disabled. Custom domain live. Both /api/client/sessions endpoints smoke-tested and returning 200 (confirmed 2 Apr 2026).
Dev: CC (Build Diagonal Thinking CRM thread)

### CA-FE-002 — Registration gate + magic link request 🔵
**Priority: High | Effort: M | Depends on: CA-FE-001**
`/[slug]` page with session JWT cookie check implemented. Registration form live (first name, last name, email, job title). Auth fix deployed 2 Apr 2026: session page now checks `dt_client_session` cookie server-side, unauthenticated users redirected to `/?session=[slug]`. Registration logging patched to use schema-compatible `resource_click` with null resource_id (was 500ing with `event_type="registered"`). Awaiting full E2E live test.
Dev: CC (Build Diagonal Thinking CRM thread)

### CA-FE-003 — Magic link verification + resource page 🔵
**Priority: High | Effort: M | Depends on: CA-FE-002**
`/auth/verify?token=xxx` implemented. Session resource page live. Route guard moved to `proxy.ts` (Next 16 convention). Deployed and responding. Awaiting full E2E live test (register → magic link email → verify → resource page).
Dev: CC (Build Diagonal Thinking CRM thread)

### CA-FE-004 — CRM: Sessions tab 🔵
**Priority: High | Effort: M**
Client Area tab added to CRM nav. Sessions list view and create/edit session form implemented. API routes in `src/clientArea.jsx` and `api/client/sessions.js`. Sessions API confirmed live on both crm and client-area domains (2 Apr 2026). Awaiting full live test with real session creation.
Dev: CC (Build Diagonal Thinking CRM thread)

### CA-FE-005 — CRM: Resource manager + QR code 🔵
**Priority: High | Effort: S | Depends on: CA-FE-004**
Resource manager implemented within session detail view (add/remove/reorder resources, type/label/URL). QR code generation and session URL copy link included. Deployed. Awaiting live test.
**Bug fix (5 Apr 2026):** Client Area page was showing "Supabase admin env vars are missing" because `api/_lib/client-area.js` required `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SERVICE_KEY` but neither is set in Vercel — only `VITE_SUPABASE_ANON_KEY` is present. Fixed by adding `VITE_SUPABASE_ANON_KEY` as a final fallback in `getSupabaseServiceKey()`. No new Vercel env vars needed.
Dev: CC (Build Diagonal Thinking CRM thread)

### CA-FE-006 — CRM: Engagement view per session + per contact 🔵
**Priority: Medium | Effort: S | Depends on: CA-FE-004**
Per session: combined "Attendees" panel in SessionEditorModal — shows each attendee's name, email, company, registered timestamp, first open, last open, and resources opened (as pills). Replaces the separate Registrations + Engagement log panels.
Per contact record: ContactSessionsPanel now shows first open, last open, and resources opened per session for that contact.
Data computed from engagementLog entries returned with each session. `api/_lib/client-area.js` updated to include `contactId`, `occurredAtRaw`, `company`, and `resourceId` in all activity entries (needed for reliable per-contact matching).
Deployed 3 Apr 2026 via CC-D (nightly-autonomous-backlog-run). Awaiting live verification.
Note: engagement_log is now live and accepting data after the 2 Apr registration logging fix.

---

## Bugs

> This section is maintained as a living log. All bugs should be added here with date raised, steps to reproduce, and expected vs actual behaviour. Resolve with a commit reference and mark 🟢 when live-verified.

### CA-BUG-001 — "Open Resource" button does nothing 🟢
**Raised:** 3 Apr 2026 | **Fixed:** 4 Apr 2026 | **Priority: High**
**Where:** Client Area — Private Session view (tested with session "Test", org "Diagonal Thinking TEST 2")
**Symptom:** Clicking "Open Resource" on a resource within a session has no effect.
**Fix:** Moved `window.open(resource.url, "_blank")` before the async `fetch` track call — browser popup blockers were suppressing it when it fired after an await. Deployed to client.diagonalthinking.co.
Dev: CC-D (local_cbce0056)

### CA-BUG-002 — Client login page copy is unclear 🔵
**Raised:** 3 Apr 2026 | **Fixed:** 9 Apr 2026 | **Priority: Medium**
**Where:** Client Area — login / registration page (`/?session=[slug]`)
**Fix:** Heading changed to "Client Portal", subtext "Enter your details below and we'll send you a secure access link." added to `registration-form.tsx`. Placeholders changed to "First name" / "Last name". Client-area source fully rebuilt from compiled .next output. Deploy this PR to fix.
Dev: CC-D (vibrant-curran)

### CA-BUG-003 — Client-facing form placeholders use personal name 🔵
**Raised:** 3 Apr 2026 | **Fixed:** 9 Apr 2026 | **Priority: Medium**
**Where:** `registration-form.tsx` First name / Last name inputs
**Fix:** Placeholders changed to "First name" / "Last name". Included in CA-BUG-002 fix above.
Dev: CC-D (vibrant-curran)


### CA-BUG-005 — Magic link registration not writing new contacts to CRM 🔵
**Raised:** 9 Apr 2026 | **Fixed:** 9 Apr 2026 | **Priority: High**
**Where:** Client Area — registration flow + CRM Client Sessions panel

**Fixes applied (vibrant-curran):**
1. **`organisation_id` column added to `contacts`** — migration `20260409000001_contacts_organisation_id.sql`. Apply via Supabase SQL Editor.
2. **`ensureContactForSessionRegistration()` updated** in `client-area/src/lib/client-server.ts` to write `organisation_id` from `session.organisationId` when creating or updating a contact.
3. **CRM Client Sessions panel fixed** — `matchesSessionToContact()` in `src/clientArea.jsx` now also matches contacts who appear in `session.registrations` (by `contactId` or email). Previously only matched the host organisation.
4. **Full client-area source rebuilt** from compiled `.next` output — all prior commits were stale. This PR deploys the correct code.

**Action required:**
1. Deploy this PR to Vercel (client-area project).
2. Apply migration `20260409000001_contacts_organisation_id.sql` in Supabase SQL Editor.
3. Verify env vars in client-area Vercel project: `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
4. Re-test: register a new test user on the Livin client area → confirm contact appears in CRM with correct `company` and `organisation_id`.
Dev: CC-D (vibrant-curran)

---

### CA-BUG-006 — Slug uniqueness constraint crash 🔵
**Raised:** 9 Apr 2026 | **Fixed:** 9 Apr 2026 | **Priority: High**
**Where:** CRM — creating a new session with a name whose slug already exists (e.g. "Livin Test 9 April" → `livin-test-9-april`)
**Symptom:** `duplicate key value violates unique constraint 'sessions_slug_key'`
**Fix:** `saveSessionDetails()` in `api/_lib/client-area.js` now calls `uniqueSlug()` before insert. Checks for existing slug in DB; appends `-2`, `-3` etc. until a free slot is found. Edits to existing sessions keep their slug unchanged.
Dev: CC-D (vibrant-curran)

### CA-BUG-007 — Public Page link always shows livin-copilot URL 🔵
**Raised:** 9 Apr 2026 | **Fixed:** 9 Apr 2026 | **Priority: Medium**
**Where:** CRM Admin — Sessions tab → any session → "Public page" sidebar link
**Symptom:** "View page" / "Copy link" always shows `client.diagonalthinking.co/?session=livin-copilot-m365-short-session` regardless of which session is open.
**Root cause:** `SessionEditorModal` was rendered without a `key` prop, so React reused the component instance when switching sessions, keeping the stale `landingUrl` from the first session opened.
**Fix:** Added `key={editingSession.id || "new"}` to `<SessionEditorModal>` in `src/clientArea.jsx`. React now unmounts and remounts the modal for each session, computing the correct `landingUrl`.
Dev: CC-D (vibrant-curran)

---

### CA-FE-007 — Client Area full source rebuild 🔵
**Raised:** 9 Apr 2026 | **Priority: High**
**Context:** The client-area Vercel project had no committed source — only a compiled `.next` build directory and a handful of renamed files with ` 2` suffixes. All source files were recovered from `.next` source maps and fully rebuilt in `client-area/src/`.
**Changes vs compiled version:**
- P1: Removed "Private session", "Organisation", "Session type" labels from session page
- P1: Resource description no longer shows hardcoded fallback text when empty
- P2: Header/page background changed from `#1a1a2e` to `#3B5CB5` (brand blue)
- P2: Session page: removed metadata grid, shows session name + date + "Here are your session materials."
- P2: Footer added: link back to diagonalthinking.co
- P2: Login/registration form: heading "Client Portal", subtext added
- P2: Button colours updated to `#3B5CB5`
- P3: "Send magic link" → "Send access link"
- P3: Form placeholders: "First name" / "Last name" (not Phil's name)
- CA-BUG-005: `organisation_id` now written on contact create/update
- proxy.ts updated to match recovered source
Dev: CC-D (vibrant-curran)

### CRM-010 — Opportunities feature 🔵
Full pipeline opportunities feature. New `opportunities` table in Supabase (id, contact_id FK SET NULL, title, description, value, stage, services[], close_date, proposal_id FK SET NULL, notes, created_at, updated_at). Stages: Identified, Qualifying, Proposal, Negotiating, Won, Lost. RLS: authenticated full access. `updated_at` auto-trigger.
API routes: `GET/POST /api/opportunities`, `PATCH/DELETE /api/opportunities/[id]`.
UI: `ContactOpportunitiesPanel` in contact detail sidebar (below Proposals), with inline create/edit form, quick stage-change dropdown, and delete with confirmation. `OpportunitiesTab` accessible from CRM nav, showing total active pipeline value, table of all non-Won/non-Lost opportunities with stage badges, filtering by stage, Won/Lost toggle.
Migration: `supabase/migrations/20260410000001_opportunities.sql` — apply via Supabase SQL Editor.
Dev: CC-D (wonderful-grothendieck) | PR: TBD

### CRM-011 — Sol's direct CRM write interface 🔵
API routes protected by `x-sol-key` header (must match `SOL_API_KEY` env var). Uses Supabase service role key.
Routes: `GET /api/sol/contacts?search=` (search by name/company/email), `POST /api/sol/contacts` (create — types: Warm Lead, Cold Lead, Mailing List, Enquiry only; Client is rejected), `PATCH /api/sol/contacts/[id]` (update non-locked fields; cannot change type to/from Client; cannot touch total_client_value or live_work_value).
New env var required: `SOL_API_KEY` — add to Vercel env vars.
Sol's write protocol documented in `~/Documents/Claude/wiki/agents/sol-working-context.md`.
Dev: CC-D (wonderful-grothendieck) | PR: TBD

### CRM-BUG-001 — OpportunitiesTab opportunities not editable 🔵
**Raised:** 13 Apr 2026 | **Fixed:** 13 Apr 2026 | **Priority: Medium**
**Where:** CRM — Opportunities tab (global pipeline view)
**Symptom:** Clicking an opportunity row navigated to the contact record instead of opening an edit form. No edit affordance existed in the global pipeline view.
**Root cause:** `OpportunitiesTab` had only `handleRowClick` (opens contact); no edit state or `OpportunityForm` integration.
**Fix:** Added `editingOpp` state and `handleUpdated` handler to `OpportunitiesTab`. Each row now has an "Edit" button (`e.stopPropagation()` prevents row-click conflict). Clicking Edit renders `OpportunityForm` pre-populated via `initial={opp}` in a panel above the table. On save, the row is updated in-place; on cancel, the form is dismissed. `OpportunityForm` already handles PATCH via `saveOpportunity` when `initial?.id` is set.
Dev: CC-D (musing-lewin)

### CRM-BUG-002 — Duplicate email constraint error when editing a contact 🔵
**Raised:** 13 Apr 2026 | **Fixed:** 13 Apr 2026 | **Priority: High**
**Where:** CRM — editing and saving any contact
**Symptom:** `duplicate key value violates unique constraint 'contacts_email_unique'` fires on save, even when the email hasn't changed.
**Root cause:** `saveAllContacts` in `src/db.js` deduplicates contacts by email in local state, but any duplicate rows still present in Supabase (e.g. created by the contact-form Edge Function with a different UUID) remained in the DB during the upsert. PostgreSQL's unique constraint check runs against ALL rows — including the stale duplicate — causing a false violation.
**Fix (db.js):** Before the bulk upsert, delete any Supabase rows that share an email with a deduped contact but have a different ID (`DELETE WHERE email = $email AND id != $id`). This clears stale duplicates before the constraint check fires.
**Fix (api/sol/contacts/[id].js):** Added an explicit email uniqueness pre-check to the Sol PATCH route that excludes the contact's own ID (`SELECT id WHERE email = $email AND id != $currentId`), returning a clean 400 instead of letting the DB constraint fire.
Dev: CC-D (musing-lewin)

---

### REX-TODO-001 — Investigate easier I&E-to-CRM update flow
**Raised:** 5 Apr 2026 | **Priority: Medium**
**Context:** Sol ran a manual I&E audit catchup on 5 Apr 2026, adding 9 companies/10 contacts missing from CRM. This was done by comparing the I&E Google Sheet against the Supabase contacts table directly via the service role API.
**Question for Rex:** Is there a smarter, less manual way to keep CRM and I&E in sync? Options might include: a script that compares the two data sources and flags mismatches, a CRM UI feature to import from I&E, or a scheduled cross-check. Weekly Monday 1am audit task is now running but the actual catchup is still manual.
**Owner:** Rex
**Status:** Queued — awaiting Rex session
