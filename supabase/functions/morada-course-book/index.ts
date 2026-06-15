// Form 2: Morada / Steve "AI for Contractors" paid course booking.
//   Product: 3-session block, Thu 3/10/17 Sep 2026, 15:00-16:00 BST.
//   Price: GBP 300 ex-VAT (GBP 360 inc VAT at 20%) per seat.
//   Spec: outputs/tes-spec-morada-forms-1-and-2-2026-06-15.md section 3.
//
// PAYMENT ARCHITECTURE (B3, Phil 18:32 BST): direct Stripe Checkout. We create
// the session (success_url -> /morada-thank-you) and return its URL; the embed
// fires GA4 begin_checkout and redirects. morada-course-thank-you verifies the
// session against the Stripe API on return and only THEN records the FreeAgent
// invoice. This function NEVER touches FreeAgent (item 8: no invoice without a
// verified Stripe payment).
//
// P0 SECURITY (Phil 19:02 BST) - layered, attacker cannot trigger an invoice:
//   - Server-side Origin + Referer allowlist (not just CORS headers).
//   - Honeypot (website/_gotcha) + min fill-time -> SILENT drop.
//   - Persistent (Postgres) rate limit, survives cold start.
//   - Strict input validation before anything; seats enforced 1-5 server-side.
//   - Idempotency key: a replay returns the same Checkout session, not a new one.
//
// Env-guarded: inert (503) until STRIPE_SECRET_KEY is provisioned.
// BLOCKED ON PHIL (defaults flagged): D9 pricing, M1 cap, M2 MVC fallback.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import {
  badRequest,
  buildCorsHeaders,
  checkDbRateLimit,
  createStripeCheckoutSession,
  getClientIp,
  isHoneypotTripped,
  json,
  originRefererOk,
  parseUtm,
  routeFromUtm,
  serviceClient,
  stripeKey,
  syncToMailchimp,
  tooFast,
  validateCommon,
} from "../_shared/forms.ts";

// === Pricing config (D9, PROVISIONAL - Phil to ratify) ======================
const UNIT_INC_VAT = 360; // GBP inc VAT per seat
const MAX_SELF_SERVE_SEATS = 5; // outside 1-5 routes to Phil as an enquiry
const COHORT_LABEL = "AI for Contractors - Sep 2026 beginner cohort (3 sessions)";
const STATEMENT_DESCRIPTOR = "DT AI COURSE";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENQUIRY_MSG =
  "For 6 or more seats we arrange a private cohort. We have logged your interest and Phil will be in touch to confirm pricing.";

// Apex per Phil's instruction (matches the embeds' privacy/terms links). The
// site canonical is www (apex 301-redirects, preserving the session_id query),
// so this resolves cleanly; override via the env var to use www directly.
const THANKYOU_URL = Deno.env.get("MORADA_THANKYOU_URL") ?? "https://diagonalthinking.co/morada-thank-you";
const COURSE_PAGE_URL = Deno.env.get("MORADA_COURSE_PAGE_URL") ?? "https://diagonalthinking.co/ai-for-contractors-course";

serve(async (req: Request) => {
  const cors = buildCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: cors, status: 204 });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);

  // Item 1: server-side Origin + Referer allowlist (explicit reject).
  if (!originRefererOk(req)) {
    console.log("[security] origin/referer rejected");
    return json({ error: "Forbidden" }, 403, cors);
  }

  try {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return badRequest("Invalid JSON body", cors);
    }

    // Item 3: honeypot + timing -> SILENT drop (look like success, do nothing).
    if (isHoneypotTripped(body) || tooFast(body)) {
      console.log("[spam] honeypot/timing silent drop");
      return json({ success: true }, 200, cors);
    }

    const fields = {
      first_name: String(body.first_name ?? "").trim(),
      last_name: String(body.last_name ?? "").trim(),
      email: String(body.email ?? "").trim().toLowerCase(),
      company: String(body.company ?? "").trim(),
      role: String(body.role ?? "").trim(),
    };
    const billingAddress = String(body.billing_address ?? "").trim();
    const vatNumber = String(body.vat_number ?? "").trim().slice(0, 32);
    const acceptTerms = body.accept_terms === true || body.accept_terms === "true";
    const marketingConsent = body.marketing_consent === true || body.marketing_consent === "true";
    const howHeard = String(body.how_heard ?? "").trim().slice(0, 100);
    const seats = Math.floor(Number(body.seats ?? 0));

    // Item 4: strict validation (legit-user 400 messages).
    const validationError = validateCommon(fields);
    if (validationError) return badRequest(validationError, cors);
    if (!billingAddress || billingAddress.length > 480) {
      return badRequest("A billing address is required for the invoice.", cors);
    }
    if (!acceptTerms) return badRequest("Please accept the booking terms to continue.", cors);

    // Item 4: seats enforced 1-5 server-side; anything else -> enquiry (no payment).
    if (!Number.isInteger(seats) || seats < 1 || seats > MAX_SELF_SERVE_SEATS) {
      return json({ success: true, route: "enquiry", message: ENQUIRY_MSG }, 200, cors);
    }

    const supabase = serviceClient();

    // Item 2: persistent rate limit (IP-keyed; stricter than ip+email - catches
    // email-varying floods too). 3 per 10 minutes, survives cold start.
    const ip = getClientIp(req);
    if (!(await checkDbRateLimit(supabase, `book:${ip}`))) {
      return json({ error: "Too many requests. Please try again later." }, 429, cors);
    }

    // Item 5: idempotency. The embed sends a UUID per submit. Missing/invalid =
    // not from our form -> silent drop. A replay within 15 min returns the SAME
    // Checkout session instead of creating a new one (no duplicate invoice).
    const idem = String(body.idempotency_key ?? "").trim();
    if (!UUID_RE.test(idem)) {
      console.log("[spam] missing/invalid idempotency key, silent drop");
      return json({ success: true }, 200, cors);
    }
    const { data: prior } = await supabase
      .from("contact_activities")
      .select("body, created_at")
      .eq("idempotency_key", idem)
      .maybeSingle();
    if (prior) {
      let pb: Record<string, unknown> = {};
      try { pb = JSON.parse(prior.body ?? "{}"); } catch { /* ignore */ }
      const ageMs = Date.now() - new Date(prior.created_at as string).getTime();
      if (ageMs < 15 * 60 * 1000 && pb.checkout_url) {
        return json({
          success: true,
          route: "checkout",
          checkout_url: pb.checkout_url,
          session_id: pb.stripe_session_id,
          total_inc_vat: Number(pb.total_inc_vat) || seats * UNIT_INC_VAT,
          seats: Number(pb.seats) || seats,
          campaign: pb.utm_campaign ?? null,
        }, 200, cors);
      }
      // Stale key reuse -> silent drop (do not mint a new session).
      return json({ success: true }, 200, cors);
    }

    // Payments inert until the Stripe key is provisioned (B3 env-guard).
    const sk = stripeKey();
    if (!sk) {
      console.error("STRIPE_SECRET_KEY not set; cannot create Checkout session.");
      return json({
        error: "Online payment is not yet available. Please contact phil@diagonalthinking.co to book.",
      }, 503, cors);
    }

    const utm = parseUtm(body);
    const route = routeFromUtm(utm);
    const totalIncVat = UNIT_INC_VAT * seats;
    const seatWord = seats === 1 ? "seat" : "seats";

    // Item 8: this metadata is read back by the thank-you function ONLY after it
    // verifies the session is paid against Stripe. No FreeAgent call happens here.
    const meta: Record<string, string> = {
      first_name: fields.first_name,
      last_name: fields.last_name,
      email: fields.email,
      company: fields.company,
      role: fields.role,
      billing_address: billingAddress.slice(0, 480),
      vat_number: vatNumber,
      seats: String(seats),
      total_inc_vat: String(totalIncVat),
      marketing_consent: String(marketingConsent),
      how_heard: howHeard,
      source: route.source,
      opp_route: route.oppRoute,
      utm_campaign: utm.utm_campaign ?? "",
      utm_source: utm.utm_source ?? "",
      utm_medium: utm.utm_medium ?? "",
      utm_content: utm.utm_content ?? "",
      utm_term: utm.utm_term ?? "",
    };

    let session;
    try {
      session = await createStripeCheckoutSession({
        key: sk,
        successUrl: `${THANKYOU_URL}?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${COURSE_PAGE_URL}?status=cancelled`,
        customerEmail: fields.email,
        lineName: `${COHORT_LABEL} - ${seats} ${seatWord}`,
        unitAmountPence: UNIT_INC_VAT * 100,
        quantity: seats,
        statementDescriptor: STATEMENT_DESCRIPTOR,
        metadata: meta,
      });
    } catch (e) {
      console.error("Stripe session create error:", e);
      return json({ error: "Could not start checkout. Please try again." }, 502, cors);
    }

    // CRM: upsert contact (Warm Lead) + PENDING activity, keyed on the
    // idempotency key (unique index) and carrying the session + checkout URL so a
    // replay returns the same booking and the thank-you/poll can fulfil it.
    const { data: contactRow, error: contactError } = await supabase
      .from("contacts")
      .upsert(
        {
          contact_name: `${fields.first_name} ${fields.last_name}`,
          email: fields.email,
          company: fields.company,
          type: "Warm Lead",
          source: route.source,
        },
        { onConflict: "email", ignoreDuplicates: false },
      )
      .select("id")
      .maybeSingle();
    if (contactError) {
      console.error("Supabase contact upsert error:", contactError);
      // Stripe session exists; thank-you can still fulfil from session metadata.
    }

    if (contactRow?.id) {
      const { error: actError } = await supabase.from("contact_activities").insert({
        contact_id: contactRow.id,
        activity_type: "course_checkout_started",
        subject: `Course checkout started: ${seats} ${seatWord}`,
        idempotency_key: idem,
        body: JSON.stringify({
          ...meta,
          stripe_session_id: session.id,
          checkout_url: session.url,
          confirmation_sent: false,
        }),
        status: "pending",
      });
      // Unique-index race: another concurrent submit with the same key won.
      if (actError) console.error("contact_activities insert error (likely idempotency race):", actError);
    }

    // Mailchimp at booking: Warm Lead + booked tag (paid tag added on payment).
    const mailchimpKey = Deno.env.get("MAILCHIMP_API_KEY");
    if (mailchimpKey) {
      syncToMailchimp(
        {
          email: fields.email,
          firstName: fields.first_name,
          lastName: fields.last_name,
          company: fields.company,
          type: "Warm Lead",
          tags: ["morada-ai-2026", "morada-course-2026-09-booked"],
          marketingTag: "morada-ai-2026-marketing",
          marketingConsent,
        },
        mailchimpKey,
      ).catch((err) => console.error("Mailchimp sync error:", err));
    }

    return json({
      success: true,
      route: "checkout",
      checkout_url: session.url,
      session_id: session.id,
      total_inc_vat: totalIncVat,
      seats,
      campaign: utm.utm_campaign,
    }, 200, cors);
  } catch (err) {
    console.error("Unexpected error:", err);
    return json({ error: "An unexpected error occurred." }, 500, cors);
  }
});
