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

### PROP-005 — Send proposal email to client 🔴
Resend integration committed. Blocked: RESEND_API_KEY not present in dt-proposals Vercel env vars (confirmed 2 Apr 2026). Phil needs to add it in Vercel → Settings → Environment Variables, then redeploy.
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

### MAIL-001 — Sync CRM contacts to Mailchimp audience 🔴
Deployed. Commit 213c5c6. Blocked: MAILCHIMP_API_KEY and MAILCHIMP_AUDIENCE_ID not yet in CRM Vercel env vars (confirmed 2 Apr 2026). Phil needs to add both in Vercel → diagonal-thinking-crm → Settings → Environment Variables, then the "Sync to Mailchimp" button will work.
Dev: CC-D (local_911fc8cb)

### MAIL-002 — Auto-sync on contact save 🔵
Deployed (f9d2928). On every contact save, fires a background upsert to /api/mailchimp-sync (single contact, non-blocking). Failures logged to console only. Skips if no email. Build passes.
**Awaiting:** MAIL-001 activation (needs Mailchimp API keys in Vercel) before this can be fully tested.
Dev: CC-D (local_51144ae2)

---

## Automated Proposal Follow-up

### CRM-006 — Activity log panel in contact detail modal 🔵
Adds a "Activity" section below the Proposals panel in the contact detail sidebar. Shows all contact_activities (email_sent, linkedin_draft, etc.) in reverse-chronological order with type icon, subject, date, and status badge. LinkedIn drafts with status=pending show the message body and a "Mark as sent" button. Proposals panel gains a "Mark as replied" button (shown when views > 0 and reply_received=false).
**Requires:** Run supabase/migrations/20260401000001_contact_activities.sql and 20260401000002_proposals_sent_at.sql in Supabase SQL Editor before testing.
Dev: CC-D (brave-euclid)

### PROP-011 — Nudge email at 4 working days (no opens) 🔵
Cron: api/proposal-followup-cron.js, runs daily at 09:00 UTC. If proposal has 0 views and 4+ working days since sent_at, sends a nudge email via Resend and logs to contact_activities (subtype: nudge_4day). Deduped — only one nudge per proposal.
**Env vars required:** RESEND_API_KEY, SUPABASE_SERVICE_ROLE_KEY (or anon key fallback), CRON_SECRET — all must be added to diagonal-thinking-crm Vercel project settings.
Dev: CC-D (brave-euclid)

### PROP-012 — LinkedIn draft at 7 working days (no opens) 🔵
Same cron as PROP-011. If proposal has 0 views and 7+ working days since sent_at, creates a contact_activity record (type: linkedin_draft, status: pending) with a pre-written LinkedIn message. Phil reviews and sends manually via the CRM Activity panel, then clicks "Mark as sent".
**Env vars required:** Same as PROP-011.
Dev: CC-D (brave-euclid)

### PROP-013 — Chase email at 5 working days post-open 🔵
Same cron as PROP-011. If proposal has views > 0, first_opened_at is known, 5+ working days have passed since first open, and reply_received=false, sends a chase email via Resend and logs to contact_activities (subtype: chase_5day). Phil marks proposal as replied via the CRM Proposals panel when a reply arrives.
**Env vars required:** Same as PROP-011.
Dev: CC-D (brave-euclid)
