import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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

    // Upsert the contact record
    const { error: contactError } = await supabase
      .from("contacts")
      .upsert(
        {
          contact_name: name.trim(),
          email: email.trim().toLowerCase(),
          company: company ? company.trim() : null,
          type: "Enquiry",
          source: "Contact Page",
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

    // Also log the message to an enquiries table if it exists
    // (Run: CREATE TABLE enquiries (id uuid default gen_random_uuid() primary key, email text, message text, created_at timestamptz default now());)
    await supabase.from("enquiries").insert({
      email: email.trim().toLowerCase(),
      name: name.trim(),
      company: company ? company.trim() : null,
      message: message.trim(),
    }).then(() => {}).catch(() => {}); // Silently skip if table doesn't exist yet

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
