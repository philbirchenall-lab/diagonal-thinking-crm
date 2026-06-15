// Form 2: Morada / Steve "AI for Contractors" paid course booking.
//   Product: 3-session block, Thu 3/10/17 Sep 2026, 15:00-16:00 BST.
//   Price: GBP 300 ex-VAT (GBP 360 inc VAT at 20%) per seat.
//   Spec: outputs/tes-spec-morada-forms-1-and-2-2026-06-15.md section 3.
//
// PAYMENT ARCHITECTURE (B3, Phil 18:32 BST 2026-06-15): direct Stripe Checkout.
// On submit this:
//   1. Validates + routes (6+ seats -> enquiry, no payment).
//   2. Creates a Stripe Checkout Session WE own, with success_url pointing at our
//      thank-you page (so we control the post-payment redirect and can verify).
//   3. Writes the CRM contact (Warm Lead) + a PENDING course_checkout_started
//      activity carrying the Stripe session id (for the thank-you fulfilment and
//      the safety-net poll).
//   4. Returns the Checkout URL; the embed fires GA4 begin_checkout and redirects.
//
// The customer pays on Stripe, returns to /morada-thank-you?session_id=..., and
// morada-course-thank-you verifies the session via the Stripe API, then creates
// the FreeAgent invoice (VAT/books), upgrades the contact to Client, and sends
// the confirmation email. FreeAgent is NOT used for payment here.
//
// Env-guarded: inert (503) until STRIPE_SECRET_KEY is provisioned.
//
// BLOCKED ON PHIL (defaults flagged): D9 pricing, M1 cap, M2 MVC fallback.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import {
  badRequest,
  buildCorsHeaders,
  checkRateLimit,
  createStripeCheckoutSession,
  getClientIp,
  json,
  parseUtm,
  routeFromUtm,
  serviceClient,
  stripeKey,
  syncToMailchimp,
  validateCommon,
} from "../_shared/forms.ts";

// === Pricing config (D9, PROVISIONAL - Phil to ratify) ======================
const UNIT_INC_VAT = 360; // GBP inc VAT per seat
const MAX_SELF_SERVE_SEATS = 5; // 6+ routes to Phil as an enquiry
const COHORT_HARD_CAP: number | null = null; // M1: null = manual cap (blocks launch only)
const COHORT_LABEL = "AI for Contractors - Sep 2026 beginner cohort (3 sessions)";
const STATEMENT_DESCRIPTOR = "DT AI COURSE";

const THANKYOU_URL = Deno.env.get("MORADA_THANKYOU_URL") ?? "https://www.diagonalthinking.co/morada-thank-you";
const COURSE_PAGE_URL = Deno.env.get("MORADA_COURSE_PAGE_URL") ?? "https://www.diagonalthinking.co/ai-for-contractors-course";

serve(async (req: Request) => {
  const cors = buildCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: cors, status: 204 });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);

  const clientIp = getClientIp(req);
  if (!checkRateLimit(clientIp)) {
    return json({ error: "Too many requests. Please try again later." }, 429, cors);
  }

  try {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return badRequest("Invalid JSON body", cors);
    }

    if (body._gotcha) return json({ success: true }, 200, cors);

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
    const seats = Math.floor(Number(body.seats ?? 1));

    const validationError = validateCommon(fields);
    if (validationError) return badRequest(validationError, cors);
    if (!billingAddress) return badRequest("A billing address is required for the invoice.", cors);
    if (!acceptTerms) return badRequest("Please accept the booking terms to continue.", cors);
    if (!Number.isFinite(seats) || seats < 1) return badRequest("Please choose a valid number of seats.", cors);

    // Seat-count routing (D9). 6+ seats are an enquiry, not a payment.
    if (seats > MAX_SELF_SERVE_SEATS) {
      return json({
        success: true,
        route: "enquiry",
        message:
          "For 6 or more seats we arrange a private cohort. We have logged your interest and Phil will be in touch to confirm pricing.",
      }, 200, cors);
    }
    if (COHORT_HARD_CAP !== null && seats > COHORT_HARD_CAP) {
      return badRequest("That exceeds the seats available in this cohort. Please contact us.", cors);
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

    // Metadata travels with the Stripe session; the thank-you function reads it
    // back (after verifying the session is paid) to build the FreeAgent invoice
    // and the CRM write. Stripe metadata values are strings, capped per key.
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

    // CRM: upsert contact (Warm Lead) + reliable PENDING activity the thank-you
    // function and the safety-net poll read, keyed on the Stripe session id.
    const supabase = serviceClient();
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
      // The Stripe session exists; do not hard-fail the customer. Proceed to
      // checkout - the thank-you function can still fulfil from session metadata.
    }

    if (contactRow?.id) {
      const { error: actError } = await supabase.from("contact_activities").insert({
        contact_id: contactRow.id,
        activity_type: "course_checkout_started",
        subject: `Course checkout started: ${seats} ${seatWord}`,
        body: JSON.stringify({
          ...meta,
          stripe_session_id: session.id,
          confirmation_sent: false,
        }),
        status: "pending",
      });
      if (actError) console.error("contact_activities insert error:", actError);
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

    // Return the Checkout URL so the embed fires begin_checkout and redirects.
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
