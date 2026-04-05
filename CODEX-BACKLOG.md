# Diagonal Thinking CRM — Codex Backlog

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

### PROP-005 — Send proposal email to client 🔵
Resend integration committed. RESEND_API_KEY added to diagonal-thinking-crm and client-area Vercel projects (2 Apr 2026). **Needs live test:** send a real proposal to confirm Resend is delivering. Note: if dt-proposals is a separate Vercel project, the key may still need adding there too.
Dev: CC-D (local_49a3fda9)

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

---

## Mailchimp Integration

### MAIL-001 — Sync CRM contacts to Mailchimp audience 🟡
Deployed. Commit 213c5c6. Sync is running (346 contacts confirmed in Mailchimp 4 Apr 2026). API keys added to Vercel (ENV-002 resolved).
**Unverified:** CRM_TYPE, NETWORK_PARTNER, SERVICES merge fields not visible in Mailchimp audience CSV — Phil needs to trigger a full sync from the CRM "Sync to Mailchimp" button to create these fields and populate them. Do NOT mark as 🟢 until Phil confirms merge fields are present.
Dev: CC-D (local_911fc8cb)

### MAIL-002 — Auto-sync on contact save 🔵
Deployed (f9d2928). On every contact save, fires a background upsert to /api/mailchimp-sync (single contact, non-blocking). Failures logged to console only. Skips if no email. Build passes.
**Unverified:** Cannot confirm working until MAIL-001 merge fields are visible. Do NOT mark as 🟢 until Phil verifies.
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

### CA-BUG-002 — Client login page copy is unclear 🟢
**Raised:** 3 Apr 2026 | **Fixed:** 4 Apr 2026 | **Priority: Medium**
**Where:** Client Area — login / registration page (`/[slug]` or `/?session=[slug]`)
**Fix:** Heading updated to "Client Portal", subtext added: "Enter your details below to access your session materials, proposals, and resources." Deployed.
Dev: CC-D (local_78d8f7f7)

### CA-BUG-003 — Client-facing form placeholders use personal name 🟢
**Raised:** 3 Apr 2026 | **Fixed:** 4 Apr 2026 | **Priority: Medium**
**Where:** Any client-facing form fields in the Client Area
**Fix:** Placeholders changed from "Phil / Birchenall" to "Jane / Smith". Deployed with CA-BUG-002.
Dev: CC-D (local_78d8f7f7)


### REX-TODO-001 — Investigate easier I&E-to-CRM update flow
**Raised:** 5 Apr 2026 | **Priority: Medium**
**Context:** Sol ran a manual I&E audit catchup on 5 Apr 2026, adding 9 companies/10 contacts missing from CRM. This was done by comparing the I&E Google Sheet against the Supabase contacts table directly via the service role API.
**Question for Rex:** Is there a smarter, less manual way to keep CRM and I&E in sync? Options might include: a script that compares the two data sources and flags mismatches, a CRM UI feature to import from I&E, or a scheduled cross-check. Weekly Monday 1am audit task is now running but the actual catchup is still manual.
**Owner:** Rex
**Status:** Queued — awaiting Rex session
