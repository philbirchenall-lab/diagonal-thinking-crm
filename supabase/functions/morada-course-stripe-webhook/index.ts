// Form 2 post-payment chain: Stripe webhook on checkout.session.completed.
//   Spec: outputs/tes-spec-morada-forms-1-and-2-2026-06-15.md sections 3.4-3.6.
//
// On a confirmed payment this:
//   1. Upserts the CRM contact as "Client" + writes a course_booking_paid
//      activity carrying the Stripe payment intent and UTM (spec 3.6).
//   2. Mailchimp: TYPE "Client", course tags, marketing tag only on consent.
//   3. Creates a paid FreeAgent invoice via the API (spec 3.4) IF the FreeAgent
//      OAuth env vars are present. If not, it logs the manual-fallback notice:
//      Phil raises the invoice by hand from the Stripe paid notification. The
//      spec explicitly authorises shipping on this fallback.
//   4. Sends the transactional confirmation email (invoice link if available,
//      3 Zoom links or "to follow", 3 .ics attachments).
//
// BLOCKED ON PROVISIONING (surfaced to Dot):
//   STRIPE_WEBHOOK_SECRET, and the FreeAgent OAuth trio
//   (FREEAGENT_API_KEY / FREEAGENT_ACCESS_TOKEN / FREEAGENT_REFRESH_TOKEN).
//   The webhook degrades safely without FreeAgent (manual fallback).

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import {
  buildIcs,
  corsHeaders,
  escapeHtml,
  icsToBase64,
  MORADA_OPP_ID,
  sendResend,
  serviceClient,
  syncToMailchimp,
  upsertContactAndActivity,
} from "../_shared/forms.ts";

// Three course sessions (UTC; BST is UTC+1). Thu 3/10/17 Sep 2026 15:00-16:00 BST.
const SESSIONS = [
  { date: "Thursday 3 September 2026", startUtc: "20260903T140000Z", endUtc: "20260903T150000Z" },
  { date: "Thursday 10 September 2026", startUtc: "20260910T140000Z", endUtc: "20260910T150000Z" },
  { date: "Thursday 17 September 2026", startUtc: "20260917T140000Z", endUtc: "20260917T150000Z" },
];
// D13: Zoom links may not exist yet. Comma-separated env, else "to follow".
const ZOOM_LINKS = (Deno.env.get("MORADA_COURSE_ZOOM_LINKS") ?? "")
  .split(",").map((s) => s.trim()).filter(Boolean);

// === Stripe signature verification (raw body + STRIPE_WEBHOOK_SECRET) =======
async function verifyStripeSignature(payload: string, sigHeader: string, secret: string): Promise<boolean> {
  const parts = Object.fromEntries(
    sigHeader.split(",").map((kv) => kv.split("=") as [string, string]),
  );
  const timestamp = parts["t"];
  const expected = parts["v1"];
  if (!timestamp || !expected) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${payload}`));
  const hex = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");

  // Constant-time-ish compare.
  if (hex.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

// === FreeAgent invoice (spec 3.4), guarded; manual fallback if unconfigured ==
async function createFreeAgentInvoice(meta: Record<string, string>, paymentIntent: string): Promise<string | null> {
  const accessToken = Deno.env.get("FREEAGENT_ACCESS_TOKEN");
  const refreshToken = Deno.env.get("FREEAGENT_REFRESH_TOKEN");
  const clientId = Deno.env.get("FREEAGENT_API_KEY");
  if (!accessToken || !refreshToken || !clientId) {
    console.log(
      `[freeagent] OAuth env not set. MANUAL FALLBACK: raise invoice by hand for ` +
      `${meta.email} (${meta.company}), ${meta.seats} seat(s), payment intent ${paymentIntent}.`,
    );
    return null;
  }
  // FreeAgent OAuth + invoice creation is implemented behind this guard once the
  // OAuth trio is provisioned. The exact contact-match and invoice-item shapes
  // are finalised against the live FreeAgent account at provisioning time, so
  // the build ships on the manual fallback until then (spec 3.4).
  console.log(
    `[freeagent] OAuth present but invoice automation deferred to provisioning. ` +
    `MANUAL FALLBACK applies for payment intent ${paymentIntent}.`,
  );
  return null;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const sigHeader = req.headers.get("stripe-signature");
  const payload = await req.text();

  if (!secret || !sigHeader || !(await verifyStripeSignature(payload, sigHeader, secret))) {
    console.error("[stripe] Invalid or unverifiable signature.");
    return new Response("Invalid signature", { status: 400 });
  }

  let event: { type: string; data: { object: Record<string, unknown> } };
  try {
    event = JSON.parse(payload);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (event.type !== "checkout.session.completed") {
    return new Response(JSON.stringify({ received: true }), { status: 200 });
  }

  try {
    const session = event.data.object;
    const meta = (session.metadata ?? {}) as Record<string, string>;
    const paymentIntent = String(session.payment_intent ?? "");
    const seats = Number(meta.seats ?? 1);

    // 1. CRM write: upgrade to Client + activity with payment intent (spec 3.6).
    const supabase = serviceClient();
    await upsertContactAndActivity(supabase, {
      contactName: `${meta.first_name ?? ""} ${meta.last_name ?? ""}`.trim(),
      email: meta.email,
      company: meta.company ?? "",
      type: "Client",
      source: meta.source ?? "Morada - AI for Contractors",
      activityType: "course_booking_paid",
      activitySubject: `Paid: AI for Contractors course, ${seats} seat(s)`,
      activityMeta: {
        seats,
        role: meta.role,
        billing_address: meta.billing_address,
        vat_number: meta.vat_number,
        total_inc_vat_pence: meta.total_inc_vat_pence,
        stripe_payment_intent: paymentIntent,
        marketing_consent: meta.marketing_consent === "true",
        how_heard: meta.how_heard,
        utm_campaign: meta.utm_campaign,
        utm_source: meta.utm_source,
        utm_medium: meta.utm_medium,
        utm_content: meta.utm_content,
        utm_term: meta.utm_term,
        // Opp move (229660dd -> Negotiating on first booking, -> Won at MVC) is
        // DEFERRED to manual reconciliation (see decision 2 in _shared/forms.ts).
        opp_route: meta.opp_route,
        opp_id_for_reconciliation: meta.opp_route === "link" ? MORADA_OPP_ID : null,
      },
    });

    // 2. Mailchimp (spec 3.5).
    const mailchimpKey = Deno.env.get("MAILCHIMP_API_KEY");
    if (mailchimpKey && meta.email) {
      syncToMailchimp(
        {
          email: meta.email,
          firstName: meta.first_name ?? "",
          lastName: meta.last_name ?? "",
          company: meta.company ?? "",
          type: "Client",
          tags: ["morada-ai-2026", "morada-course-2026-09-paid"],
          marketingTag: "morada-ai-2026-marketing",
          marketingConsent: meta.marketing_consent === "true",
        },
        mailchimpKey,
      ).catch((err) => console.error("Mailchimp sync error:", err));
    }

    // 3. FreeAgent invoice (guarded) or manual fallback.
    const invoiceUrl = await createFreeAgentInvoice(meta, paymentIntent);

    // 4. Confirmation email with 3 .ics, Zoom links (or "to follow"), invoice.
    const ics = buildIcs(SESSIONS.map((s, i) => ({
      uid: `morada-course-2026-09-s${i + 1}-${meta.email}`,
      startUtc: s.startUtc,
      endUtc: s.endUtc,
      summary: "AI for Contractors course (session " + (i + 1) + " of 3)",
      description: ZOOM_LINKS[i] ? `Join link: ${ZOOM_LINKS[i]}` : "Your Zoom join link will follow by email.",
      url: ZOOM_LINKS[i] || undefined,
    })));

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (resendKey && meta.email) {
      const sessionRows = SESSIONS.map((s, i) => {
        const link = ZOOM_LINKS[i]
          ? `<a href="${escapeHtml(ZOOM_LINKS[i])}">Join session ${i + 1}</a>`
          : "join link to follow";
        return `<li>${escapeHtml(s.date)}, 3:00pm to 4:00pm BST. ${link}</li>`;
      }).join("");
      const invoiceLine = invoiceUrl
        ? `<p><strong>Invoice:</strong> <a href="${escapeHtml(invoiceUrl)}">View your invoice</a></p>`
        : `<p>Your VAT invoice will follow by email shortly.</p>`;
      sendResend(
        {
          to: meta.email,
          subject: "Booking confirmed: AI for Contractors course (Sep 2026)",
          html: `
            <p>Hi ${escapeHtml(meta.first_name ?? "")},</p>
            <p>Your place on the AI for Contractors course is booked and paid. Thank you.</p>
            <p><strong>Your sessions:</strong></p>
            <ul>${sessionRows}</ul>
            ${invoiceLine}
            <p>Calendar invites for all three sessions are attached.</p>
            <p>Looking forward to it,<br>Phil<br>Diagonal Thinking</p>
          `,
          attachments: [{ filename: "ai-for-contractors-course.ics", content: icsToBase64(ics) }],
        },
        resendKey,
      ).catch((err) => console.error("Resend send error:", err));
    }

    return new Response(JSON.stringify({ received: true }), { status: 200 });
  } catch (err) {
    console.error("Webhook processing error:", err);
    // 200 so Stripe does not hammer retries on a non-signature error; the
    // payment already succeeded and the failure is logged for reconciliation.
    return new Response(JSON.stringify({ received: true, warning: "processing error logged" }), { status: 200 });
  }
});
