import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAILCHIMP_AUDIENCE_ID = "d89fc8d69c";
const MAILCHIMP_SERVER = "us8";

// ??? Layer 3: IP-based Rate Limiting ?????????????????????????????????????????
// In-memory map � no external state needed at this scale.

interface RateLimitEntry {
  count: number;
  resetAt: number;
}
const rateLimitMap = new Map<string, RateLimitEntry>();
const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

function getClientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

function checkRateLimit(ip: string): boolean {
  const now = Date.now();

  // Probabilistic cleanup of expired entries (~10% of requests)
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

// ??? Layer 2: Content Validation ?????????????????????????????????????????????

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

// HTML Escaping (for Resend email template)

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, '&#x27;');
}

// ??? Mailchimp Helper ?????????????????????????????????????????????????????????

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

// ??? Main Handler ?????????????????????????????????????????????????????????????

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 405 }
    );
  }

  // Layer 3: Rate limit check (before parsing body to keep it cheap)
  const clientIp = getClientIp(req);
  if (!checkRateLimit(clientIp)) {
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
      console.log(`[spam] Honeypot triggered � silent block (IP: ${clientIp})`);
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

    // All spam checks passed � proceed with normal flow
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

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