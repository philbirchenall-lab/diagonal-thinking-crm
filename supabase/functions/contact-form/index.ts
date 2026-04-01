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
      name?: string;
      email?: string;
      company?: string;
      message?: string;
    };

    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON body" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
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

    // Log to enquiries table
    await supabase.from("enquiries").insert({
      email: email.trim().toLowerCase(),
      name: name.trim(),
      company: company ? company.trim() : null,
      message: message.trim(),
    }).then(() => {}).catch(() => {});

    // Sync to Mailchimp (non-blocking)
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
            <p><strong>Name:</strong> ${name.trim()}</p>
            <p><strong>Email:</strong> ${email.trim().toLowerCase()}</p>
            ${company ? `<p><strong>Company:</strong> ${company.trim()}</p>` : ""}
            <p><strong>Message:</strong></p>
            <p>${message.trim().replace(/\n/g, "<br>")}</p>
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
