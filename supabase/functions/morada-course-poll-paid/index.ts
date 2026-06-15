// Form 2 payment safety net: scheduled poll over pending checkouts (B3).
//   Spec: outputs/tes-spec-morada-forms-1-and-2-2026-06-15.md section 3, as
//   amended by Phil's direct-Stripe decision (18:32 BST 2026-06-15).
//
// The thank-you function is the PRIMARY fulfilment path (customer returns from
// Stripe -> verify -> fulfil). This poll is the SAFETY NET for customers who
// paid but never landed on the thank-you page (closed the tab, network drop).
// For each PENDING course_checkout_started activity it re-checks the Stripe
// session; if Stripe says paid, it runs the same idempotent fulfilCoursePayment
// (upgrade to Client, FreeAgent invoice, paid Mailchimp tag, confirmation email,
// paid activity). Idempotency means a session fulfilled by the thank-you page is
// skipped here.
//
// SCHEDULING: invoke every 15-30 minutes via Supabase scheduled functions /
// pg_cron, or any scheduler hitting this URL with the shared secret:
//   Authorization: Bearer ${MORADA_POLL_SECRET}

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import {
  buildCorsHeaders,
  fulfillCoursePayment,
  getStripeCheckoutSession,
  json,
  serviceClient,
  stripeKey,
  timingSafeEqual,
} from "../_shared/forms.ts";

serve(async (req: Request) => {
  const cors = buildCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: cors, status: 204 });
  }

  // Shared-secret guard so only the scheduler can run the poll. Fail CLOSED:
  // if no secret is configured, reject (never run the poll unauthenticated).
  const expected = Deno.env.get("MORADA_POLL_SECRET");
  const auth = req.headers.get("authorization") ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!expected || !timingSafeEqual(provided, expected)) {
    return json({ error: "Unauthorized" }, 401, cors);
  }

  const sk = stripeKey();
  if (!sk) {
    console.log("[poll] STRIPE_SECRET_KEY not set; nothing to verify.");
    return json({ ok: true, checked: 0, fulfilled: 0, note: "Stripe not configured" }, 200, cors);
  }

  const supabase = serviceClient();
  // Only recent pending checkouts: Stripe sessions expire ~24h, so after 48h an
  // unpaid row is abandoned - stop polling it (bounds work + Stripe calls).
  const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const { data: pending, error } = await supabase
    .from("contact_activities")
    .select("id, body")
    .eq("activity_type", "course_checkout_started")
    .eq("status", "pending")
    .gte("created_at", since);
  if (error) {
    console.error("[poll] failed to load pending checkouts:", error);
    return json({ error: "query failed" }, 500, cors);
  }

  let checked = 0;
  let fulfilled = 0;

  for (const row of pending ?? []) {
    let meta: Record<string, string>;
    try {
      meta = JSON.parse(row.body ?? "{}");
    } catch {
      continue;
    }
    const sessionId = meta.stripe_session_id;
    if (!sessionId) continue;

    checked++;
    let s;
    try {
      s = await getStripeCheckoutSession(sk, sessionId);
    } catch (e) {
      console.error(`[poll] Stripe fetch failed for ${sessionId}:`, e);
      continue;
    }
    if (!s.paid) continue; // still unpaid (abandoned checkout) - leave pending

    try {
      const { already } = await fulfillCoursePayment(supabase, {
        sessionId,
        paymentIntent: s.paymentIntent ?? "",
        meta,
        seats: Number(meta.seats ?? 1),
      });
      if (!already) fulfilled++;
    } catch (e) {
      console.error(`[poll] fulfilment error for ${sessionId}:`, e);
    }
  }

  console.log(`[poll] checked ${checked}, newly fulfilled ${fulfilled}`);
  return json({ ok: true, checked, fulfilled }, 200, cors);
});
