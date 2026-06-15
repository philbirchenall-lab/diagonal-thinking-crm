// Form 2 payment confirmation: scheduled poll of FreeAgent invoice status.
//   Spec: outputs/tes-spec-morada-forms-1-and-2-2026-06-15.md sections 3.4-3.7,
//   as amended by Phil's FreeAgent pivot (15 Jun 2026).
//
// WHY A POLL, NOT A WEBHOOK: FreeAgent has no webhooks (verified against
// dev.freeagent.com and the FreeAgent API forum, Jun 2026). So this function is
// invoked on a schedule and detects payment by reading invoice status.
//
// Each run:
//   1. Loads PENDING course_invoice_created activities (written by morada-course-book).
//   2. For each, reads the linked FreeAgent invoice status.
//   3. When an invoice is Paid: upgrades the CRM contact to Client, applies the
//      paid Mailchimp tag, sends the "payment received, Phil will be in touch"
//      email, sends a server-side GA4 purchase (best-effort), and flips the
//      activity to "paid" so it is not processed again.
//
// SCHEDULING: invoke every 5 to 15 minutes (Phil wants the confirmation within
// minutes of payment, not hours) via Supabase scheduled functions / pg_cron, or
// any external scheduler hitting this URL with the shared secret:
//   Authorization: Bearer ${MORADA_POLL_SECRET}
// Manual-fallback bookings (no FreeAgent invoice URL) are skipped here; Phil
// confirms those by hand.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import {
  corsHeaders,
  escapeHtml,
  freeAgentAccessToken,
  freeAgentConfig,
  ga4Purchase,
  getFreeAgentInvoice,
  json,
  sendResend,
  serviceClient,
  syncToMailchimp,
} from "../_shared/forms.ts";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }

  // Shared-secret guard so only the scheduler can run the poll.
  const expected = Deno.env.get("MORADA_POLL_SECRET");
  if (expected) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${expected}`) return json({ error: "Unauthorized" }, 401);
  }

  const faCfg = freeAgentConfig();
  if (!faCfg) {
    console.log("[poll] FreeAgent OAuth not provisioned; nothing to poll.");
    return json({ ok: true, checked: 0, paid: 0, note: "FreeAgent not configured" }, 200);
  }

  const supabase = serviceClient();
  const { data: pending, error } = await supabase
    .from("contact_activities")
    .select("id, contact_id, body, contacts(email, contact_name, company)")
    .eq("activity_type", "course_invoice_created")
    .eq("status", "pending");
  if (error) {
    console.error("[poll] failed to load pending activities:", error);
    return json({ error: "query failed" }, 500);
  }

  let token: string;
  try {
    token = await freeAgentAccessToken(faCfg);
  } catch (e) {
    console.error("[poll] FreeAgent token error:", e);
    return json({ error: "freeagent auth failed" }, 502);
  }

  const resendKey = Deno.env.get("RESEND_API_KEY");
  const mailchimpKey = Deno.env.get("MAILCHIMP_API_KEY");

  let checked = 0;
  let paidCount = 0;

  for (const row of pending ?? []) {
    let meta: Record<string, unknown>;
    try {
      meta = JSON.parse(row.body ?? "{}");
    } catch {
      continue;
    }
    const invoiceUrl = meta.freeagent_invoice_url as string | null;
    if (!invoiceUrl) continue; // manual-fallback booking; Phil confirms by hand

    checked++;
    let inv;
    try {
      inv = await getFreeAgentInvoice(token, invoiceUrl);
    } catch (e) {
      console.error(`[poll] invoice fetch failed for activity ${row.id}:`, e);
      continue;
    }
    // Fire on payment RECEIVED (Stripe charge taken, seconds after paying), NOT
    // on full bank reconciliation ("Paid", up to a week later). See helper note.
    if (!inv.paymentReceived) continue;

    paidCount++;
    const contact = (row.contacts ?? {}) as { email?: string; contact_name?: string; company?: string };
    const email = contact.email ?? "";
    const nameParts = (contact.contact_name ?? "").trim().split(/\s+/);
    const firstName = nameParts[0] ?? "";
    const lastName = nameParts.slice(1).join(" ");
    const totalIncVat = Number(meta.total_inc_vat ?? 0);
    const seats = Number(meta.seats ?? 1);

    // Upgrade the CRM contact to Client.
    await supabase.from("contacts").update({ type: "Client" }).eq("id", row.contact_id)
      .then(() => {}).catch((e: unknown) => console.error("[poll] contact upgrade error:", e));

    // Mailchimp: Client + paid tag.
    if (mailchimpKey && email) {
      await syncToMailchimp(
        {
          email,
          firstName,
          lastName,
          company: contact.company ?? "",
          type: "Client",
          tags: ["morada-ai-2026", "morada-course-2026-09-paid"],
          marketingTag: "morada-ai-2026-marketing",
          marketingConsent: meta.marketing_consent === true,
        },
        mailchimpKey,
      ).catch((e) => console.error("[poll] mailchimp error:", e));
    }

    // Confirmation email (Phil's copy): generic, materials handled manually.
    if (resendKey && email) {
      await sendResend(
        {
          to: email,
          subject: "Payment received: AI for Contractors course",
          html:
            `<p>Hi ${escapeHtml(firstName)},</p>` +
            `<p>Thanks, your payment has been received and your place on the AI for Contractors course is confirmed.</p>` +
            `<p>Phil will be in touch with the joining details and course materials closer to each session ` +
            `(Thursdays 3, 10 and 17 September 2026, 3:00pm to 4:00pm BST).</p>` +
            `<p>See you there,<br>Phil<br>Diagonal Thinking</p>`,
        },
        resendKey,
      ).catch((e) => console.error("[poll] resend error:", e));
    }

    // Server-side GA4 purchase (best-effort; skipped if MP not configured).
    await ga4Purchase({
      clientId: String(meta.freeagent_reference ?? email ?? row.id),
      transactionId: String(meta.freeagent_reference ?? invoiceUrl),
      value: totalIncVat,
      campaign: String(meta.utm_campaign ?? ""),
      items: [{ item_name: "AI for Contractors course", quantity: seats, price: 360 }],
    }).catch((e) => console.error("[poll] ga4 error:", e));

    // Flip the activity to paid so it is not processed again.
    meta.confirmation_sent = true;
    meta.paid_on = inv.paidOn; // null until bank reconciliation catches up
    meta.payment_url_status = inv.paymentUrlStatus;
    await supabase.from("contact_activities")
      .update({ status: "paid", activity_type: "course_booking_paid", body: JSON.stringify(meta) })
      .eq("id", row.id)
      .then(() => {}).catch((e: unknown) => console.error("[poll] activity update error:", e));
  }

  console.log(`[poll] checked ${checked}, newly paid ${paidCount}`);
  return json({ ok: true, checked, paid: paidCount }, 200);
});
