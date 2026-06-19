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

// === CORS (origin allowlist, SEC-SUP-002 hardening) =========================
//
// B1 fix (2026-06-15): the previous "*" wildcard let any attacker page POST
// cross-origin and spam FreeAgent invoices from Phil's account. We now reflect
// only an allowlisted Origin and NEVER return "*". The DT Squarespace site is
// canonically https://www.diagonalthinking.co (apex 301-redirects to www); the
// apex is allowlisted too as belt-and-braces. A disallowed origin receives the
// canonical host in ACAO, so the browser's CORS check fails and blocks it.

const ALLOWED_ORIGINS = new Set([
  "https://www.diagonalthinking.co",
  "https://diagonalthinking.co",
]);
const DEFAULT_ORIGIN = "https://www.diagonalthinking.co";

export function isOriginAllowed(origin: string | null): boolean {
  return !!origin && ALLOWED_ORIGINS.has(origin);
}

export function buildCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin");
  return {
    "Access-Control-Allow-Origin": isOriginAllowed(origin) ? (origin as string) : DEFAULT_ORIGIN,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

// Safe non-wildcard fallback so no response path can ever regress to "*".
const LOCKED_CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": DEFAULT_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

// === Mailchimp constants (from the live functions) ==========================

export const MAILCHIMP_AUDIENCE_ID = "d89fc8d69c";
export const MAILCHIMP_SERVER = "us8";

// === JSON response helpers ==================================================

export function json(body: unknown, status = 200, cors: Record<string, string> = LOCKED_CORS): Response {
  return new Response(JSON.stringify(body), {
    headers: { ...cors, "Content-Type": "application/json" },
    status,
  });
}

export function ok(extra: Record<string, unknown> = {}, cors: Record<string, string> = LOCKED_CORS): Response {
  return json({ success: true, ...extra }, 200, cors);
}

export function badRequest(error: string, cors: Record<string, string> = LOCKED_CORS): Response {
  return json({ error }, 400, cors);
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
  const raw = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ?? "unknown";
  // Strip to IP-valid chars so an attacker-controlled XFF cannot forge log lines.
  return raw.replace(/[^0-9a-fA-F:.]/g, "").slice(0, 45) || "unknown";
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

// === P0 hardening (Phil 19:02 BST): origin/referer, honeypot, timing, db RL ===

// Server-side Origin + Referer allowlist. Browser CORS is bypassable by curl, so
// we ALSO reject here. Missing Origin -> reject; Referer present but disagreeing
// -> reject. (Absent Referer is allowed: a strict Referrer-Policy can omit it.)
export function originRefererOk(req: Request): boolean {
  const origin = req.headers.get("Origin");
  if (!origin || !isOriginAllowed(origin)) return false;
  const referer = req.headers.get("Referer");
  if (referer) {
    try {
      if (!isOriginAllowed(new URL(referer).origin)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

// Constant-time string compare for secrets (avoids timing oracles).
export function timingSafeEqual(a: string, b: string): boolean {
  const ae = new TextEncoder().encode(a);
  const be = new TextEncoder().encode(b);
  if (ae.length !== be.length) return false;
  let diff = 0;
  for (let i = 0; i < ae.length; i++) diff |= ae[i] ^ be[i];
  return diff === 0;
}

// Honeypot: bots fill hidden fields. Either `website` or `_gotcha` filled = bot.
export function isHoneypotTripped(body: Record<string, unknown>): boolean {
  return !!(body.website && String(body.website).trim()) ||
    !!(body._gotcha && String(body._gotcha).trim());
}

// Timing: real users take >2s to fill the form. `elapsed_ms` is sent by the embed
// (now - page load). Implausibly fast (or absent) = bot.
const MIN_FILL_MS = 2000;
export function tooFast(body: Record<string, unknown>): boolean {
  const elapsed = Number(body.elapsed_ms);
  return !Number.isFinite(elapsed) || elapsed < MIN_FILL_MS;
}

// Persistent sliding-window rate limit (Postgres), survives cold start. Keyed on
// the caller-supplied bucket (e.g. ip + email). Falls back to the in-memory limit
// if the table is unavailable, so there is always SOME limit. 3 per 10 minutes.
// deno-lint-ignore no-explicit-any
export async function checkDbRateLimit(supabase: any, bucket: string): Promise<boolean> {
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
  try {
    const { count, error } = await supabase
      .from("morada_rate_limit")
      .select("id", { count: "exact", head: true })
      .eq("bucket", bucket)
      .gte("created_at", since);
    if (error) throw error;
    if ((count ?? 0) >= RATE_LIMIT_MAX) return false;
    await supabase.from("morada_rate_limit").insert({ bucket });
    return true;
  } catch (e) {
    console.error("[rate-limit] DB unavailable, falling back to in-memory:", e);
    return checkRateLimit(bucket);
  }
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

// Stricter, practical RFC 5322 subset (local-part + dotted domain labels).
export const EMAIL_REGEX =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

export function isDisposableEmail(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  return DISPOSABLE_DOMAINS.has(domain);
}

// Field character classes (P0 hardening, Phil 19:02 BST). Unicode-letter aware
// so legitimate international names (Jose, Muller) and B2B company names are not
// dropped, while blocking the injection/spam vectors: URLs, HTML angle brackets,
// quotes. NAME = letters/digits/space/apostrophe/hyphen. COMPANY additionally
// allows the common business punctuation (. , & ( ) /). NB: this broadens Phil's
// "same character class for company" so real names like "Smith & Co." are not
// rejected - flagged in the closing report.
const NAME_RE = /^[\p{L}\p{N} '\-]{2,80}$/u;
const COMPANY_RE = /^[\p{L}\p{N} .,&()'/\-]{2,120}$/u;
const URLISH = /(https?:\/\/|www\.|<|>|["])/i;

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

// DT-branded transactional email shell (Pix brand pack): navy #305DAB, Oswald
// uppercase logo lockup with a 3px navy strip, Source Sans 3 body (web-safe
// fallbacks for email clients that strip web fonts), em-dash zero.
export function brandedEmail(opts: { heading: string; bodyHtml: string; footer?: string }): string {
  const footer = opts.footer ??
    "Diagonal Thinking Ltd. You are receiving this because you registered or booked with us.";
  return `<div style="margin:0;padding:24px 0;background:#f4f5f7;">
  <div style="max-width:560px;margin:0 auto;background:#FFFFFF;border-radius:8px;overflow:hidden;font-family:'Source Sans 3',Helvetica,Arial,sans-serif;color:#111111;">
    <div style="padding:22px 28px 14px;">
      <span style="font-family:'Oswald',Helvetica,Arial,sans-serif;font-weight:600;font-size:20px;letter-spacing:0.04em;text-transform:uppercase;color:#305DAB;">Diagonal Thinking</span>
      <div style="height:3px;width:64px;background:#305DAB;margin-top:8px;"></div>
    </div>
    <div style="padding:6px 28px 24px;font-size:16px;line-height:1.5;color:#111111;">
      <h1 style="font-family:'Oswald',Helvetica,Arial,sans-serif;font-weight:600;font-size:22px;letter-spacing:0.02em;color:#111111;margin:0 0 14px;">${opts.heading}</h1>
      ${opts.bodyHtml}
    </div>
    <div style="padding:14px 28px;background:#f7f8fb;color:#6b6862;font-size:12px;line-height:1.4;">
      ${footer}
    </div>
  </div>
</div>`;
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
// Honeypot, timing and origin checks are handled separately (pre-validation).
export function validateCommon(f: Partial<CommonFields>): string | null {
  if (!f.first_name || !f.last_name || !f.email || !f.company || !f.role) {
    return "First name, last name, email, business name and role are required.";
  }
  if (f.email.length > 254 || !EMAIL_REGEX.test(f.email)) return "Please enter a valid email address.";
  if (isDisposableEmail(f.email)) return "Please use a real email address.";
  if (!NAME_RE.test(f.first_name) || !NAME_RE.test(f.last_name) ||
      URLISH.test(f.first_name) || URLISH.test(f.last_name)) {
    return "Please enter your real name.";
  }
  if (isGibberishName(`${f.first_name} ${f.last_name}`)) {
    return "Please enter your real name.";
  }
  if (!COMPANY_RE.test(f.company) || URLISH.test(f.company)) {
    return "Please enter a valid business name.";
  }
  if (f.role.length < 1 || f.role.length > 100 || URLISH.test(f.role)) {
    return "Please enter a valid role.";
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

// Add a single service tag to a contact (text[] column) WITHOUT clobbering any
// existing services - read, merge, write. Makes Morada bookings findable under
// the CRM "Service Filter" (App.jsx SERVICE_OPTIONS): "Morada Webinar" for
// webinar registrants, "Morada AI Workshops" for course bookers. Best-effort and
// non-fatal: a tagging hiccup must never fail a registration or a checkout.
// deno-lint-ignore no-explicit-any
export async function addContactService(
  supabase: any,
  email: string,
  service: string,
): Promise<void> {
  const e = email.trim().toLowerCase();
  try {
    const { data, error } = await supabase
      .from("contacts")
      .select("id, services")
      .eq("email", e)
      .maybeSingle();
    if (error || !data?.id) return;
    const current: string[] = Array.isArray(data.services) ? data.services : [];
    if (current.includes(service)) return;
    await supabase
      .from("contacts")
      .update({ services: [...current, service] })
      .eq("id", data.id);
  } catch (err) {
    console.error("addContactService error (non-fatal):", err);
  }
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
  cc?: string | string[]; // optional carbon-copy recipients (e.g. internal cc)
  replyTo?: string; // optional Reply-To header
  attachments?: Array<{ filename: string; content: string }>; // content = base64
}

export async function sendResend(email: ResendEmail, apiKey: string): Promise<void> {
  // deno-lint-ignore no-explicit-any
  const payload: Record<string, any> = {
    from: "Diagonal Thinking <notifications@diagonalthinking.co>",
    to: [email.to],
    subject: email.subject,
    html: email.html,
  };
  if (email.cc) payload.cc = Array.isArray(email.cc) ? email.cc : [email.cc];
  if (email.replyTo) payload.reply_to = email.replyTo;
  if (email.attachments) payload.attachments = email.attachments;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    console.error(`Resend send failed (${res.status}): ${await res.text()}`);
  }
}

// === Internal booking notification (Item 1, Phil 19 Jun 2026) ================
//
// Emails Phil (cc Steve at Morada) for every webinar registration and every paid
// course booking, with the registrant's details and their free-text "what they
// want to get out of it" answer. INDEPENDENT of MORADA_TEST_MODE (see
// emailSuppressed) so the flow is provable before the Stripe live flip.
// Recipients default to the launch addresses; override via env without a code
// change. MORADA_NOTIFY_CC is comma-separated.
export function internalNotifyTo(): string {
  return Deno.env.get("MORADA_NOTIFY_TO") ?? "phil@diagonalthinking.co";
}
export function internalNotifyCc(): string[] {
  const cc = Deno.env.get("MORADA_NOTIFY_CC") ?? "Steven@morada.uk";
  return cc.split(",").map((s) => s.trim()).filter(Boolean);
}

export interface InternalNotify {
  event: string; // "AI for Contractors webinar" | "AI for Contractors course"
  fields: Array<{ label: string; value: string }>;
}

// Plain, scannable internal email. Empty values are dropped. All values escaped.
export function internalNotificationHtml(n: InternalNotify): string {
  const rows = n.fields
    .filter((f) => f.value && f.value.trim())
    .map(
      (f) =>
        `<tr><td style="padding:4px 14px 4px 0;vertical-align:top;color:#6b6862;white-space:nowrap;">${escapeHtml(f.label)}</td>` +
        `<td style="padding:4px 0;vertical-align:top;color:#111111;">${escapeHtml(f.value)}</td></tr>`,
    )
    .join("");
  return brandedEmail({
    heading: `New booking: ${n.event}`,
    bodyHtml:
      `<p>A new registration has come in via the ${escapeHtml(n.event)} form.</p>` +
      `<table style="border-collapse:collapse;font-size:15px;line-height:1.5;">${rows}</table>`,
    footer: "Internal notification from the Diagonal Thinking booking forms.",
  });
}

export async function sendInternalNotification(n: InternalNotify, apiKey: string): Promise<void> {
  await sendResend({
    to: internalNotifyTo(),
    cc: internalNotifyCc(),
    subject: `New ${n.event} booking`,
    html: internalNotificationHtml(n),
  }, apiKey);
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

// The three Sep 2026 course sessions, 15:00-16:00 BST = 14:00-15:00 UTC. Returns
// one multi-event .ics so the attendee gets all three dates in a single invite
// (Item 4, Phil 19 Jun 2026). METHOD:PUBLISH (a "save the slot" invite, no RSVP
// round-trip), consistent with the webinar invite. UID is stable per attendee
// per session so re-sends update rather than duplicate.
export const COURSE_SESSIONS_UTC: Array<{ day: string; startUtc: string; endUtc: string }> = [
  { day: "03", startUtc: "20260903T140000Z", endUtc: "20260903T150000Z" },
  { day: "10", startUtc: "20260910T140000Z", endUtc: "20260910T150000Z" },
  { day: "17", startUtc: "20260917T140000Z", endUtc: "20260917T150000Z" },
];

export function buildCourseIcs(email: string): string {
  return buildIcs(
    COURSE_SESSIONS_UTC.map((s, i) => ({
      uid: `morada-course-2026-09-${s.day}-${email}`,
      startUtc: s.startUtc,
      endUtc: s.endUtc,
      summary: `Diagonal Thinking: AI for Contractors (session ${i + 1} of 3)`,
      description:
        "AI for Contractors course with Diagonal Thinking and Morada. " +
        "Phil will send the joining details and materials before each session.",
    })),
  );
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

// Records an ALREADY-PAID sale as a FreeAgent invoice (for VAT/books). B3
// architecture (Phil 18:32 BST): payment is taken via our own Stripe Checkout,
// so this does NOT enable a FreeAgent online-payment link or email the customer
// a Pay-now button (the customer already paid and gets our thank-you email).
// Creates the invoice and marks it Sent; the Stripe payment intent is recorded
// in the comments for reconciliation. NB: FreeAgent has no API "mark Paid"
// transition - the invoice reconciles when the Stripe payout lands in the
// connected bank feed, or Phil marks it paid manually.
export async function recordFreeAgentInvoice(
  token: string,
  inv: {
    contactUrl: string;
    datedOn: string; // YYYY-MM-DD
    paymentTermsDays: number;
    reference: string;
    comments: string;
    items: FreeAgentInvoiceItem[];
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
  const id = (invoice.url as string).split("/").pop();

  // Mark as sent (Draft -> Sent) so it is a live record on the books.
  await fetch(`${base}/v2/invoices/${id}/transitions/mark_as_sent`, { method: "PUT", headers: faHeaders(token) })
    .catch((e) => console.error("FreeAgent mark_as_sent error:", e));

  return { url: invoice.url as string, reference: invoice.reference as string };
}

// === Stripe Checkout (B3 direct-Stripe payment leg, Phil 18:32 BST) =========
//
// We create the Checkout Session so we own success_url -> our thank-you page.
// Verification is via the Stripe API at return time (instant + reliable),
// unlike FreeAgent which has no early payment signal. Needs STRIPE_SECRET_KEY;
// callers env-guard so the build is inert until the key is provisioned.

export function stripeKey(): string | null {
  return Deno.env.get("STRIPE_SECRET_KEY") ?? null;
}

// MORADA_TEST_MODE (P0 safety kill-switch, Tes 2026-06-15): when "true" the
// functions short-circuit all EXTERNAL side-effects (FreeAgent invoice, customer
// email, Mailchimp) to logged no-ops, while still running validation, CORS,
// honeypot, rate limit, idempotency and CRM/activity writes. Lets Tes run live
// attack probes without touching Phil's books or mailing list; also a post-launch
// kill-switch. Default false.
export function testMode(): boolean {
  return Deno.env.get("MORADA_TEST_MODE") === "true";
}

// Email kill-switch, INDEPENDENT of MORADA_TEST_MODE (Phil 19 Jun 2026). The
// attendee confirmation and the internal notification must send even while the
// form is in test mode, so the end-to-end flow can be proven before the Stripe
// live flip. MORADA_TEST_MODE still suppresses FreeAgent + Mailchimp. Set
// MORADA_SUPPRESS_EMAIL=true only if emails ever need an independent kill.
// Default: emails ON.
export function emailSuppressed(): boolean {
  return Deno.env.get("MORADA_SUPPRESS_EMAIL") === "true";
}

export async function createStripeCheckoutSession(o: {
  key: string;
  successUrl: string;
  cancelUrl: string;
  customerEmail: string;
  lineName: string;
  unitAmountPence: number;
  quantity: number;
  statementDescriptor: string;
  metadata: Record<string, string>;
}): Promise<{ id: string; url: string }> {
  const p = new URLSearchParams();
  p.set("mode", "payment");
  p.set("success_url", o.successUrl);
  p.set("cancel_url", o.cancelUrl);
  p.set("customer_email", o.customerEmail);
  p.set("billing_address_collection", "required");
  // "card" automatically offers Apple Pay / Google Pay in Checkout for eligible
  // browsers; listing those as explicit payment_method_types is invalid and
  // errors the Stripe API, so we only request "card".
  p.set("payment_method_types[0]", "card");
  p.set("line_items[0][quantity]", String(o.quantity));
  p.set("line_items[0][price_data][currency]", "gbp");
  p.set("line_items[0][price_data][unit_amount]", String(o.unitAmountPence));
  p.set("line_items[0][price_data][product_data][name]", o.lineName);
  p.set("payment_intent_data[statement_descriptor]", o.statementDescriptor.slice(0, 22));
  for (const [k, v] of Object.entries(o.metadata)) {
    p.set(`metadata[${k}]`, v);
    p.set(`payment_intent_data[metadata][${k}]`, v);
  }
  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${o.key}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: p.toString(),
  });
  const data = await res.json();
  if (!res.ok || !data.url) {
    throw new Error(`Stripe session create failed (${res.status}): ${JSON.stringify(data).slice(0, 300)}`);
  }
  return { id: data.id as string, url: data.url as string };
}

// Verifies a Checkout Session at thank-you / poll time. paid === payment cleared.
export async function getStripeCheckoutSession(key: string, sessionId: string): Promise<{
  paid: boolean;
  paymentStatus: string;
  paymentIntent: string | null;
  amountTotalPence: number | null;
  customerEmail: string | null;
  metadata: Record<string, string>;
}> {
  const res = await fetch(
    `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
    { headers: { Authorization: `Bearer ${key}` } },
  );
  const d = await res.json();
  if (!res.ok) throw new Error(`Stripe session fetch failed (${res.status}): ${JSON.stringify(d).slice(0, 200)}`);
  const pi = d.payment_intent;
  return {
    paid: d.payment_status === "paid",
    paymentStatus: String(d.payment_status ?? "unknown"),
    paymentIntent: typeof pi === "string" ? pi : (pi?.id ?? null),
    amountTotalPence: typeof d.amount_total === "number" ? d.amount_total : null,
    customerEmail: d.customer_details?.email ?? d.customer_email ?? null,
    metadata: (d.metadata ?? {}) as Record<string, string>,
  };
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

// === Course payment fulfilment (shared by thank-you + safety-net poll) =======
//
// Idempotent on the Stripe session id. Upserts the contact as Client, records
// the FreeAgent invoice (VAT/books, best-effort), applies the paid Mailchimp
// tag, sends the confirmation email once, and writes the paid activity. Both the
// thank-you function (primary) and the poll (safety net for customers who paid
// but did not return) call this after verifying the Stripe session is paid.
const COURSE_LABEL = "AI for Contractors - Sep 2026 beginner cohort (3 sessions)";
const COURSE_NET_PER_SEAT = 300;
const COURSE_VAT_RATE = 20;

// deno-lint-ignore no-explicit-any
export async function fulfillCoursePayment(supabase: any, p: {
  sessionId: string;
  paymentIntent: string;
  meta: Record<string, string>;
  seats: number;
}): Promise<{ already: boolean }> {
  const { sessionId, paymentIntent, meta, seats } = p;
  const email = (meta.email ?? "").toLowerCase().trim();
  const firstName = meta.first_name ?? "";
  const lastName = meta.last_name ?? "";
  const company = meta.company ?? "";
  const seatWord = seats === 1 ? "seat" : "seats";

  const TEST = testMode();

  // 1. Upsert the CRM contact as Client (email-keyed, idempotent). ALWAYS runs
  //    (Tes verifies activity/CRM state even in test mode).
  const { data: contactRow } = await supabase
    .from("contacts")
    .upsert({
      contact_name: `${firstName} ${lastName}`.trim(),
      email,
      company,
      type: "Client",
      source: meta.source ?? "Morada - AI for Contractors",
    }, { onConflict: "email", ignoreDuplicates: false })
    .select("id")
    .maybeSingle();

  // Atomic idempotent claim on the session (UNIQUE stripe_session_id index).
  // If already paid or being fulfilled, stop. Otherwise CLAIM it - flip the
  // booking row pending->fulfilling via a CONDITIONAL update, or insert a
  // fulfilling row - so the FreeAgent invoice + confirmation email fire EXACTLY
  // ONCE even under concurrent thank-you / poll calls for the same session.
  const { data: existing } = await supabase
    .from("contact_activities")
    .select("id, contact_id, status")
    .eq("stripe_session_id", sessionId)
    .maybeSingle();
  if (existing && (existing.status === "paid" || existing.status === "fulfilling")) {
    return { already: true };
  }
  const contactId = existing?.contact_id ?? contactRow?.id ?? null;
  let claimedId: string | null = null;
  if (existing?.id) {
    const { data: claim } = await supabase
      .from("contact_activities")
      .update({ status: "fulfilling" })
      .eq("id", existing.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (!claim) return { already: true }; // another caller claimed it first
    claimedId = existing.id;
  } else {
    // No booking row (e.g. the book-time activity write failed): claim by
    // inserting a unique-session row; a concurrent insert hits the UNIQUE index.
    const { data: ins, error: insErr } = await supabase
      .from("contact_activities")
      .insert({
        contact_id: contactId,
        activity_type: "course_booking_paid",
        subject: `Paid: AI for Contractors course, ${seats} ${seatWord}`,
        stripe_session_id: sessionId,
        status: "fulfilling",
        body: "{}",
      })
      .select("id")
      .maybeSingle();
    if (insErr || !ins) return { already: true }; // UNIQUE violation = lost the race
    claimedId = ins.id;
  }

  // 2. Record the FreeAgent invoice for VAT/books (best-effort, non-fatal).
  //    Skipped in test mode so probes never hit Phil's live books.
  let invoiceUrl: string | null = null;
  let invoiceRef: string | null = null;
  const faCfg = freeAgentConfig();
  if (TEST) {
    console.log(`[test-mode] freeagent: skipped (test mode), would-have-created: {email:${email}, seats:${seats}, intent:${paymentIntent}}`);
  } else if (faCfg) {
    try {
      const token = await freeAgentAccessToken(faCfg);
      const contactUrl = await findOrCreateFreeAgentContact(token, { email, firstName, lastName, company });
      const rec = await recordFreeAgentInvoice(token, {
        contactUrl,
        datedOn: new Date().toISOString().slice(0, 10),
        paymentTermsDays: 0,
        reference: "",
        comments:
          `Paid via Stripe Checkout (payment intent ${paymentIntent}). ` +
          `Billing: ${meta.billing_address ?? ""}${meta.vat_number ? ` | VAT: ${meta.vat_number}` : ""}`,
        items: [{
          description: `${COURSE_LABEL} - ${seats} ${seatWord}`,
          quantity: seats,
          price: COURSE_NET_PER_SEAT,
          sales_tax_rate: COURSE_VAT_RATE,
        }],
      });
      invoiceUrl = rec.url;
      invoiceRef = rec.reference;
    } catch (e) {
      // Money taken but invoice failed: loud marker for manual reconciliation
      // (the manual-invoice fallback). Durable auto-retry is a tracked follow-up.
      console.error(`[fulfil][RECONCILE] FreeAgent invoice FAILED for paid session ${sessionId} (intent ${paymentIntent}, ${email}) - raise it by hand:`, e);
    }
  } else {
    console.log(`[fulfil] FreeAgent not provisioned; invoice deferred for ${email} (intent ${paymentIntent}).`);
  }

  // 3. Mailchimp: Client + paid tag. Skipped in test mode (no live-list pollution).
  const mailchimpKey = Deno.env.get("MAILCHIMP_API_KEY");
  if (TEST) {
    console.log(`[test-mode] mailchimp: skipped, would-have-tagged: ${email} morada-course-2026-09-paid`);
  } else if (mailchimpKey && email) {
    await syncToMailchimp({
      email, firstName, lastName, company, type: "Client",
      tags: ["morada-ai-2026", "morada-course-2026-09-paid"],
      marketingTag: "morada-ai-2026-marketing",
      marketingConsent: meta.marketing_consent === "true",
    }, mailchimpKey).catch((e) => console.error("[fulfil] mailchimp error:", e));
  }

  // 4. Emails (once). DECOUPLED from MORADA_TEST_MODE (Phil 19 Jun 2026): the
  //    confirmation + internal notification send even in test mode so the flow is
  //    provable before the Stripe live flip. Independent kill = MORADA_SUPPRESS_EMAIL.
  //    The confirmation carries the 3-session .ics invite (Item 4).
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (resendKey && email && !emailSuppressed()) {
    await sendResend({
      to: email,
      subject: "Payment received: AI for Contractors course",
      html: brandedEmail({
        heading: "Payment received",
        bodyHtml:
          `<p>Hi ${escapeHtml(firstName)},</p>` +
          `<p>Thanks, your payment has been received and your place on the AI for Contractors course is confirmed.</p>` +
          `<p>Your three sessions are Thursdays 3, 10 and 17 September 2026, 3:00pm to 4:00pm BST. ` +
          `A calendar invite for all three is attached so you do not lose the slots.</p>` +
          `<p>Phil will be in touch with the joining details and course materials before each session.</p>` +
          `<p>See you there,<br>Phil<br>Diagonal Thinking</p>`,
      }),
      attachments: [{ filename: "ai-for-contractors-course.ics", content: icsToBase64(buildCourseIcs(email)) }],
    }, resendKey).catch((e) => console.error("[fulfil] resend error:", e));

    // Item 1: internal notification to Phil (cc Steve). Course details + takeaway.
    await sendInternalNotification({
      event: "AI for Contractors course",
      fields: [
        { label: "Name", value: `${firstName} ${lastName}`.trim() },
        { label: "Email", value: email },
        { label: "Company", value: company },
        { label: "Role", value: meta.role ?? "" },
        { label: "Seats", value: String(seats) },
        { label: "Total (inc VAT)", value: meta.total_inc_vat ? `GBP ${meta.total_inc_vat}` : "" },
        { label: "Billing address", value: meta.billing_address ?? "" },
        { label: "VAT number", value: meta.vat_number ?? "" },
        { label: "How heard", value: meta.how_heard ?? "" },
        { label: "Looking to get out of it", value: meta.takeaway ?? "" },
        { label: "Marketing consent", value: meta.marketing_consent === "true" ? "Yes" : "No" },
        { label: "Campaign", value: meta.utm_campaign ?? "" },
        { label: "Stripe payment intent", value: paymentIntent },
      ],
    }, resendKey).catch((e) => console.error("[fulfil] internal notify error:", e));
  } else {
    console.log(`[fulfil] email send skipped (suppressed=${emailSuppressed()}, key=${!!resendKey}) for ${email}`);
  }

  // 5. Finalize the claimed row -> paid (only the claimer reaches here).
  const paidBody = JSON.stringify({
    ...meta,
    stripe_session_id: sessionId,
    stripe_payment_intent: paymentIntent,
    freeagent_invoice_url: invoiceUrl,
    freeagent_reference: invoiceRef,
    confirmation_sent: true,
  });
  await supabase.from("contact_activities")
    .update({ status: "paid", activity_type: "course_booking_paid", body: paidBody, stripe_session_id: sessionId })
    .eq("id", claimedId)
    .then(() => {}).catch((e: unknown) => console.error("[fulfil] activity finalize error:", e));

  return { already: false };
}

// === GA4 Measurement Protocol (server-side purchase fallback) ===============
//
// The customer now returns to our thank-you page, so the primary GA4 `purchase`
// fires CLIENT-SIDE there (deduped on session id). This server-side Measurement
// Protocol path is a fallback for the safety-net poll (a customer who paid but
// never returned), used only if GA4_MEASUREMENT_ID + GA4_API_SECRET are set.
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
