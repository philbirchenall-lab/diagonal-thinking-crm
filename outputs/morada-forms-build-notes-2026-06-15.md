# Morada / Steve "AI for Contractors" launch forms: build notes

**Built by:** Rex, 15 Jun 2026
**Branch:** `rex/morada-forms-12-2026-06-15`
**Spec:** `outputs/tes-spec-morada-forms-1-and-2-2026-06-15.md`
**Form 2 payment architecture:** revised 15 Jun 2026 per Phil's FreeAgent pivot (direct Stripe dropped).

This file records the architecture decisions, deploy steps, the updated Form 2
acceptance criteria, and the Phil-actions still outstanding before launch.

## Files in this build

| File | What it is |
| --- | --- |
| `supabase/functions/_shared/forms.ts` | Shared module: spam layers, CRM write, Mailchimp, Resend, .ics, UTM, FreeAgent API, GA4 Measurement Protocol. |
| `supabase/functions/morada-webinar-register/index.ts` | Form 1 edge function (free webinar). |
| `supabase/functions/morada-course-book/index.ts` | Form 2 edge function: creates the FreeAgent invoice, emails the Pay-now button. |
| `supabase/functions/morada-course-poll-paid/index.ts` | Form 2 scheduled poll: detects paid invoices, fires the confirmation. |
| `outputs/morada-webinar-embed-v1-2026-06-15.html` | Form 1 Squarespace Code Block embed. |
| `outputs/morada-course-embed-v1-2026-06-15.html` | Form 2 Squarespace Code Block embed. |

(The earlier `morada-course-stripe-webhook` function was removed in the pivot.)

## Infrastructure decisions

### Decision 1: canonical backend = Supabase Edge Functions

The live DT marketing forms (`contact-form`, `register-interest`) are Supabase
Edge Functions posted to from Squarespace. The repo's `/api` Vercel routes serve
the CRM app, not public site forms. So both new forms are Edge Functions reusing
the shared module. (Spec 1.1.)

### Decision 2: CRM write = email-keyed upsert + activity write; opp move deferred

The six-gate dedup and Gmail-scrape gate Mae described do **not exist anywhere in
the repo**. The live forms do a single email-keyed `contacts` upsert. So v1:
email-keyed UPSERT (this is the dedup), plus a `contact_activities` row carrying
UTM + invoice details, and **opp `229660dd` move deferred to manual
reconciliation** (no code path, no opp schema). (Spec 1.6.)

### Decision 3 (Form 2): FreeAgent-driven payment, poll not webhook

Phil's locked architecture: form -> FreeAgent invoice with Stripe online payment
-> FreeAgent emails the Pay-now button -> a scheduled poll detects payment ->
our confirmation email. No direct Stripe code, no Stripe keys.

**FreeAgent has no webhooks** (verified against dev.freeagent.com and the
FreeAgent API forum, Jun 2026; it is an open feature request). So payment is
detected by **polling invoice status**, which is the repo's existing pattern for
scheduled jobs (`proposal-followup-cron`). Phil chose the poll (15 Jun 2026).
Outcome is identical to the intended webhook (automated "payment received"
email); confirmation lands within one poll interval of payment.

**Stripe connect:** FreeAgent's Connect-to-Stripe accepts an existing Stripe
account (you enter the account email). Phil's Monzo-managed Stripe is a standard
Stripe account and will connect. Limit: one Stripe account per FreeAgent. No
GoCardless fallback needed. Phil connects it in FreeAgent Settings -> Online
Payments; nothing for Rex to do on the Stripe side.

## Deploy steps

1. **Deploy the functions** (public, like the live forms):
   ```
   supabase functions deploy morada-webinar-register --no-verify-jwt
   supabase functions deploy morada-course-book --no-verify-jwt
   supabase functions deploy morada-course-poll-paid --no-verify-jwt
   ```
2. **Schedule the poll** (hourly is fine). Either Supabase scheduled functions /
   pg_cron invoking `morada-course-poll-paid`, or any scheduler hitting its URL
   with `Authorization: Bearer ${MORADA_POLL_SECRET}`.
3. **Phil connects Stripe** in FreeAgent Settings -> Online Payments (existing
   Monzo-managed Stripe account).
4. **Paste the embeds** into the two Squarespace Code Blocks; the CONFIG block is
   already set (FUNCTION_URL, PRIVACY_URL, BOOKING_TERMS_URL).
5. **Smoke-test** end to end with a 1-seat booking and a real (or test) FreeAgent
   invoice payment; confirm the poll fires the confirmation within one interval.

## Environment variables

Already provisioned (`.env.production.local`): `MAILCHIMP_API_KEY`,
`RESEND_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`.

Needed, NOT yet provisioned (Phil to action):

| Var | Used by | Without it |
| --- | --- | --- |
| `FREEAGENT_CLIENT_ID` (or `FREEAGENT_API_KEY`) | book + poll | FreeAgent skipped; booking recorded, invoice raised manually (fallback). |
| `FREEAGENT_CLIENT_SECRET` | book + poll | As above (needed for the OAuth refresh grant). |
| `FREEAGENT_REFRESH_TOKEN` | book + poll | As above. |
| `FREEAGENT_BASE_URL` | book + poll | Optional; defaults to production. Set to the sandbox host for testing. |
| `MORADA_POLL_SECRET` | poll | Poll is unprotected (set this before scheduling). |
| `GA4_MEASUREMENT_ID` + `GA4_API_SECRET` | poll | Server-side `purchase` event skipped (client-side `generate_lead` still fires). |
| `MORADA_WEBINAR_JOIN_URL` | Form 1 | Webinar confirmation says "join link to follow". |

NB: this refines Tes's original FreeAgent env list (`FREEAGENT_API_KEY` /
`ACCESS_TOKEN` / `REFRESH_TOKEN`). We mint a fresh access token from the refresh
token at call time, so the short-lived `ACCESS_TOKEN` is not stored;
`CLIENT_SECRET` is additionally required for the refresh grant.

## Verified on a local static server (functions not yet deployed)

- Both pages render with DT brand colours, labelled fields, focus states.
- UTM capture + first-touch persistence to localStorage across a cross-page visit.
- Form 1: validation, char counter, success panel with join link + .ics,
  `generate_lead` fires once on success (not on failure).
- Form 2: per-seat totals (1 = 360, 2 = 720, 3 = 1080), 6+ routes to enquiry,
  the "invoice emailed" confirmation panel renders on success, `generate_lead`
  fires once.
- Em-dash zero across all files (eslint `dt/no-emdash` logic reproduced manually).

A full end-to-end test (FreeAgent contact + invoice, Stripe payment, poll
confirmation, CRM upgrade) needs the functions deployed, FreeAgent OAuth
provisioned, and Stripe connected in FreeAgent.

## Form 2 acceptance criteria (updated for the FreeAgent flow)

Replaces spec criteria 12-20. Verify on staging/preview before opening to traffic:

1. Totals compute: 1 seat 360, 2-5 per-seat, 6+ routes to enquiry (no invoice).
2. On a valid 1-5 seat submit, a FreeAgent invoice is created for the contact
   (deduped on email), with the course line item, net 300/seat, 20% VAT, 0-day
   terms, and Stripe online payment enabled.
3. FreeAgent emails the customer the invoice with a working Pay-now button.
4. The form shows the "check your email / invoice emailed" confirmation and fires
   GA4 `generate_lead` once (form_id `morada_course_form2`, value, campaign).
5. A PENDING `course_invoice_created` activity is written with the FreeAgent
   invoice URL (the poll's tracking record).
6. On payment, the poll: upgrades the contact to `Client`, applies Mailchimp tag
   `morada-course-2026-09-paid` (TYPE Client), sends the "payment received, Phil
   will be in touch" email once, and flips the activity to `paid` (no re-send on
   the next run).
7. GA4 server-side `purchase` is sent via Measurement Protocol when configured
   (else skipped, no error).
8. Booking terms page resolves from the checkbox; refund terms shown. Discount
   field present and inert (D15).
9. Manual fallback: with FreeAgent OAuth absent, the booking is still recorded
   and the form says "your invoice will follow"; no crash.
10. Honeypot, rate limit, disposable-email and gibberish-name guards active.

## Phil-decisions still open for Form 2 (surfaced to Dot, NOT guessed)

Implemented as Tes's documented v1 defaults, flagged in source:

- **D9 pricing:** GBP 360 inc VAT/seat, 2-5 per-seat, 6+ to enquiry.
- **M1 cap:** `COHORT_HARD_CAP = null` (manual). Set a number to hard-stop in code.
- **M2 MVC fallback:** manual at v1, no code.

Manual by design (Phil): Zoom links and course materials are sent by Phil ahead
of each session; the confirmation email does not carry them.
