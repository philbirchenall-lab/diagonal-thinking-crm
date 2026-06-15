// Form 2 payment reconciliation: scheduled poll of FreeAgent invoice status.
//   Spec: outputs/tes-spec-morada-forms-1-and-2-2026-06-15.md sections 3.4-3.7,
//   as amended by Phil's FreeAgent pivot (15 Jun 2026) and the verified-reality
//   simplification (15 Jun 2026).
//
// VERIFIED: FreeAgent has no webhooks AND exposes no early payment signal. A
// paid invoice only flips to status "Paid" once the Stripe payout settles and
// the bank transaction reconciles (up to a week later). So this poll does NOT
// send any customer email - the customer is told what happens at booking time
// (the invoice email) and gets Stripe's own receipt when they pay. This poll is
// INTERNAL bookkeeping only: when FreeAgent finally reconciles an invoice to
// Paid, it upgrades the CRM contact to Client, applies the paid Mailchimp tag,
// records the GA4 purchase, and closes off the activity.
//
// Because the signal is days-late by nature, a daily schedule is plenty.
// SCHEDULING: invoke via Supabase scheduled functions / pg_cron (daily), or any
// external scheduler hitting this URL with the shared secret:
//   Authorization: Bearer ${MORADA_POLL_SECRET}

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import {
  buildCorsHeaders,
  freeAgentAccessToken,
  freeAgentConfig,
  ga4Purchase,
  getFreeAgentInvoice,
  json,
  serviceClient,
  syncToMailchimp,
} from "../_shared/forms.ts";

serve(async (req: Request) => {
  const cors = buildCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: cors, status: 204 });
  }

  // Shared-secret guard so only the scheduler can run the poll.
  const expected = Deno.env.get("MORADA_POLL_SECRET");
  if (expected) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${expected}`) return json({ error: "Unauthorized" }, 401, cors);
  }

  const faCfg = freeAgentConfig();
  if (!faCfg) {
    console.log("[poll] FreeAgent OAuth not provisioned; nothing to poll.");
    return json({ ok: true, checked: 0, paid: 0, note: "FreeAgent not configured" }, 200, cors);
  }

  const supabase = serviceClient();
  const { data: pending, error } = await supabase
    .from("contact_activities")
    .select("id, contact_id, body, contacts(email, contact_name, company)")
    .eq("activity_type", "course_invoice_created")
    .eq("status", "pending");
  if (error) {
    console.error("[poll] failed to load pending activities:", error);
    return json({ error: "query failed" }, 500, cors);
  }

  let token: string;
  try {
    token = await freeAgentAccessToken(faCfg);
  } catch (e) {
    console.error("[poll] FreeAgent token error:", e);
    return json({ error: "freeagent auth failed" }, 502, cors);
  }

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
    // Internal bookkeeping fires only once FreeAgent has reconciled the invoice
    // to Paid (the only signal it gives). No customer email here by design.
    if (inv.status !== "Paid") continue;

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

    // Server-side GA4 purchase (best-effort; skipped if MP not configured).
    await ga4Purchase({
      clientId: String(meta.freeagent_reference ?? email ?? row.id),
      transactionId: String(meta.freeagent_reference ?? invoiceUrl),
      value: totalIncVat,
      campaign: String(meta.utm_campaign ?? ""),
      items: [{ item_name: "AI for Contractors course", quantity: seats, price: 360 }],
    }).catch((e) => console.error("[poll] ga4 error:", e));

    // Close off the activity so it is not processed again.
    meta.confirmation_sent = true;
    meta.paid_on = inv.paidOn;
    await supabase.from("contact_activities")
      .update({ status: "paid", activity_type: "course_booking_paid", body: JSON.stringify(meta) })
      .eq("id", row.id)
      .then(() => {}).catch((e: unknown) => console.error("[poll] activity update error:", e));
  }

  console.log(`[poll] checked ${checked}, reconciled-to-paid ${paidCount}`);
  return json({ ok: true, checked, paid: paidCount }, 200, cors);
});
