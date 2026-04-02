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

## Client Area Backend (API)

### CA-001 — Sessions table + API ⬜
Priority: High | Effort: M

### CA-002 — Magic link generation + email ⬜
Priority: High | Effort: M

### CA-003 — Engagement log ⬜
Priority: High | Effort: S

---

## Client Area Frontend (client.diagonalthinking.co)

### CA-FE-001 — Client Area app scaffold ⬜
Priority: High | Effort: M

Build a new Next.js app (or route group) deployed to `client.diagonalthinking.co`. Must match the Diagonal Thinking brand exactly: logo, fonts, colours from the main site. No third-party branding visible to end users at any point. This is the shell that all other CA-FE tickets build on. Deploy to Vercel as a new project.

### CA-FE-002 — Registration gate + magic link request ⬜
Priority: High | Effort: M
Depends on: CA-FE-001, CA-001, CA-002, CA-003

`/[slug]` page. Checks for a valid session JWT cookie. If no valid JWT: show a branded registration form (first name, last name, email, company, GDPR consent checkbox — "I agree to Diagonal Thinking storing my details so Phil can follow up with resources and relevant updates. You can unsubscribe at any time."). On submit: calls POST /api/client/register, then shows a "Check your email" confirmation screen. Returning users (already registered from any previous session) see email-only form. Form must not submit without GDPR consent checked.

### CA-FE-003 — Magic link verification + resource page ⬜
Priority: High | Effort: M
Depends on: CA-FE-002

`/auth/verify?token=xxx` — calls GET /api/client/auth/verify, receives JWT, sets secure cookie, redirects to `/[slug]`. Resource page (shown after auth): session name and description, list of resources (links open in new tab, file downloads triggered, embeds rendered inline). Each resource click fires a POST /api/client/track event. Clean, readable layout — no navigation chrome, just the resources.

### CA-FE-004 — CRM: Sessions tab ⬜
Priority: High | Effort: M
Depends on: CA-001

New Sessions tab in the CRM (alongside Contacts, Companies, Proposals). Lists all sessions in a table: name, slug, linked organisation, date, status (active/inactive toggle), attendee count. "New session" button opens a creation form: name, slug (auto-generated from name, editable), linked Organisation (searchable dropdown), date, status toggle. Save creates the session via Supabase. Clicking a row opens the session detail view.

### CA-FE-005 — CRM: Resource manager + QR code ⬜
Priority: High | Effort: S
Depends on: CA-FE-004

Within session detail view: resource manager UI to add/remove/reorder resources. Each resource has: type (link / file / embed), label, URL. Drag to reorder (sort_order). "Generate QR code" button — calls GET /api/admin/sessions/:id/qr, downloads PNG. Shows the live session URL (`client.diagonalthinking.co/:slug`) as a copyable link.

### CA-FE-006 — CRM: Engagement view per session + per contact ⬜
Priority: Medium | Effort: S
Depends on: CA-FE-004, CA-003

Per session detail view: table of contacts who registered, showing name, email, company, first access, last access, resources clicked (count + list on hover/expand). Per contact record (in the existing Contacts tab): new section "Sessions attended" showing session name, date, first/last access. All data from the engagement_log and magic_links tables.
