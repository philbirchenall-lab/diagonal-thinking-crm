// Shared module for the Morada / Steve "AI for Contractors" launch forms.
//
// Built once, reused by both edge functions:
//   - morada-webinar-register      (Form 1, free webinar)
//   - morada-course-book           (Form 2, paid course)
//   - morada-course-stripe-webhook (Form 2, post-payment chain)
//
// ARCHITECTURE DECISION 1 (Rex, 2026-06-15) - canonical backend.
//   These are Supabase Edge Functions, NOT Vercel /api routes. The live DT
//   marketing forms (supabase/functions/contact-form, register-interest) are
//   Edge Functions posted to from the Squarespace site. The repo's /api routes
//   serve the CRM app itself, not public site forms, and no migration of site
//   forms onto Vercel exists. Matching the Supabase pattern keeps consistency
//   and lets both forms share this module. (Resolves spec section 1.1 / 5.)
//
// Everything here is derived from the live precedent functions so behaviour
// stays identical where the spec asks for parity (CORS, spam layers, Mailchimp
// merge fields, service-role client).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// === CORS (parity with live functions) ======================================

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// === Mailchimp constants (from the live functions) ==========================

export const MAILCHIMP_AUDIENCE_ID = "d89fc8d69c";
export const MAILCHIMP_SERVER = "us8";

// === JSON response helpers ==================================================

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

export function ok(extra: Record<string, unknown> = {}): Response {
  return json({ success: true, ...extra }, 200);
}

export function badRequest(error: string): Response {
  return json({ error }, 400);
}

// === Layer 3: IP rate limiting (3 per 10 minutes), in-memory ================

interface RateLimitEntry {
  count: number;
  resetAt: number;
}
const rateLimitMap = new Map<string, RateLimitEntry>();
const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

export function getClientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

export function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  // Probabilistic cleanup of expired entries (~10% of requests).
  if (Math.random() < 0.1) {
    for (const [key, entry] of rateLimitMap.entries()) {
      if (now > entry.resetAt) rateLimitMap.delete(key);
    }
  }
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

// === Layer 2: content validation (parity with live functions) ===============

const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com",
  "guerrillamail.com", "guerrillamail.net", "guerrillamail.org",
  "guerrillamail.biz", "guerrillamail.de", "guerrillamailblock.com",
  "grr.la", "sharklasers.com", "spam4.me",
  "trashmail.com", "trashmail.at", "trashmail.io", "trashmail.me",
  "maildrop.cc", "dispostable.com", "fakeinbox.com", "tempinbox.com",
  "10minutemail.com", "minutemail.com", "spamgourmet.com",
  "getairmail.com", "throwaway.email", "tempr.email", "discard.email",
  "mailnesia.com", "mailnull.com", "crap.email", "yopmail.com",
  "tempmail.com", "temp-mail.org", "throwam.com", "spamex.com",
  "spamfree24.org", "binkmail.com", "mailexpire.com", "filzmail.com",
  "mytrashmail.com", "getonemail.com", "mt2015.com",
]);

export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isDisposableEmail(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  return DISPOSABLE_DOMAINS.has(domain);
}

export function isGibberishName(name: string): boolean {
  const words = name.trim().split(/[\s\-']+/).filter((w) => w.length > 0);
  for (const word of words) {
    if (word.length < 2) continue;
    if (/^(mc|mac|de|von|le|la|o'?)/i.test(word)) continue;
    const nonLeading = word.slice(1);
    if (/[A-Z]{4,}/.test(nonLeading)) return true;
    const nonLeadingUpperCount = (nonLeading.match(/[A-Z]/g) ?? []).length;
    if (nonLeadingUpperCount >= 3) return true;
  }
  return false;
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

// === Shared field validation for the Morada forms ===========================

export interface CommonFields {
  first_name: string;
  last_name: string;
  email: string;
  company: string;
  role: string;
}

// Runs the shared spam + format gates. Returns an error string, or null if OK.
// Callers handle the honeypot and rate limit separately (cheap, pre-parse).
export function validateCommon(f: Partial<CommonFields>): string | null {
  if (!f.first_name || !f.last_name || !f.email || !f.company || !f.role) {
    return "First name, last name, email, business name and role are required.";
  }
  if (!EMAIL_REGEX.test(f.email)) return "Please enter a valid email address.";
  if (isDisposableEmail(f.email)) return "Please use a real email address.";
  if (isGibberishName(`${f.first_name} ${f.last_name}`)) {
    return "Please enter your real name.";
  }
  return null;
}

// === UTM capture (spec 1.5) ================================================

export interface Utm {
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
}

export function parseUtm(body: Record<string, unknown>): Utm {
  const get = (k: string) => {
    const v = body[k];
    return typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : null;
  };
  return {
    utm_source: get("utm_source"),
    utm_medium: get("utm_medium"),
    utm_campaign: get("utm_campaign"),
    utm_content: get("utm_content"),
    utm_term: get("utm_term"),
  };
}

// Maps a utm_campaign value to the source label stored on the contact row,
// and to the opp routing decision (spec 1.5 / 1.6).
//   Routes A, B, C link to opp 229660dd; route D creates a new opp.
// NB: opp linkage is DEFERRED to manual reconciliation in v1 (see decision 2
// in upsertContactAndActivity). This map records the intended route so the
// reconciliation is deterministic.
export const MORADA_OPP_ID = "229660dd";

export function routeFromUtm(utm: Utm): { source: string; oppRoute: "link" | "new" } {
  switch (utm.utm_campaign) {
    case "wave_a_webinar_followup":
      return { source: "Morada - Webinar follow-up", oppRoute: "link" };
    case "wave_b_steve_email_direct":
      return { source: "Morada - Steve email", oppRoute: "link" };
    case "wave_c_morada_newsletter":
      return { source: "Morada - Newsletter", oppRoute: "link" };
    case "wave_d_dt_inbound":
      return { source: "DT inbound", oppRoute: "new" };
    default:
      return { source: "Morada - AI for Contractors", oppRoute: "new" };
  }
}

// === Supabase service-role client (parity with live functions) ==============

export function serviceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
}

// === CRM write (spec 1.6) ===================================================
//
// ARCHITECTURE DECISION 2 (Rex, 2026-06-15) - CRM write path.
//   The richer canonical path Mae described (six-gate dedup + Gmail-scrape gate
//   + automatic opp move) does NOT exist anywhere in the repo. The live forms
//   do a single email-keyed `contacts` upsert. So v1 here:
//     - Email-keyed UPSERT on `contacts` (UPDATE-or-INSERT). This IS the dedup;
//       it satisfies acceptance criterion 6 (no duplicate contact row).
//     - WRITE a `contact_activities` row (the table exists and is used by the
//       proposal flows). Non-blocking, so a failure never breaks registration.
//       UTM + role + how-heard + takeaway are stored in the activity body as
//       JSON, giving Phil an audit trail and deterministic attribution.
//     - Opp 229660dd linkage / stage move is DEFERRED to manual reconciliation.
//       There is no code path, no opportunities schema in migrations, and the
//       opp was created manually by Sol. Mutating the pipeline from a public
//       form without that precedent is the wrong risk to take at v1. The
//       activity row carries utm_campaign so Sol/Mae can reconcile by hand.
//   (Resolves spec section 1.6 / reconciliation flag.)

export interface CrmWrite {
  contactName: string;
  email: string;
  company: string;
  type: string; // "Warm Lead" (Form 1) | "Client" (Form 2)
  source: string;
  phone?: string | null;
  activityType: string; // "webinar_registration" | "course_invoice_created" | "course_booking_paid"
  activitySubject: string;
  activityMeta: Record<string, unknown>; // UTM, role, how-heard, takeaway, invoice url...
  activityStatus?: string; // "received" (default) | "pending" (awaiting payment) | "paid"
}

// deno-lint-ignore no-explicit-any
export async function upsertContactAndActivity(
  supabase: any,
  w: CrmWrite,
): Promise<{ contactError: unknown }> {
  const email = w.email.trim().toLowerCase();

  const { data: contactRow, error: contactError } = await supabase
    .from("contacts")
    .upsert(
      {
        contact_name: w.contactName.trim(),
        email,
        company: w.company.trim(),
        phone: w.phone ? w.phone.trim() : null,
        type: w.type,
        source: w.source,
      },
      { onConflict: "email", ignoreDuplicates: false },
    )
    .select("id")
    .maybeSingle();

  if (contactError) {
    console.error("Supabase contact upsert error:", contactError);
    return { contactError };
  }

  // Non-blocking activity write (matches the live "enquiries" fire-and-forget).
  const contactId = contactRow?.id ?? null;
  if (contactId) {
    supabase
      .from("contact_activities")
      .insert({
        contact_id: contactId,
        activity_type: w.activityType,
        subject: w.activitySubject,
        body: JSON.stringify(w.activityMeta),
        status: w.activityStatus ?? "received",
      })
      .then(() => {})
      .catch((err: unknown) => console.error("contact_activities insert error:", err));
  }

  return { contactError: null };
}

// === Mailchimp sync + tagging (spec 1.3) ===================================

export async function subscriberHash(email: string): Promise<string> {
  const normalized = email.toLowerCase().trim();
  const msgBuffer = new TextEncoder().encode(normalized);
  const hashBuffer = await crypto.subtle.digest("MD5", msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface MailchimpSync {
  email: string;
  firstName: string;
  lastName: string;
  company: string;
  type: string; // merge field TYPE
  tags: string[]; // event tags, always applied
  marketingTag?: string | null; // applied only when consent is true
  marketingConsent: boolean;
}

// Upserts the member (merge fields) then applies tags. The live functions only
// wrote merge_fields; the spec asks us to add tagging (the member tags endpoint).
export async function syncToMailchimp(m: MailchimpSync, apiKey: string): Promise<void> {
  const email = m.email.toLowerCase().trim();
  const hash = await subscriberHash(email);
  const base = `https://${MAILCHIMP_SERVER}.api.mailchimp.com/3.0/lists/${MAILCHIMP_AUDIENCE_ID}/members/${hash}`;
  const auth = `Basic ${btoa(`anystring:${apiKey}`)}`;

  const memberRes = await fetch(base, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: auth },
    body: JSON.stringify({
      email_address: email,
      status_if_new: "subscribed",
      merge_fields: {
        FNAME: m.firstName,
        LNAME: m.lastName,
        COMPANY: m.company,
        TYPE: m.type,
      },
    }),
  });
  if (!memberRes.ok) {
    console.error(`Mailchimp member sync failed (${memberRes.status}): ${await memberRes.text()}`);
    return;
  }

  // Event tags are always applied; the marketing tag only on consent.
  const tags = m.tags.map((name) => ({ name, status: "active" as const }));
  if (m.marketingConsent && m.marketingTag) {
    tags.push({ name: m.marketingTag, status: "active" as const });
  }
  if (tags.length === 0) return;

  const tagRes = await fetch(`${base}/tags`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: auth },
    body: JSON.stringify({ tags }),
  });
  if (!tagRes.ok) {
    console.error(`Mailchimp tag apply failed (${tagRes.status}): ${await tagRes.text()}`);
  }
}

// === Resend transactional email (spec 2.2 / 3.5) ============================

export interface ResendEmail {
  to: string;
  subject: string;
  html: string;
  attachments?: Array<{ filename: string; content: string }>; // content = base64
}

export async function sendResend(email: ResendEmail, apiKey: string): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      from: "Diagonal Thinking <notifications@diagonalthinking.co>",
      to: [email.to],
      subject: email.subject,
      html: email.html,
      attachments: email.attachments,
    }),
  });
  if (!res.ok) {
    console.error(`Resend send failed (${res.status}): ${await res.text()}`);
  }
}

// === .ics calendar generation (spec 2.2 / 3.5) =============================
//
// Times are passed in as UTC. The Morada events are BST (UTC+1):
//   Webinar:  Mon 20 Jul 2026 15:00-16:00 BST = 14:00-15:00 UTC
//   Course:   Thu 3/10/17 Sep 2026 15:00-16:00 BST = 14:00-15:00 UTC

export interface IcsEvent {
  uid: string;
  startUtc: string; // "20260720T140000Z"
  endUtc: string; // "20260720T150000Z"
  summary: string;
  description: string;
  url?: string;
  dtstamp?: string; // defaults to start
}

function icsEscape(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

export function buildIcs(events: IcsEvent[]): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Diagonal Thinking//Morada AI for Contractors//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];
  for (const e of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}`,
      `DTSTAMP:${e.dtstamp ?? e.startUtc}`,
      `DTSTART:${e.startUtc}`,
      `DTEND:${e.endUtc}`,
      `SUMMARY:${icsEscape(e.summary)}`,
      `DESCRIPTION:${icsEscape(e.description)}`,
    );
    if (e.url) lines.push(`URL:${e.url}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  // RFC 5545 requires CRLF line endings.
  return lines.join("\r\n");
}

export function icsToBase64(ics: string): string {
  return btoa(unescape(encodeURIComponent(ics)));
}

// === FreeAgent API (Form 2 payment leg, post-pivot 15 Jun 2026) =============
//
// Phil's locked architecture: the form creates a FreeAgent invoice with online
// payment enabled; FreeAgent emails the customer a "Pay now" button (Stripe
// connected inside FreeAgent); a scheduled poll detects when the invoice is
// Paid and fires our confirmation email. NO direct Stripe code, NO Stripe keys.
//
// FreeAgent has NO webhooks (verified against dev.freeagent.com + the API forum,
// Jun 2026), which is why payment is detected by polling, not a webhook.
//
// OAuth: FreeAgent access tokens are short-lived, refresh tokens long-lived. We
// always mint a fresh access token from the refresh token at call time, which is
// more robust than storing a token that expires. Required env:
//   FREEAGENT_CLIENT_ID, FREEAGENT_CLIENT_SECRET, FREEAGENT_REFRESH_TOKEN
//   FREEAGENT_BASE_URL (optional; defaults to production)
// NB: this refines Tes's original env list (API_KEY / ACCESS_TOKEN / REFRESH).
// CLIENT_ID maps to the old "API key"; CLIENT_SECRET is additionally required
// for the refresh grant; the stored ACCESS_TOKEN is not needed (we refresh).

export function freeAgentBaseUrl(): string {
  return Deno.env.get("FREEAGENT_BASE_URL") ?? "https://api.freeagent.com";
}

export interface FreeAgentConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

// Returns the config if all three vars are present, else null (caller falls back
// to the manual-invoice path and logs it).
export function freeAgentConfig(): FreeAgentConfig | null {
  const clientId = Deno.env.get("FREEAGENT_CLIENT_ID") ?? Deno.env.get("FREEAGENT_API_KEY");
  // Accept FREEAGENT_OAUTH_SECRET as an alias (the name used during provisioning).
  const clientSecret = Deno.env.get("FREEAGENT_CLIENT_SECRET") ?? Deno.env.get("FREEAGENT_OAUTH_SECRET");
  const refreshToken = Deno.env.get("FREEAGENT_REFRESH_TOKEN");
  if (!clientId || !clientSecret || !refreshToken) return null;
  return { clientId, clientSecret, refreshToken };
}

export async function freeAgentAccessToken(cfg: FreeAgentConfig): Promise<string> {
  const res = await fetch(`${freeAgentBaseUrl()}/v2/token_endpoint`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${cfg.clientId}:${cfg.clientSecret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: cfg.refreshToken }).toString(),
  });
  if (!res.ok) throw new Error(`FreeAgent token refresh failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  return data.access_token as string;
}

function faHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": "DiagonalThinkingCRM (phil@diagonalthinking.co)",
  };
}

// Dedup on email: search the first page of contacts and match. Volume is low
// (a single course cohort), so one page is sufficient. Returns the contact URL.
export async function findOrCreateFreeAgentContact(
  token: string,
  c: { email: string; firstName: string; lastName: string; company: string },
): Promise<string> {
  const base = freeAgentBaseUrl();
  const email = c.email.toLowerCase().trim();

  const listRes = await fetch(`${base}/v2/contacts?view=all&per_page=100`, { headers: faHeaders(token) });
  if (listRes.ok) {
    const { contacts = [] } = await listRes.json();
    const hit = contacts.find((x: { email?: string }) => (x.email ?? "").toLowerCase().trim() === email);
    if (hit?.url) return hit.url;
  }

  const createRes = await fetch(`${base}/v2/contacts`, {
    method: "POST",
    headers: faHeaders(token),
    body: JSON.stringify({
      contact: {
        first_name: c.firstName,
        last_name: c.lastName,
        organisation_name: c.company,
        email,
      },
    }),
  });
  if (!createRes.ok) throw new Error(`FreeAgent contact create failed (${createRes.status}): ${await createRes.text()}`);
  const { contact } = await createRes.json();
  return contact.url as string;
}

export interface FreeAgentInvoiceItem {
  description: string;
  quantity: number;
  price: number; // net unit price ex-VAT
  sales_tax_rate: number; // e.g. 20
}

// Creates the invoice with Stripe online payment enabled, marks it as sent, and
// emails it to the customer with the online payment link. Returns the invoice
// URL + reference. The send_email step is best-effort: if FreeAgent's email
// schema differs on the live account, the invoice is still created and sent
// (status Sent), and Phil can resend from FreeAgent. Verify on provisioning.
export async function createAndSendFreeAgentInvoice(
  token: string,
  inv: {
    contactUrl: string;
    datedOn: string; // YYYY-MM-DD
    paymentTermsDays: number;
    reference: string;
    comments: string;
    items: FreeAgentInvoiceItem[];
    toEmail: string;
    emailSubject: string;
    emailBody: string; // include the [online_payment_link] tag for the pay button
  },
): Promise<{ url: string; reference: string }> {
  const base = freeAgentBaseUrl();

  const createRes = await fetch(`${base}/v2/invoices`, {
    method: "POST",
    headers: faHeaders(token),
    body: JSON.stringify({
      invoice: {
        contact: inv.contactUrl,
        dated_on: inv.datedOn,
        payment_terms_in_days: inv.paymentTermsDays,
        currency: "GBP",
        reference: inv.reference,
        comments: inv.comments,
        payment_methods: { stripe: true },
        invoice_items: inv.items.map((it) => ({
          description: it.description,
          item_type: "Services",
          quantity: it.quantity,
          price: it.price,
          sales_tax_rate: it.sales_tax_rate,
        })),
      },
    }),
  });
  if (!createRes.ok) throw new Error(`FreeAgent invoice create failed (${createRes.status}): ${await createRes.text()}`);
  const { invoice } = await createRes.json();
  const invoiceUrl = invoice.url as string;
  const id = invoiceUrl.split("/").pop();

  // Mark as sent (Draft -> Sent) so the status can progress to Paid.
  await fetch(`${base}/v2/invoices/${id}/transitions/mark_as_sent`, { method: "PUT", headers: faHeaders(token) })
    .catch((e) => console.error("FreeAgent mark_as_sent error:", e));

  // Email the invoice with the online payment link (best-effort).
  await fetch(`${base}/v2/invoices/${id}/send_email`, {
    method: "POST",
    headers: faHeaders(token),
    body: JSON.stringify({
      invoice: { email: { to: inv.toEmail, subject: inv.emailSubject, body: inv.emailBody } },
    }),
  }).then(async (r) => {
    if (!r.ok) console.error(`FreeAgent send_email non-OK (${r.status}): ${await r.text()}`);
  }).catch((e) => console.error("FreeAgent send_email error:", e));

  return { url: invoiceUrl, reference: invoice.reference as string };
}

// Reads invoice status for the poll.
//
// VERIFIED 15 Jun 2026 against the live FreeAgent account: FreeAgent exposes NO
// early "payment received" signal. After a customer pays via the Stripe link the
// invoice stays "Open" with paid_value 0 until the Stripe payout settles and
// FreeAgent reconciles the bank transaction (up to a week later), at which point
// `status` flips to "Paid". There is no payment_at_url_status field and no
// webhook. So the poll is INTERNAL bookkeeping only: it marks the CRM record
// paid once FreeAgent reconciles. The customer is told what happens at booking
// time (the invoice email) and gets Stripe's own receipt on payment, so there is
// no DT payment-confirmation email. (See morada-course-poll-paid + build notes.)
export async function getFreeAgentInvoice(
  token: string,
  invoiceUrl: string,
): Promise<{ status: string; paidOn: string | null; permalink: string | null }> {
  const res = await fetch(invoiceUrl, { headers: faHeaders(token) });
  if (!res.ok) throw new Error(`FreeAgent invoice fetch failed (${res.status}): ${await res.text()}`);
  const { invoice } = await res.json();
  return {
    status: invoice.status ?? "Unknown",
    paidOn: invoice.paid_on ?? null,
    permalink: invoice.permalink ?? null,
  };
}

// === GA4 Measurement Protocol (server-side purchase, spec 3.7) ==============
//
// The real purchase happens off-site (Stripe inside FreeAgent), so the customer
// never returns to our page and a client-side `purchase` cannot fire. The poll
// sends `purchase` server-side via Measurement Protocol when an invoice is Paid,
// IF these are set (else skipped, documented): GA4_MEASUREMENT_ID, GA4_API_SECRET.
export async function ga4Purchase(p: {
  clientId: string; // a stable id; we use the invoice reference
  transactionId: string;
  value: number;
  campaign: string;
  items: Array<{ item_name: string; quantity: number; price: number }>;
}): Promise<void> {
  const mid = Deno.env.get("GA4_MEASUREMENT_ID");
  const secret = Deno.env.get("GA4_API_SECRET");
  if (!mid || !secret) {
    console.log("[ga4] Measurement Protocol not configured; skipping server-side purchase event.");
    return;
  }
  const res = await fetch(
    `https://www.google-analytics.com/mp/collect?measurement_id=${mid}&api_secret=${secret}`,
    {
      method: "POST",
      body: JSON.stringify({
        client_id: p.clientId,
        events: [{
          name: "purchase",
          params: {
            transaction_id: p.transactionId,
            value: p.value,
            currency: "GBP",
            campaign: p.campaign,
            items: p.items,
          },
        }],
      }),
    },
  );
  if (!res.ok) console.error(`GA4 MP purchase failed (${res.status}): ${await res.text()}`);
}
