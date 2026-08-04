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
  brandedEmail,
  buildCorsHeaders,
  escapeHtml,
  FA_MAX_INVOICE_ATTEMPTS,
  freeAgentAccessToken,
  freeAgentConfig,
  fulfillCoursePayment,
  getStripeCheckoutSession,
  internalNotifyTo,
  json,
  recordInvoiceForBooking,
  sendResend,
  serviceClient,
  stripeKey,
  testMode,
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

  // === Pass 2: self-heal FreeAgent invoices (set-and-forget) =================
  // A paid booking whose FreeAgent invoice failed is durably marked
  // invoice_status='failed' (not silently lost). Retry ONLY the FreeAgent leg here
  // - email/Mailchimp/contact are already done - with bounded attempts + backoff,
  // then alert Phil ONCE the attempts are exhausted. Skipped entirely in test mode.
  let invoiceRetried = 0;
  let invoiceRecovered = 0;
  let invoiceAlerted = 0;
  if (!testMode()) {
    const BACKOFF_MIN = [15, 60, 360, 1440]; // by prior attempt: 1->15m, 2->1h, 3->6h, 4->24h
    const now = Date.now();
    const { data: owed, error: owedErr } = await supabase
      .from("contact_activities")
      .select("id, body, invoice_attempts, invoice_last_attempt_at, invoice_alerted_at, stripe_session_id")
      .eq("activity_type", "course_booking_paid")
      .eq("status", "paid")
      .eq("invoice_status", "failed")
      // Retry-eligible (attempts < ceiling) OR exhausted-but-not-yet-alerted, so a
      // failed terminal-run alert keeps the row selected and the alert is retried.
      .or(
        `invoice_attempts.lt.${FA_MAX_INVOICE_ATTEMPTS},` +
          `and(invoice_attempts.gte.${FA_MAX_INVOICE_ATTEMPTS},invoice_alerted_at.is.null)`,
      )
      .order("invoice_last_attempt_at", { ascending: true })
      .limit(25);
    if (owedErr) {
      console.error("[poll] failed to load invoice-owed bookings:", owedErr);
    } else if (owed && owed.length) {
      // Mint ONE FreeAgent token for the whole run (respect the 15 refresh/min cap).
      // If it fails (e.g. dead token), recordInvoiceForBooking mints per-row and
      // records the same failure, so attempts still advance toward the alert.
      const faCfg = freeAgentConfig();
      let sharedToken: string | undefined;
      try {
        if (faCfg) sharedToken = await freeAgentAccessToken(faCfg);
      } catch (e) {
        console.error("[poll] FreeAgent token mint failed (retry per-row):", e instanceof Error ? e.message : e);
      }

      for (const r of owed) {
        // One bad row must never abort the whole run.
        try {
          const attempts = r.invoice_attempts ?? 0;

          let body: Record<string, string> = {};
          try { body = JSON.parse(r.body ?? "{}"); } catch { continue; }
          const sessionId = r.stripe_session_id ?? body.stripe_session_id;
          if (!sessionId || sessionId.startsWith("cs_test_")) continue; // never invoice test sessions

          let status = "failed";
          let attemptsAfter = attempts;

          // RETRY the invoice only while under the attempt ceiling and past backoff.
          if (attempts < FA_MAX_INVOICE_ATTEMPTS) {
            const waitMin = BACKOFF_MIN[Math.max(0, Math.min(attempts, BACKOFF_MIN.length) - 1)];
            const lastAt = r.invoice_last_attempt_at ? new Date(r.invoice_last_attempt_at).getTime() : 0;
            if (lastAt && now - lastAt < waitMin * 60 * 1000) continue; // still within backoff

            invoiceRetried++;
            // Idempotency across concurrent poll runs is carried by recordInvoiceForBooking:
            // LAYER 1 (DB-first: skip if already 'recorded'/has URL) and LAYER 2 (the
            // deterministic MOR-<session> reference, looked up before create). The
            // scheduler should not overlap a run with itself.
            const res = await recordInvoiceForBooking(supabase, r.id, {
              sessionId,
              paymentIntent: body.stripe_payment_intent ?? "",
              meta: body,
              seats: Number(body.seats ?? 1),
            }, sharedToken);
            status = res.status;
            attemptsAfter = attempts + 1;
            if (status === "recorded") { invoiceRecovered++; continue; }
          }

          // ALERT ONCE when attempts are exhausted and not yet alerted. Reachable both
          // when this run just hit the ceiling AND when a prior terminal-run alert send
          // failed (the row stays selected via invoice_alerted_at IS NULL), so a failed
          // alert is genuinely retried rather than silently dropped.
          if (attemptsAfter >= FA_MAX_INVOICE_ATTEMPTS && !r.invoice_alerted_at) {
            const resendKey = Deno.env.get("RESEND_API_KEY");
            if (!resendKey) { console.error("[poll] cannot alert (RESEND_API_KEY missing) for", sessionId); continue; }
            const { data: latest } = await supabase
              .from("contact_activities").select("invoice_last_error").eq("id", r.id).maybeSingle();
            const err = latest?.invoice_last_error ?? "(no error captured)";
            const deadToken = /AUTH_DEAD/.test(err);
            const alertRows = [
              { label: "Email", value: body.email ?? "" },
              { label: "Seats", value: String(body.seats ?? "") },
              { label: "Total (inc VAT)", value: body.total_inc_vat ? `GBP ${body.total_inc_vat}` : "" },
              { label: "Stripe session", value: sessionId },
              { label: "Payment intent", value: body.stripe_payment_intent ?? "" },
              { label: "Attempts", value: String(attemptsAfter) },
              { label: "Last error", value: err },
            ].filter((f) => f.value && String(f.value).trim())
              .map((f) => `<tr><td style="padding:4px 14px 4px 0;vertical-align:top;color:#6b6862;white-space:nowrap;">${escapeHtml(f.label)}</td><td style="padding:4px 0;color:#111111;">${escapeHtml(String(f.value))}</td></tr>`)
              .join("");
            // Stamp invoice_alerted_at ONLY after a confirmed send, so a failed
            // alert is retried next run rather than silently swallowed.
            const sent = await sendResend({
              to: internalNotifyTo(),
              subject: "ACTION: Morada course invoice failed - raise it manually",
              html: brandedEmail({
                heading: "Course invoice needs manual action",
                bodyHtml:
                  `<p>A PAID Morada course booking has failed to record a FreeAgent invoice after ${attemptsAfter} attempts. The payment is captured; please raise the invoice manually.</p>` +
                  `<table style="border-collapse:collapse;font-size:15px;line-height:1.5;">${alertRows}</table>` +
                  (deadToken
                    ? `<p><strong>FreeAgent authorisation has expired.</strong> Reconnect the FreeAgent app and update FREEAGENT_REFRESH_TOKEN, then future bookings record automatically.</p>`
                    : ``),
                footer: "Internal alert from the Diagonal Thinking booking forms.",
              }),
            }, resendKey);
            if (sent) {
              await supabase.from("contact_activities")
                .update({ invoice_alerted_at: new Date().toISOString() })
                .eq("id", r.id).then(() => {}).catch(() => {});
              invoiceAlerted++;
            } else {
              console.error("[poll] alert send failed; will retry next run for", sessionId);
            }
          }
        } catch (e) {
          console.error("[poll] invoice retry row error:", e instanceof Error ? e.message : e);
        }
      }
    }
  }

  // === Pass 3: surface stranded fulfilments (never silent) ===================
  // A crash between the claim (status='fulfilling') and finalize would otherwise
  // leave a booking stuck forever (the idempotency guard treats 'fulfilling' as
  // done, and the poll's pending pass only reads status='pending'). We cannot
  // safely auto-replay email+invoice from an arbitrary mid-point, so we alert Phil
  // once for any course row stuck 'fulfilling' beyond 20 minutes (functions never
  // run that long, so such a row is definitively crashed, not in-flight).
  let strandedAlerted = 0;
  {
    const staleBefore = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const { data: stuck } = await supabase
      .from("contact_activities")
      .select("id, body, stripe_session_id, created_at, invoice_alerted_at")
      .eq("status", "fulfilling")
      .in("activity_type", ["course_checkout_started", "course_booking_paid"])
      .lt("created_at", staleBefore)
      .is("invoice_alerted_at", null)
      .limit(25);
    for (const r of stuck ?? []) {
      try {
        const resendKey = Deno.env.get("RESEND_API_KEY");
        if (!resendKey) break;
        let body: Record<string, string> = {};
        try { body = JSON.parse(r.body ?? "{}"); } catch { /* ignore */ }
        const stuckRows = [
          { label: "Email", value: body.email ?? "" },
          { label: "Stripe session", value: r.stripe_session_id ?? body.stripe_session_id ?? "" },
          { label: "Payment intent", value: body.stripe_payment_intent ?? "" },
          { label: "Started", value: r.created_at ?? "" },
        ].filter((f) => f.value && String(f.value).trim())
          .map((f) => `<tr><td style="padding:4px 14px 4px 0;color:#6b6862;white-space:nowrap;">${escapeHtml(f.label)}</td><td style="padding:4px 0;color:#111111;">${escapeHtml(String(f.value))}</td></tr>`)
          .join("");
        const sent = await sendResend({
          to: internalNotifyTo(),
          subject: "ACTION: Morada course booking stuck mid-fulfilment",
          html: brandedEmail({
            heading: "Booking stuck mid-fulfilment",
            bodyHtml:
              `<p>A Morada course booking has been stuck part-way through fulfilment for over 20 minutes (a server interruption between taking payment and finishing). Please check it: the customer may be missing their confirmation email or invoice.</p>` +
              `<table style="border-collapse:collapse;font-size:15px;line-height:1.5;">${stuckRows}</table>`,
            footer: "Internal alert from the Diagonal Thinking booking forms.",
          }),
        }, resendKey);
        if (sent) {
          await supabase.from("contact_activities").update({ invoice_alerted_at: new Date().toISOString() }).eq("id", r.id).then(() => {}).catch(() => {});
          strandedAlerted++;
        }
      } catch (e) {
        console.error("[poll] stranded-row alert error:", e instanceof Error ? e.message : e);
      }
    }
  }

  console.log(`[poll] checked ${checked}, fulfilled ${fulfilled}; invoice retried ${invoiceRetried}, recovered ${invoiceRecovered}, alerted ${invoiceAlerted}, stranded ${strandedAlerted}`);
  return json({ ok: true, checked, fulfilled, invoiceRetried, invoiceRecovered, invoiceAlerted, strandedAlerted }, 200, cors);
});
