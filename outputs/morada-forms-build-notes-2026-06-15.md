# Morada / Steve "AI for Contractors" launch forms: build notes

**Built by:** Rex, 15 Jun 2026
**Branch:** `rex/morada-forms-12-2026-06-15`
**Spec:** `outputs/tes-spec-morada-forms-1-and-2-2026-06-15.md`
**Form 2 payment architecture:** direct Stripe Checkout (Phil B3 decision, 18:32 BST 2026-06-15), reversing the earlier FreeAgent-hosted-payment approach.

This file records the architecture decisions, deploy steps, the Form 2 acceptance
criteria, and the Phil-actions still outstanding before launch.

## Files in this build

| File | What it is |
| --- | --- |
| `supabase/functions/_shared/forms.ts` | Shared module: CORS allowlist, spam layers, CRM write, Mailchimp, Resend, .ics, UTM, FreeAgent API, Stripe Checkout, course-payment fulfilment, GA4 MP. |
| `supabase/functions/morada-webinar-register/index.ts` | Form 1 edge function (free webinar). |
| `supabase/functions/morada-course-book/index.ts` | Form 2: creates the Stripe Checkout session, returns its URL. |
| `supabase/functions/morada-course-thank-you/index.ts` | Form 2: verifies the Stripe session on return, fulfils (Client + FreeAgent invoice + email). |
| `supabase/functions/morada-course-poll-paid/index.ts` | Form 2 safety-net poll: fulfils paid sessions where the customer never returned. |
| `.../form-1-webinar/morada-webinar-embed-v1-2026-06-15.html` | Form 1 Squarespace Code Block embed. |
| `.../form-2-course/morada-course-embed-v1-2026-06-15.html` | Form 2 booking embed (redirects to Stripe). |
| `.../form-2-course/morada-thank-you-embed-v1-2026-06-15.html` | Form 2 thank-you page embed (verify + GA4 purchase). |

(Embeds live under `outputs/rex-morada-forms-built-2026-06-15/`.)

## Infrastructure decisions

### Decision 1: canonical backend = Supabase Edge Functions
The live DT marketing forms (`contact-form`, `register-interest`) are Supabase
Edge Functions posted to from Squarespace. The repo's `/api` Vercel routes serve
the CRM app, not public site forms. So both new forms are Edge Functions reusing
the shared module. (Spec 1.1.)

### Decision 2: CRM write = email-keyed upsert; six-gate deferred to v2
The six-gate dedup and Gmail-scrape gate do **not exist anywhere in the repo**.
v1 uses email-keyed `contacts` UPSERT (this is the dedup) plus a
`contact_activities` row; opp `229660dd` move deferred to manual reconciliation.
Ratified by Phil 18:00 BST (B4 Option A); full six-gate logged as a post-launch
P1 on `TASK-BOARD.md` (CRM-DEDUP-V2). (Spec 1.6.)

### Decision 3 (Form 2): direct Stripe Checkout + verified thank-you (B3)
Phil 18:32 BST: **we** create the Stripe Checkout session (so we own the
`success_url`) and the flow is:

1. `morada-course-book`: validate -> (6+ seats = enquiry) -> create a Stripe
   Checkout session (`success_url` = `/morada-thank-you?session_id={CHECKOUT_SESSION_ID}`,
   `cancel_url` = course page) with all booking details in metadata. Upsert the
   contact (Warm Lead) + a PENDING `course_checkout_started` activity keyed on the
   session id. Return the Checkout URL. The embed fires GA4 `begin_checkout` and
   redirects.
2. Customer pays on Stripe, returns to `/morada-thank-you?session_id=...`.
3. `morada-course-thank-you`: **verifies the session via the Stripe API** (with
   retry/backoff for the redirect race) - the return URL is client-side, so we
   never trust it without verifying. On verified-paid it runs the shared
   `fulfillCoursePayment`: upsert contact -> Client, record the FreeAgent invoice
   (VAT/books, best-effort), apply the paid Mailchimp tag, send the "payment
   received, Phil will be in touch" email, write the paid activity (idempotent on
   session id). Returns `confirmed`; the page fires GA4 `purchase` (deduped).
   If not yet paid after retries, returns `processing` (page shows "payment
   processing, you'll hear from Phil soon").
4. `morada-course-poll-paid`: safety net for customers who paid but never landed
   on the thank-you page. Re-checks pending sessions via Stripe and runs the same
   idempotent `fulfillCoursePayment`.

**Why not FreeAgent-hosted payment (the prior approach):** FreeAgent owns the
redirect on its hosted pay page (no custom return URL) and exposes no early
payment signal (a live £1.20 test still read "unpaid" via its API for days). So
an instant, verified thank-you can only be done by owning the Stripe Checkout.
FreeAgent is retained only to create the VAT invoice after payment. NB: FreeAgent
has no API "mark Paid" transition - the invoice reconciles when the Stripe payout
lands in the connected bank feed, or Phil marks it paid; the invoice exists
immediately as a proper VAT record.

## Deploy steps

1. **Provision** `STRIPE_SECRET_KEY` (Stripe Dashboard -> Developers -> API keys;
   `sk_test_...` to wire/test, `sk_live_...` for launch) as a Supabase Edge
   Function secret. Set `MORADA_POLL_SECRET` (any random string).
2. **Deploy the functions** (public; the poll self-guards on its secret):
   ```
   supabase functions deploy morada-webinar-register --no-verify-jwt
   supabase functions deploy morada-course-book --no-verify-jwt
   supabase functions deploy morada-course-thank-you --no-verify-jwt
   supabase functions deploy morada-course-poll-paid --no-verify-jwt
   ```
3. **Create the Squarespace pages** and paste the embeds:
   `/morada-ai-webinar` (Form 1), `/ai-for-contractors-course` (Form 2 booking),
   `/morada-thank-you` (Form 2 thank-you). The thank-you slug must match the
   Stripe `success_url` (override via `MORADA_THANKYOU_URL` if you use a different
   slug). CONFIG blocks are pre-filled (FUNCTION_URL, PRIVACY_URL, BOOKING_TERMS_URL).
4. **Schedule the poll** every 15-30 minutes (safety net; idempotent).
5. **Smoke-test** with a real card (or Stripe test card on the test key): book ->
   pay -> land on thank-you -> see "Booking confirmed", the confirmation email
   arrives, the CRM contact flips to Client, and a FreeAgent invoice is recorded.

## Environment variables

Already provisioned: `MAILCHIMP_API_KEY`, `RESEND_API_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`, and the FreeAgent OAuth trio
(`FREEAGENT_CLIENT_ID` / `FREEAGENT_CLIENT_SECRET` / `FREEAGENT_REFRESH_TOKEN`,
verified live 15 Jun 2026), and `MORADA_POLL_SECRET`.

Needed before Form 2 launch:

| Var | Used by | Without it |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | book + thank-you + poll | Booking returns 503; thank-you returns "processing". Build is inert until set. |
| `MORADA_TEST_MODE` | all (via fulfilment) | `true` short-circuits FreeAgent invoice + confirmation email + Mailchimp to logged no-ops (CRM/activity writes + all security checks still run). Safe verification window + post-launch kill-switch. Default `false`. Set `true` for Tes's probes, flip `false` for production. |
| `MORADA_THANKYOU_URL` | book | Optional; defaults to `https://www.diagonalthinking.co/morada-thank-you`. Set if the slug differs. |
| `MORADA_COURSE_PAGE_URL` | book | Optional; defaults to the course slug (used as Stripe `cancel_url`). |
| `GA4_MEASUREMENT_ID` + `GA4_API_SECRET` | poll | Optional; server-side `purchase` fallback for the poll path only (the thank-you page fires `purchase` client-side). |
| `MORADA_WEBINAR_JOIN_URL` | Form 1 | Optional; webinar confirmation says "join link to follow" (Phil's choice). |

## Security / hardening (P0 sign-off gate, Phil 19:02 BST)

The invariant: **a malicious actor cannot trigger an invoice.** Invoices are only
created in `fulfillCoursePayment`, called only by thank-you/poll AFTER the Stripe
session is verified `paid` against Stripe's API. `book` never touches FreeAgent.

| # | Control | Where | Live probe result |
| --- | --- | --- | --- |
| 1 | Server-side Origin + Referer allowlist (not just CORS); missing Origin or disagreeing Referer rejected | book, webinar, thank-you | evil origin / no origin / referer-mismatch all -> 403 |
| 2 | Persistent Postgres rate limit, 3/10min, survives cold start, in-memory fallback | all form fns (`morada_rate_limit`) | 4th rapid submit -> 429 |
| 3 | Honeypot (`website` + `_gotcha`) + min 2s fill-time -> SILENT drop | book, webinar | filled honeypot / 300ms -> 200 no-op, no session |
| 4 | Strict validation: RFC-5322 email + disposable denylist; Unicode-letter name/company classes blocking URLs/HTML/quotes; seats 1-5 server-side | shared `validateCommon`, book | disposable -> 400; name URL -> 400; seats:999 -> enquiry (no payment) |
| 5 | Idempotency: client UUID per submit, unique index on `contact_activities`; replay returns same session | book (`idempotency_key`) | same key replay -> identical `cs_...` session |
| 6 | No Stripe webhook (pull model): thank-you/poll query the Stripe API to confirm `paid`, so a forged request cannot fake a paid state. **Stripe-Signature verification is N/A - there is no inbound webhook.** | thank-you, poll | forged session id -> `processing`, fulfils nothing |
| 7 | Form 1 / Form 2 isolation: separate functions, schemas, rate-limit buckets (`webinar:` vs `book:`); Form 1 never reads `seats` | both | n/a (structural) |
| 8 | FreeAgent invoice only after verified Stripe payment; no raw-form path to it | shared/forms.ts | full probe storm created ZERO FreeAgent invoices |

NB for reviewers: item 6's "webhook signature failure modes" do not apply - this
build uses **pull verification**, not push webhooks. The equivalent control is
the live Stripe API check in thank-you/poll (probe: forged session -> processing).

NB item 4: the company character class is broader than name (allows `. , & ( ) /`)
so real B2B names like "Smith & Co." are not rejected, while still blocking
URLs/HTML/quotes. Flagged as a deliberate deviation from "same class".

## Form 2 acceptance criteria (B3 / direct Stripe Checkout)

Verify on staging/preview before opening to traffic:

1. Totals compute: 1 seat 360, 2-5 per-seat, 6+ routes to enquiry (no payment).
2. Valid 1-5 seat submit creates a Stripe Checkout session and the embed fires
   GA4 `begin_checkout` then redirects to Stripe.
3. A PENDING `course_checkout_started` activity is written, keyed on the session id.
4. On paid return to `/morada-thank-you`, the thank-you function verifies the
   session via Stripe, shows "Booking confirmed", and fires GA4 `purchase`
   (deduped on session id across refresh).
5. Fulfilment: contact upgraded to `Client`; FreeAgent invoice recorded (net
   300/seat, 20% VAT) for VAT/books; Mailchimp tag `morada-course-2026-09-paid`;
   "payment received" email sent once; activity flipped to `paid`.
6. Forged/never-paid session id returns "processing", fulfils nothing.
7. Cancelled checkout returns to the booking page with a clear "not charged" notice.
8. Safety-net poll fulfils a paid session whose customer never returned, and is
   idempotent (no double email/invoice).
9. Booking terms page resolves; refund terms shown. (No discount field; D15 n/a.)
10. CORS allowlist, honeypot, rate limit, disposable + gibberish guards active.

## Phil-decisions still open for Form 2

- **D9 pricing:** GBP 360 inc VAT/seat, 2-5 per-seat, 6+ to enquiry (PROVISIONAL).
- **M1 cap:** `COHORT_HARD_CAP = null` (manual). Set a number to hard-stop in code.
- **M2 MVC fallback:** manual at v1, no code.

Manual by design (Phil): Zoom links and course materials are sent by Phil ahead
of each session; the confirmation email does not carry them.
