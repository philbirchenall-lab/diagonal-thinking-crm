import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAILCHIMP_AUDIENCE_ID = "d89fc8d69c";
const MAILCHIMP_SERVER = "us8";

async function subscriberHash(email: string): Promise<string> {
  const normalized = email.toLowerCase().trim();
  const msgBuffer = new TextEncoder().encode(normalized);
  const hashBuffer = await crypto.subtle.digest("MD5", msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// SEC-SUP-003: gibberish-name guard ported from contact-form/index.ts.
// Bot fillers like "asDFGHjkLM" pass minimum-length checks but are
// recognisable by run-of-uppercase or scattered-uppercase patterns in
// non-leading positions. Surname prefixes (Mc, Mac, De, Von, Le, La,
// O') are excluded so legitimate names pass.
function isGibberishName(name: string): boolean {
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

async function syncToMailchimp(
  email: string,
  firstName: string,
  lastName: string,
  company: string,
  apiKey: string
): Promise<void> {
  const hash = await subscriberHash(email);
  const url = `https://${MAILCHIMP_SERVER}.api.mailchimp.com/3.0/lists/${MAILCHIMP_AUDIENCE_ID}/members/${hash}`;

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
        FNAME: firstName,
        LNAME: lastName,
        COMPANY: company,
        TYPE: "Warm Lead",
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    // SEC-SUP-004 (extended): scrub credentials from Mailchimp error
    // bodies before logging. Mailchimp occasionally echoes the
    // Authorization header back. See mailchimp-sync/index.ts for the
    // canonical scrubSecrets helper; this is the inline equivalent.
    const scrubbed = err
      .replace(/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._\-+/=]{8,}/gi, "$1 [REDACTED]")
      .replace(/\b(api[_-]?key|key|password|secret|token)\s*[:=]\s*[A-Za-z0-9._\-+/=]{6,}/gi, "$1=[REDACTED]")
      .replace(/\b[a-f0-9]{32}-[a-z]{2}\d+\b/gi, "[REDACTED-MC-KEY]");
    console.error(`Mailchimp sync failed (${res.status}): ${scrubbed}`);
  } else {
    console.log(`Mailchimp sync OK for ${email}`);
  }
}

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

  try {
    let body: {
      first_name?: string;
      last_name?: string;
      email?: string;
      company?: string;
      phone?: string | null;
    };

    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON body" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    const { first_name, last_name, email, company, phone } = body;

    if (!first_name || !last_name || !email || !company) {
      return new Response(
        JSON.stringify({ error: "first_name, last_name, email and company are required" }),
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

    // SEC-SUP-003: reject gibberish names before they hit the contacts
    // table. Matches the contact-form policy: bots filling random keys
    // get a 422 instead of polluting the warm-leads list.
    const fullName = `${first_name.trim()} ${last_name.trim()}`;
    if (isGibberishName(fullName)) {
      return new Response(
        JSON.stringify({ error: "Please provide a valid name." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 422 }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { error } = await supabase
      .from("contacts")
      .upsert(
        {
          contact_name: `${first_name.trim()} ${last_name.trim()}`,
          email: email.trim().toLowerCase(),
          company: company.trim(),
          phone: phone ? phone.trim() : null,
          type: "Warm Lead",
          source: "Agent Advantage Page",
        },
        { onConflict: "email", ignoreDuplicates: false }
      );

    if (error) {
      console.error("Supabase upsert error:", error);
      return new Response(
        JSON.stringify({ error: "Failed to save your details. Please try again." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }

    // Sync to Mailchimp (non-blocking — failure doesn't break the response)
    const mailchimpKey = Deno.env.get("MAILCHIMP_API_KEY");
    if (mailchimpKey) {
      syncToMailchimp(
        email.trim().toLowerCase(),
        first_name.trim(),
        last_name.trim(),
        company.trim(),
        mailchimpKey
      ).catch((err) => console.error("Mailchimp sync error:", err));
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
