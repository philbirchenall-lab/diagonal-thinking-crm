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

### CRM-004 — Add total_client_value + live_work_value columns 🔵
SQL migration committed. Awaiting verification that columns are live in Supabase.
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
Resend integration committed. Awaiting live verification (requires RESEND_API_KEY in Vercel env vars).
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

### MAIL-001 — Sync CRM contacts to Mailchimp audience 🔵
Priority: High
Dev: CC-D (local_911fc8cb — in progress)

Sync contacts from the Diagonal Thinking CRM into a Mailchimp audience so that email campaigns can be run directly from Mailchimp against the CRM contact list.

Spec:
- Add a "Sync to Mailchimp" button in the CRM contacts view (top toolbar)
- On click: show a progress indicator and sync all contacts to the configured Mailchimp audience
- Fields to sync:
  - Email address (required — skip contact if missing)
  - First name / Last name (from full name field)
  - Company (COMPANY merge field)
  - Pipeline stage (PIPELINE merge field)
  - Service tags (SERVICES merge field, comma-separated)
- Sync behaviour:
  - Add new contacts that don't exist in Mailchimp
  - Update existing contacts (matched by email) with latest CRM data
  - Do NOT unsubscribe or delete contacts from Mailchimp if removed from CRM
  - Respect existing Mailchimp unsubscribe status — never re-subscribe an unsubscribed contact
- On completion: show toast with count of added / updated / skipped
- Store last_synced_at on each contact record in Supabase
- Dependencies: MAILCHIMP_API_KEY and MAILCHIMP_AUDIENCE_ID must be set in Vercel env vars
- Use Mailchimp Marketing API v3 (batch upsert endpoint for efficiency)

### MAIL-002 — Auto-sync on contact save 🔵
Priority: Medium

After MAIL-001 is live, trigger an incremental sync automatically whenever a contact is saved or updated in the CRM, rather than requiring manual sync.

Spec:
- On every contact save (create or update), fire a background call to upsert that single contact in Mailchimp
- Should be non-blocking — CRM save completes immediately, Mailchimp sync happens async
- Failures should be silent to the user but logged to console
- Replaces the need for manual full sync except for initial setup or recovery
