# Diagonal Thinking CRM - Task Board

> Sprint-level view of active and recently completed work. Complements CODEX-BACKLOG.md (which is the full feature history).

---

## In Review / Awaiting Merge

| Ticket | Title | PR | Branch | Notes |
|---|---|---|---|---|
| CRM-012 | Auto-derive Projected Value from Opportunity Records | [#23](https://github.com/philbirchenall-lab/diagonal-thinking-crm/pull/23) | claude/elastic-dijkstra | Depends on CRM-010/011 (feat/sortable-opportunities-headers) merging first |

---

## Blocked / Needs Action

| Ticket | Blocker | Action required |
|---|---|---|
| CRM-010, CRM-011 | feat/sortable-opportunities-headers not yet merged to main | Phil to review and merge PR for opportunities + Sol API branch |
| CA-BUG-002, CA-BUG-003, CA-BUG-005 | client-area Vercel deployment stale | Phil to redeploy client-area from latest main; verify env vars |

---

## Scheduled (post-launch, do not block current launch)

| Ticket | Title | Owner | Due | Notes |
|---|---|---|---|---|
| CRM-DEDUP-V2 | Morada CRM dedup v2: wire full six-gate (LinkedIn URL + phone + name variants + company variants + combinations) per `feedback_crm_duplicate_check_mandatory` | Rex (CRM-write via Sol) | Within 7 days of Form 2 go-live | Phil decision 18:00 BST 2026-06-15 (B4 Option A). v1 ships with email-keyed UPSERT only (spec 1.6 fallback). Dot to pick up at next post-launch morning briefing. |
| MORADA-CODED-PAGES | Migrate Morada booking forms from Squarespace embeds to branded coded pages (Next.js on Vercel, Client-Area pattern) on a subdomain. Backend (Edge Functions) unchanged. | Rex | Post-launch fast-follow | Phil decision ~19:10 BST 2026-06-15: ship v1 on embeds, migrate after launch. Gains: thank-you hosting, Vercel preview URLs, exact brand control, repo-versioned, easier E2E. |
| MORADA-HARDENING-V2 | Lower-severity polish from the pre-review (deferred, non-blocking): durable auto-retry for FreeAgent invoice on failure (currently loud [RECONCILE] log + manual fallback); GA4 server-side purchase for the poll/safety-net path; GA4 purchase cross-device dedup; suppress begin_checkout on idempotent replay; minor a11y (announce char-counter/total changes, move focus on course validation error, honeypot focusable-in-aria-hidden); £ symbol vs "GBP" code (Pix call); Stripe Idempotency-Key header on session create; amount reconciliation Stripe-captured vs invoiced. | Rex | Post-launch | From the 15 Jun pre-review (26 medium/low). None block launch; full list in the workflow output. |

---

## Recently Done (last 5)

| Ticket | Title | PR / Commit |
|---|---|---|
| CRM-012 | CRM-012 - Auto-derive Projected Value from Opportunity Records | PR #23 |
| CRM-010 | Opportunities feature | PR pending (feat/sortable-opportunities-headers) |
| CRM-011 | Sol direct-write API | PR pending (feat/sortable-opportunities-headers) |
| MAIL-003 | SOURCE merge field + segment builder | PR #9 |
| contact-form spam | Three-layer spam protection | PR #13 |
