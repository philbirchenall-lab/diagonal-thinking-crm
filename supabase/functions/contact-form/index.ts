import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── CORS allowlist ──────────────────────────────────────────────────────────
// SEC-SUP-002 (2026-04-30): tightened from `*` to the Squarespace marketing
// origin(s). Squarespace serves the public site from both apex and www.
// If a future origin is added (e.g. a staging subdomain or a Vercel-hosted
// landing page), append it to ALLOWED_ORIGINS — do not loosen back to `*`.
const ALLOWED_ORIGINS = new Set<string>([
  "https://diagonalthinking.co",
  "https://www.diagonalthinking.co",
]);

function buildCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  // If origin is in the allowlist, echo it back. Otherwise, do not set
  // Allow-Origin at all — browsers will then block the response. We still
  // emit the other CORS headers so the preflight format is well-formed.
  const allowOrigin = ALLOWED_ORIGINS.has(origin) ? origin : "";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  if (allowOrigin) {
    headers["Access-Control-Allow-Origin"] = allowOrigin;
  }
  return headers;
}

function isOriginAllowed(req: Request): boolean {
  const origin = req.headers.get("origin");
  // Browsers always send Origin on cross-origin POSTs. If it is missing on
  // a POST, the request is almost certainly not from a real browser form
  // submission — reject. (The Edge Function URL is not meant to be hit
  // server-to-server by anyone outside DT.)
  if (!origin) return false;
  return ALLOWED_ORIGINS.has(origin);
}

const MAILCHIMP_AUDIENCE_ID = "d89fc8d69c";
const MAILCHIMP_SERVER = "us8";

// ─── Layer 3: IP-based Rate Limiting (persistent) ────────────────────────────
// SEC-SUP-002 (2026-04-30): rate-limit state moved from an in-memory Map to
// the Postgres `contact_form_rate_limits` table so it survives cold starts.
// The Edge Function uses the service-role client which bypasses RLS.
//
// Strategy: one row per (ip, window_started_at). On each request:
//   1. Look up the most recent row for this IP.
//   2. If it is within the current window AND count >= MAX → reject.
//   3. Otherwise upsert: bump count if same window, else insert a new row
//      with count = 1.
//
// On a Postgres error we fail OPEN (log + allow), to avoid taking the form
// down if the rate-limit table is briefly unavailable. Layered defences
// (honeypot, gibberish, disposable, CORS) still apply.

const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

function getClientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

async function checkRateLimit(
  supabase: SupabaseClient,
  ip: string
): Promise<boolean> {
  const now = new Date();
  const windowFloor = new Date(now.getTime() - RATE_LIMIT_WINDOW_MS);

  // Look up the most recent row for this IP that is still inside the window.
  const { data: existing, error: selectError } = await supabase
    .from("contact_form_rate_limits")
    .select("ip, window_started_at, count")
    .eq("ip", ip)
    .gte("window_started_at", windowFloor.toISOString())
    .order("window_started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (selectError) {
    // Fail-open on storage errors. We log so Hex can spot a regression. The
    // rest of the layered defences (honeypot, gibberish, disposable, CORS)
    // continue to apply.
    console.error("[rate-limit] select error, failing open:", selectError);
    return true;
  }

  if (!existing) {
    // No active window — start a new one.
    const { error: insertError } = await supabase
      .from("contact_form_rate_limits")
      .insert({
        ip,
        window_started_at: now.toISOString(),
        count: 1,
        last_seen_at: now.toISOString(),
      });
    if (insertError) {
      console.error("[rate-limit] insert error, failing open:", insertError);
    }
    return true;
  }

  if (existing.count >= RATE_LIMIT_MAX) {
    return false;
  }

  // Increment the existing window.
  const { error: updateError } = await supabase
    .from("contact_form_rate_limits")
    .update({
      count: existing.count + 1,
      last_seen_at: now.toISOString(),
    })
    .eq("ip", existing.ip)
    .eq("window_started_at", existing.window_started_at);

  if (updateError) {
    console.error("[rate-limit] update error, failing open:", updateError);
  }
  return true;
}

// ─── Layer 2: Content Validation ─────────────────────────────────────────────

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

function isDisposableEmail(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  return DISPOSABLE_DOMAINS.has(domain);
}

function isGibberishName(name: string): boolean {
  // Split on spaces, hyphens, and apostrophes to handle compound names
  const words = name.trim().split(/[\s\-']+/).filter((w) => w.length > 0);

  for (const word of words) {
    if (word.length < 2) continue;

    // Skip words with common surname prefixes (Mc, Mac, De, Von, Le, La, O')
    if (/^(mc|mac|de|von|le|la|o'?)/i.test(word)) continue;

    const nonLeading = word.slice(1);

    // 4+ consecutive uppercase in the non-leading portion = gibberish
    if (/[A-Z]{4,}/.test(nonLeading)) return true;

    // 3+ scattered uppercase in non-leading portion = random casing
    const nonLeadingUpperCount = (nonLeading.match(/[A-Z]/g) ?? []).length;
    if (nonLeadingUpperCount >= 3) return true;
  }

  return false;
}

function isSpamMessage(message: string): boolean {
  const trimmed = message.trim();
  if (trimmed.length < 10) return true;
  if (trimmed.length > 15 && !trimmed.includes(" ")) return true;
  return false;
}

// ─── CSRF token ──────────────────────────────────────────────────────────────
// SEC-SUP-002 deferral note (2026-04-30): a CSRF/anti-replay nonce is the
// largest piece of the SUP-002 fix and requires a coordinated change to the
// Squarespace embed (which lives in Squarespace, not in this repo). Hex
// approved deferring it to a follow-up PR so CORS + persistent rate limit
// can ship today. Tracker: see PR body and risk register SUP-002.

// HTML Escaping (for Resend email template)

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, '&#x27;');
}

// ─── Mailchimp Helper ────────────────────────────────────────────────────────

async function subscriberHash(email: string): Promise<string> {
  const normalized = email.toLowerCase().trim();
  const msgBuffer = new TextEncoder().encode(normalized);
  const hashBuffer = await crypto.subtle.digest("MD5", msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function syncToMailchimp(
  email: string,
  name: string,
  company: string,
  apiKey: string
): Promise<void> {
  const hash = await subscriberHash(email);
  const url = `https://${MAILCHIMP_SERVER}.api.mailchimp.com/3.0/lists/${MAILCHIMP_AUDIENCE_ID}/members/${hash}`;

  const parts = name.trim().split(/\s+/);
  const fname = parts[0] ?? "";
  const lname = parts.slice(1).join(" ");

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${btoa(`anystring:${apiKey}`)}`,
    },
    body: JSON.stringify({
      email_address: email.toLowerCase().trim(),
      status_if_new: "subscribed",
      merge_fields: {
        FNAME: fname,
        LNAME: lname,
        COMPANY: company ?? "",
        TYPE: "Enquiry",
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`Mailchimp sync failed (${res.status}): ${err}`);
  } else {
    console.log(`Mailchimp sync OK for ${email}`);
  }
}

// ─── Main Handler ────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  const corsHeaders = buildCorsHeaders(req);

  if (req.method === "OPTIONS") {
    // Preflight. If origin is not allowed we still respond 204 but without
    // the Allow-Origin header — the browser will then block the actual POST.
    return new Response(null, { headers: corsHeaders, status: 204 });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 405 }
    );
  }

  // SEC-SUP-002: server-side origin enforcement. Browsers enforce CORS on
  // their side via the Allow-Origin header, but a non-browser caller (curl,
  // bot script) can ignore CORS entirely. Block server-side too.
  if (!isOriginAllowed(req)) {
    const origin = req.headers.get("origin") ?? "(none)";
    console.log(`[cors] blocked origin: ${origin}`);
    return new Response(
      JSON.stringify({ error: "Forbidden" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 403 }
    );
  }

  // Build the service-role client once — used by both rate-limit and inserts.
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  // Layer 3: Rate limit check (before parsing body to keep it cheap)
  const clientIp = getClientIp(req);
  const allowed = await checkRateLimit(supabase, clientIp);
  if (!allowed) {
    console.log(`[spam] Rate limit exceeded for IP ${clientIp}`);
    return new Response(
      JSON.stringify({ error: "Too many requests. Please try again later." }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 429 }
    );
  }

  try {
    let body: {
      name?: string;
      email?: string;
      company?: string;
      message?: string;
      _gotcha?: string;
    };

    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON body" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    // Layer 1: Honeypot check
    if (body._gotcha) {
      console.log(`[spam] Honeypot triggered — silent block (IP: ${clientIp})`);
      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    const { name, email, company, message } = body;

    if (!name || !email || !message) {
      return new Response(
        JSON.stringify({ error: "name, email and message are required" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return new Response(
        JSON.stringify({ error: "Invalid email address" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    // Layer 2: Content validation
    if (isGibberishName(name)) {
      console.log(`[spam] Gibberish name rejected: "${name}" (IP: ${clientIp})`);
      return new Response(
        JSON.stringify({ error: "Please enter your real name." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    if (isDisposableEmail(email)) {
      console.log(`[spam] Disposable email rejected: ${email} (IP: ${clientIp})`);
      return new Response(
        JSON.stringify({ error: "Please use a real email address." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    if (isSpamMessage(message)) {
      console.log(`[spam] Spam message rejected (IP: ${clientIp})`);
      return new Response(
        JSON.stringify({ error: "Please enter a meaningful message (at least 10 characters)." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    // All spam checks passed — proceed with normal flow

    const { error: contactError } = await supabase
      .from("contacts")
      .upsert(
        {
          contact_name: name.trim(),
          email: email.trim().toLowerCase(),
          company: company ? company.trim() : null,
          type: "Enquiry",
          source: "Squarespace",
        },
        { onConflict: "email", ignoreDuplicates: false }
      );

    if (contactError) {
      console.error("Supabase contact upsert error:", contactError);
      return new Response(
        JSON.stringify({ error: "Failed to save your message. Please try again." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }

    await supabase.from("enquiries").insert({
      email: email.trim().toLowerCase(),
      name: name.trim(),
      company: company ? company.trim() : null,
      message: message.trim(),
    }).then(() => {}).catch(() => {});

    const mailchimpKey = Deno.env.get("MAILCHIMP_API_KEY");
    if (mailchimpKey) {
      syncToMailchimp(
        email.trim().toLowerCase(),
        name.trim(),
        company?.trim() ?? "",
        mailchimpKey
      ).catch((err) => console.error("Mailchimp sync error:", err));
    }

    // Send notification email via Resend (non-blocking)
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (resendKey) {
      fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${resendKey}`,
        },
        body: JSON.stringify({
          from: "Diagonal Thinking <notifications@diagonalthinking.co>",
          to: ["phil@diagonalthinking.co"],
          subject: `New enquiry from ${name.trim()}${company ? ` (${company.trim()})` : ""}`,
          html: `
            <p><strong>Name:</strong> ${escapeHtml(name.trim())}</p>
            <p><strong>Email:</strong> ${escapeHtml(email.trim().toLowerCase())}</p>
            ${company ? `<p><strong>Company:</strong> ${escapeHtml(company.trim())}</p>` : ""}
            <p><strong>Message:</strong></p>
            <p>${escapeHtml(message.trim()).replace(/\n/g, "<br>")}</p>
          `,
        }),
      }).catch((err) => console.error("Resend notification error:", err));
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );

  } catch (err) {
    console.error("Unexpected error:", err);
    return new Response(
      JSON.stringify({ error: "An unexpected error occurred." }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
