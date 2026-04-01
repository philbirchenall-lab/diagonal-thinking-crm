# Diagonal Thinking CRM — Codex Backlog

## Status Key
- 🟢 Done
- 🔄 In Progress
- 🔴 Blocked
- ⬜ Not Started

---

## CRM App (diagonal-thinking-crm)

### CRM-001 — Initial CRM build 🟢
Full contact management, pipeline values, Supabase backend.

### CRM-002 — Favicon 🔄
In progress. Favicon asset exists at public/favicon.png.

### CRM-003 — Delete contact + dedup detection 🔄
Complete commit in worktree quirky-meninsky (f23b0c5). Needs merging to main and deploying.

### CRM-004 — Add total_client_value + live_work_value columns 🔄
SQL migration created in this session. Apply via Supabase dashboard if CLI not available.

### CRM-005 — Custom domain ⬜
Host CRM at crm.diagonalthinking.co.
Requires: Vercel custom domain config + DNS CNAME in Squarespace (Phil to do).

---

## Proposals App (dt-proposals)

### PROP-001 — Initial proposals app 🟢
Admin list, editor, client viewer, share URL with code pre-fill.

### PROP-002 — Smart share URL with code pre-fill 🟢

### PROP-003 — Proposals tab in CRM 🟢

### PROP-004 — Fix /admin/proposals/{uuid}/edit 404 ⬜
Route with /edit suffix returns 404. Fix any internal links using /edit variant.

### PROP-005 — Send proposal email to client ⬜
Priority: High

Build a "Send to Client" button in the proposals admin panel (/admin/proposals/{uuid}).

Spec:
- Button label: "Send to Client"
- On click: show a confirmation modal
- Confirmation modal shows: proposal title, client name, client email, share URL
- Two buttons: "Confirm & Send" and "Cancel"
- On confirm: send email via Resend
  - To: client email (from proposal record)
  - BCC: phil@diagonalthinking.co
  - Subject: "Your proposal from Diagonal Thinking — [Proposal Title]"
  - Body: brief professional email with proposal title, client name, share URL as clickable link. Clean Diagonal Thinking style.
- On success: show confirmation toast "Proposal sent to [client email]"
- On failure: show error message
- Store sent_at timestamp and sent_to_email on the proposal record in Supabase when sent
- Admin list shows "Sent" badge on dispatched proposals
- Dependencies: RESEND_API_KEY must be set in Vercel env vars

### PROP-006 — Custom domain ⬜
Host proposals viewer at proposals.diagonalthinking.co.
After domain is live, update all internal viewer URL references from dt-proposals-gilt.vercel.app to proposals.diagonalthinking.co.
Requires: Vercel config + DNS CNAME in Squarespace (Phil to do).

---

## Mailchimp Integration

### MAIL-001 — Sync CRM contacts to Mailchimp audience ⬜
Priority: High

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

### MAIL-002 — Auto-sync on contact save ⬜
Priority: Medium

After MAIL-001 is live, trigger an incremental sync automatically whenever a contact is saved or updated in the CRM, rather than requiring manual sync.

Spec:
- On every contact save (create or update), fire a background call to upsert that single contact in Mailchimp
- Should be non-blocking — CRM save completes immediately, Mailchimp sync happens async
- Failures should be silent to the user but logged to console
- Replaces the need for manual full sync except for initial setup or recovery
