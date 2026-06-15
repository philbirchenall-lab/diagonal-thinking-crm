// Form 2: Morada / Steve "AI for Contractors" paid course booking.
//   Product: 3-session block, Thu 3/10/17 Sep 2026, 15:00-16:00 BST.
//   Price: GBP 300 ex-VAT (GBP 360 inc VAT at 20%) per seat.
//   Spec: outputs/tes-spec-morada-forms-1-and-2-2026-06-15.md section 3.
//
// Flow: validate -> compute total -> create Stripe Checkout session -> return
// the redirect URL. The post-payment chain (FreeAgent invoice, CRM "Client"
// upgrade, confirmation email) runs in morada-course-stripe-webhook on the
// checkout.session.completed event (spec 3.3 / 3.4 / 3.6).
//
// BLOCKED ON PHIL (surfaced to Dot, NOT guessed):
//   D9  seat-count pricing rule. The constants below apply Tes's documented v1
//       suggestion (2-5 seats per-seat at GBP 360 inc VAT, no volume discount;
//       6+ routes to Phil). PROVISIONAL until Phil ratifies D9.
//   M1  upper cohort cap. COHORT_HARD_CAP defaults to null = managed manually
//       (blocks launch, not build). Set a number to enforce a hard stop in code.
//   M2  MVC fallback if 8 paid not hit by Tue 1 Sep noon. Manual decision, no
//       code at v1.
//   Stripe keys (STRIPE_SECRET_KEY) absent. Until provisioned the function
//       returns a clear "payments not configured" 503 rather than faking a
//       redirect.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import {
  badRequest,
  checkRateLimit,
  corsHeaders,
  getClientIp,
  json,
  parseUtm,
  routeFromUtm,
  validateCommon,
} from "../_shared/forms.ts";

// === Pricing config (D9, PROVISIONAL - Phil to ratify) ======================
const UNIT_INC_VAT_PENCE = 36000; // GBP 360.00 inc VAT per seat
const VAT_RATE = 0.20;
const MAX_SELF_SERVE_SEATS = 5; // 6+ routes to Phil as an enquiry, not to Stripe
const COHORT_HARD_CAP: number | null = null; // M1: null = manual cap (blocks launch only)
const STATEMENT_DESCRIPTOR = "DT AI COURSE";
const COHORT_LABEL = "AI for Contractors - Sep 2026 beginner cohort (3 sessions)";

const SUCCESS_URL = Deno.env.get("MORADA_COURSE_SUCCESS_URL") ??
  "https://www.diagonalthinking.co/ai-for-contractors-course?status=success&session_id={CHECKOUT_SESSION_ID}";
const CANCEL_URL = Deno.env.get("MORADA_COURSE_CANCEL_URL") ??
  "https://www.diagonalthinking.co/ai-for-contractors-course?status=cancelled";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const clientIp = getClientIp(req);
  if (!checkRateLimit(clientIp)) {
    return json({ error: "Too many requests. Please try again later." }, 429);
  }

  try {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return badRequest("Invalid JSON body");
    }

    // Layer 1: honeypot.
    if (body._gotcha) return json({ success: true }, 200);

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
    const seats = Math.floor(Number(body.seats ?? 1));

    // Validation.
    const validationError = validateCommon(fields);
    if (validationError) return badRequest(validationError);
    if (!billingAddress) return badRequest("A billing address is required for the invoice.");
    if (!acceptTerms) return badRequest("Please accept the booking terms to continue.");
    if (!Number.isFinite(seats) || seats < 1) return badRequest("Please choose a valid number of seats.");

    // Seat-count routing (D9). 6+ seats are an enquiry, never a Stripe redirect.
    if (seats > MAX_SELF_SERVE_SEATS) {
      return json({
        success: true,
        route: "enquiry",
        message:
          "For 6 or more seats we arrange a private cohort. We have logged your interest and Phil will be in touch to confirm pricing.",
      }, 200);
    }
    // M1 hard cap (only if Phil sets COHORT_HARD_CAP to a number).
    if (COHORT_HARD_CAP !== null && seats > COHORT_HARD_CAP) {
      return badRequest("That exceeds the seats available in this cohort. Please contact us.");
    }

    const utm = parseUtm(body);
    const route = routeFromUtm(utm);

    // Discount code (D15): field present, no active codes at launch. No-op.
    // (Left intentionally inert; an unknown or empty code changes nothing.)

    const totalIncVat = UNIT_INC_VAT_PENCE * seats;

    // === Stripe Checkout (spec 3.3) ========================================
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) {
      console.error("STRIPE_SECRET_KEY not set; cannot create Checkout session.");
      return json({
        error: "Online payment is not yet available. Please contact phil@diagonalthinking.co to book.",
      }, 503);
    }

    // Stripe REST API, form-encoded. VAT-inclusive unit price, so Stripe Tax is
    // not required for UK domestic (spec 3.3). Metadata carries everything the
    // webhook needs to build the FreeAgent invoice and the CRM write.
    const params = new URLSearchParams();
    params.set("mode", "payment");
    params.set("success_url", SUCCESS_URL);
    params.set("cancel_url", CANCEL_URL);
    params.set("customer_email", fields.email);
    params.set("billing_address_collection", "required");
    ["card", "apple_pay", "google_pay"].forEach((m, i) => params.set(`payment_method_types[${i}]`, m));
    params.set("line_items[0][quantity]", String(seats));
    params.set("line_items[0][price_data][currency]", "gbp");
    params.set("line_items[0][price_data][unit_amount]", String(UNIT_INC_VAT_PENCE));
    params.set("line_items[0][price_data][product_data][name]", COHORT_LABEL);
    params.set("payment_intent_data[statement_descriptor]", STATEMENT_DESCRIPTOR);
    // Metadata for the webhook (spec 3.4 / 3.6).
    const meta: Record<string, string> = {
      first_name: fields.first_name,
      last_name: fields.last_name,
      email: fields.email,
      company: fields.company,
      role: fields.role,
      billing_address: billingAddress.slice(0, 480),
      vat_number: vatNumber,
      seats: String(seats),
      net_per_seat_pence: String(Math.round(UNIT_INC_VAT_PENCE / (1 + VAT_RATE))),
      total_inc_vat_pence: String(totalIncVat),
      marketing_consent: String(body.marketing_consent === true || body.marketing_consent === "true"),
      how_heard: String(body.how_heard ?? "").slice(0, 100),
      source: route.source,
      opp_route: route.oppRoute,
      utm_campaign: utm.utm_campaign ?? "",
      utm_source: utm.utm_source ?? "",
      utm_medium: utm.utm_medium ?? "",
      utm_content: utm.utm_content ?? "",
      utm_term: utm.utm_term ?? "",
    };
    Object.entries(meta).forEach(([k, v]) => {
      params.set(`metadata[${k}]`, v);
      params.set(`payment_intent_data[metadata][${k}]`, v);
    });

    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
    const session = await res.json();
    if (!res.ok || !session.url) {
      console.error("Stripe session create failed:", JSON.stringify(session));
      return json({ error: "Could not start checkout. Please try again." }, 502);
    }

    // Return the redirect URL + total so the embed can fire GA4 begin_checkout
    // (spec 3.7) and redirect to Stripe.
    return json({
      success: true,
      route: "checkout",
      checkout_url: session.url,
      total_inc_vat_pence: totalIncVat,
      seats,
      campaign: utm.utm_campaign,
    }, 200);
  } catch (err) {
    console.error("Unexpected error:", err);
    return json({ error: "An unexpected error occurred." }, 500);
  }
});
