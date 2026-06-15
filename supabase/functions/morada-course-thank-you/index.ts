// Form 2 thank-you / payment verification (B3, Phil 18:32 BST 2026-06-15).
//   Spec: outputs/tes-spec-morada-forms-1-and-2-2026-06-15.md section 3.
//
// Called by the DT thank-you page (/morada-thank-you) with the Stripe
// `session_id` from the return URL. Because the return URL is client-side, we
// VERIFY the payment against the Stripe API before fulfilling - an attacker
// hitting the thank-you URL with a made-up session id gets nothing.
//
// On a verified-paid session it calls the shared fulfilCoursePayment (upsert
// Client, record FreeAgent invoice, paid Mailchimp tag, confirmation email,
// paid activity) and returns "confirmed" so the page fires GA4 purchase.
//
// Race handling (Phil): retry the Stripe lookup a few times with short backoff;
// if still not paid, return "processing" so the page shows "payment processing,
// you'll hear from Phil soon" and the safety-net poll reconciles it later. The
// customer UI is never blocked on backend slowness.
//
// Env-guarded: returns "processing" if STRIPE_SECRET_KEY is not yet provisioned.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import {
  buildCorsHeaders,
  fulfillCoursePayment,
  getStripeCheckoutSession,
  json,
  serviceClient,
  stripeKey,
} from "../_shared/forms.ts";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

serve(async (req: Request) => {
  const cors = buildCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: cors, status: 204 });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400, cors);
  }
  const sessionId = String(body.session_id ?? "").trim();
  if (!sessionId || !sessionId.startsWith("cs_")) {
    return json({ error: "Missing or invalid session_id" }, 400, cors);
  }

  const sk = stripeKey();
  if (!sk) {
    // Inert until provisioned: never claim a payment we cannot verify.
    return json({ status: "processing", reason: "payments not configured" }, 200, cors);
  }

  // Verify the session is paid, with short backoff for the redirect race.
  let verified = null as Awaited<ReturnType<typeof getStripeCheckoutSession>> | null;
  for (const d of [0, 1500, 3000]) {
    if (d) await sleep(d);
    try {
      const s = await getStripeCheckoutSession(sk, sessionId);
      if (s.paid) { verified = s; break; }
    } catch (e) {
      console.error("[thank-you] Stripe verify error:", e);
    }
  }

  if (!verified) {
    // Not confirmed paid yet; the safety-net poll will reconcile it later.
    console.log(`[thank-you] session ${sessionId} not yet paid; returning processing.`);
    return json({ status: "processing" }, 200, cors);
  }

  const meta = verified.metadata ?? {};
  const seats = Number(meta.seats ?? 1);
  const totalIncVat = Number(meta.total_inc_vat ?? (verified.amountTotalPence ?? 0) / 100);

  try {
    const { already } = await fulfillCoursePayment(serviceClient(), {
      sessionId,
      paymentIntent: verified.paymentIntent ?? "",
      meta,
      seats,
    });
    return json({
      status: "confirmed",
      already,
      value: totalIncVat,
      seats,
      campaign: meta.utm_campaign ?? "",
    }, 200, cors);
  } catch (e) {
    // Payment IS verified; if fulfilment hiccups, still confirm to the customer
    // (the safety-net poll will complete the backend). Never block the UI.
    console.error("[thank-you] fulfilment error (payment is verified):", e);
    return json({ status: "confirmed", value: totalIncVat, seats, campaign: meta.utm_campaign ?? "" }, 200, cors);
  }
});
