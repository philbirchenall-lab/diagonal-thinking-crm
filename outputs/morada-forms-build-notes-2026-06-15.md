# Morada / Steve "AI for Contractors" launch forms: build notes

**Built by:** Rex, 15 Jun 2026
**Branch:** `rex/morada-forms-12-2026-06-15`
**Spec:** `outputs/tes-spec-morada-forms-1-and-2-2026-06-15.md`

This file records the two infrastructure decisions Tes asked me to resolve from
the codebase, the deploy steps, and the Phil-actions still outstanding before
either form can go live.

## Files in this build

| File | What it is |
| --- | --- |
| `supabase/functions/_shared/forms.ts` | Shared module (spam layers, CRM write, Mailchimp, Resend, .ics, UTM). Build-once, both forms use it. |
| `supabase/functions/morada-webinar-register/index.ts` | Form 1 edge function (free webinar). |
| `supabase/functions/morada-course-book/index.ts` | Form 2 edge function (paid course, creates Stripe Checkout). |
| `supabase/functions/morada-course-stripe-webhook/index.ts` | Form 2 post-payment chain (CRM upgrade, Mailchimp, FreeAgent, email). |
| `outputs/morada-webinar-embed-v1-2026-06-15.html` | Form 1 Squarespace Code Block embed. |
| `outputs/morada-course-embed-v1-2026-06-15.html` | Form 2 Squarespace Code Block embed. |

## Infrastructure decisions (Tes flagged these for Rex to resolve)

### Decision 1: canonical backend = Supabase Edge Functions

The live DT marketing forms (`contact-form`, `register-interest`) are Supabase
Edge Functions posted to from Squarespace. The repo's `/api` Vercel routes serve
the CRM app itself, not public site forms, and nothing has moved DT site forms
onto Vercel. So both new forms are Edge Functions reusing a shared module, for
consistency with the live precedent and maximum reuse. (Spec 1.1 / section 5.)

### Decision 2: CRM write path = email-keyed upsert + activity write; opp move deferred

The richer canonical path Mae described (six-gate dedup + Gmail-scrape gate +
automatic opp move) does **not exist anywhere in the repo**. I searched the
functions, the `/api` endpoints, the migrations, and the data files. What exists:

- The live forms do a single `contacts` upsert keyed on `email`.
- The `contact_activities` table exists and is written by the proposal flows.
- Opp `229660dd` was created manually by Sol (per CODEX-BACKLOG.md). There is no
  code path and no `opportunities` schema in migrations to move it from a form.

So v1 (spec 1.6 fallback):

1. **Email-keyed UPSERT on `contacts`** (UPDATE-or-INSERT). This is the dedup and
   satisfies acceptance criterion 6 (no duplicate contact row).
2. **Write a `contact_activities` row** (non-blocking, so it never breaks the
   submission). UTM + role + how-heard + takeaway (Form 1) and the Stripe payment
   intent (Form 2) are stored in the activity `body` as JSON, giving an audit
   trail and deterministic attribution.
3. **Opp linkage / stage move is deferred to manual reconciliation.** The activity
   row carries `utm_campaign` and `opp_route` ("link" -> opp 229660dd, "new" ->
   new opp) so Sol or Mae can reconcile by hand. Mutating the pipeline from a
   public form with no precedent or schema is the wrong risk at v1.

## Deploy steps

1. **Deploy the three functions** (public, like the live forms):
   ```
   supabase functions deploy morada-webinar-register --no-verify-jwt
   supabase functions deploy morada-course-book --no-verify-jwt
   supabase functions deploy morada-course-stripe-webhook --no-verify-jwt
   ```
2. **Set the Stripe webhook** endpoint in the Stripe dashboard to the deployed
   `morada-course-stripe-webhook` URL, event `checkout.session.completed`. Copy
   the signing secret into `STRIPE_WEBHOOK_SECRET`.
3. **Paste the embeds** into the two Squarespace Code Blocks and set the CONFIG
   block at the top of each (FUNCTION_URL, PRIVACY_URL, BOOKING_TERMS_URL).
4. **Smoke-test** with a GBP 1 Stripe test product (spec section 4).

## Environment variables

Already provisioned (confirmed in `.env.production.local`): `MAILCHIMP_API_KEY`,
`RESEND_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`.

Needed, NOT yet provisioned (Phil to action):

| Var | Used by | Without it |
| --- | --- | --- |
| `MORADA_WEBINAR_JOIN_URL` | Form 1 | Confirmation says "join link will follow". |
| `STRIPE_SECRET_KEY` | Form 2 book | Function returns a 503 "contact us" (no fake redirect). Blocks Form 2. |
| `STRIPE_WEBHOOK_SECRET` | Form 2 webhook | Webhook rejects all events. Blocks Form 2 post-payment. |
| `FREEAGENT_API_KEY` / `FREEAGENT_ACCESS_TOKEN` / `FREEAGENT_REFRESH_TOKEN` | Form 2 webhook | Invoice automation skipped, manual fallback applies (spec 3.4 authorises shipping on this). |
| `MORADA_COURSE_ZOOM_LINKS` | Form 2 webhook | Confirmation uses "join links to follow" (D13). |
| `MORADA_COURSE_SUCCESS_URL` / `MORADA_COURSE_CANCEL_URL` | Form 2 book | Default to the `/ai-for-contractors-course` slug; override only if the slug changes. |

## Verified on a local static server (functions not yet deployed)

- Both pages render with DT brand colours, WCAG-friendly labels and focus states.
- UTM capture into hidden fields + first-touch persistence to localStorage,
  surviving a cross-page visit.
- Form 1: validation, char counter, success panel with join link + .ics data URI,
  `generate_lead` fires exactly once on success (not on failure).
- Form 2: per-seat totals (1 = 360, 2 = 720, 3 = 1080), 6+ seats route to enquiry
  (no Stripe), `begin_checkout` fires on redirect, `purchase` fires once on the
  return page and dedups on `session_id` across a refresh.
- Em-dash zero across all six files (eslint `dt/no-emdash` rule logic reproduced
  manually with a Unicode scan; also covers en-dashes and curly quotes).

A full end-to-end test (real CRM write, Mailchimp tag, Stripe redirect, FreeAgent
invoice) needs the functions deployed and the keys above provisioned.

## Phil-decisions still open for Form 2 (surfaced to Dot, NOT guessed)

The Form 2 code applies Tes's documented v1-default suggestions, clearly flagged
in the source, so Phil's answers become one-line config changes:

- **D9 seat pricing.** Implemented as GBP 360 inc VAT/seat, 2-5 per-seat, 6+ to
  enquiry (`UNIT_INC_VAT_PENCE`, `MAX_SELF_SERVE_SEATS` in `morada-course-book`).
  PROVISIONAL until Phil ratifies.
- **M1 upper cap.** `COHORT_HARD_CAP = null` (managed manually = blocks launch
  only). Set a number to enforce a hard stop in code.
- **M2 MVC fallback.** Manual decision, no code at v1.
