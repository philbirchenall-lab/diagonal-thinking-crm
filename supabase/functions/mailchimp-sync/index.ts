/**
 * mailchimp-sync — Supabase Edge Function
 *
 * Triggered by a Supabase Database Webhook on the `contacts` table.
 * Keeps Mailchimp in sync whenever a contact is inserted, updated, or deleted.
 *
 * Environment secrets required:
 *   MAILCHIMP_API_KEY       — e.g. xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx-us8
 *   MAILCHIMP_AUDIENCE_ID   — e.g. d89fc8d69c
 *   MAILCHIMP_SERVER        — e.g. us8
 */

import { createHash } from "https://deno.land/std@0.224.0/crypto/mod.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ContactRecord {
  id: string;
  company?: string | null;
  contact_name?: string | null;
  email?: string | null;
  phone?: string | null;
  type?: string | null;
  services?: string[] | null;
  network_partner?: boolean | null;
  source?: string | null;
  [key: string]: unknown;
}

interface WebhookPayload {
  type: "INSERT" | "UPDATE" | "DELETE";
  table: string;
  schema: string;
  record: ContactRecord | null;
  old_record: ContactRecord | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** MD5 hash of a lowercase email — required by Mailchimp as the subscriber ID */
async function subscriberHash(email: string): Promise<string> {
  const normalized = email.toLowerCase().trim();
  const msgBuffer = new TextEncoder().encode(normalized);
  const hashBuffer = await crypto.subtle.digest("MD5", msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Split "First Last" into { fname, lname }. Handles single names gracefully. */
function splitName(fullName: string | null | undefined): {
  fname: string;
  lname: string;
} {
  if (!fullName) return { fname: "", lname: "" };
  const parts = fullName.trim().split(/\s+/);
  const fname = parts[0] ?? "";
  const lname = parts.slice(1).join(" ");
  return { fname, lname };
}

/** Build the Mailchimp base URL for a list member */
function memberUrl(hash: string, audienceId: string, serverPrefix: string): string {
  return `https://${serverPrefix}.api.mailchimp.com/3.0/lists/${audienceId}/members/${hash}`;
}

// ─── Mailchimp operations ─────────────────────────────────────────────────────

async function upsertMember(
  contact: ContactRecord,
  apiKey: string,
  audienceId: string,
  serverPrefix: string
): Promise<void> {
  if (!contact.email) {
    console.log(
      `Skipping upsert for contact ${contact.id} — no email address.`
    );
    return;
  }

  const { fname, lname } = splitName(contact.contact_name);
  const hash = await subscriberHash(contact.email);

  // Convert services array to comma-separated string for Mailchimp
  const servicesStr = Array.isArray(contact.services)
    ? contact.services.join(", ")
    : (contact.services ?? "");

  // Convert network_partner boolean to readable text
  const networkStr = contact.network_partner ? "Yes" : "No";

  const body = {
    email_address: contact.email.toLowerCase().trim(),
    status_if_new: "subscribed",
    merge_fields: {
      FNAME: fname,
      LNAME: lname,
      COMPANY: contact.company ?? "",
      PHONE: contact.phone ?? "",
      CRM_TYPE: contact.type ?? "",
      SERVICES: servicesStr,
      NETWORK_PARTNER: networkStr,
      SOURCE: contact.source ?? "",
    },
  };

  const res = await fetch(memberUrl(hash, audienceId, serverPrefix), {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${btoa(`anystring:${apiKey}`)}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Mailchimp upsert failed (${res.status}): ${err}`);
  }

  console.log(`Mailchimp upsert OK for ${contact.email}`);
}

async function archiveMember(
  contact: ContactRecord,
  apiKey: string,
  audienceId: string,
  serverPrefix: string
): Promise<void> {
  if (!contact.email) {
    console.log(
      `Skipping archive for contact ${contact.id} — no email address.`
    );
    return;
  }

  const hash = await subscriberHash(contact.email);

  const res = await fetch(memberUrl(hash, audienceId, serverPrefix), {
    method: "DELETE",
    headers: {
      Authorization: `Basic ${btoa(`anystring:${apiKey}`)}`,
    },
  });

  // 204 = success, 404 = subscriber didn't exist — both are fine
  if (!res.ok && res.status !== 404) {
    const err = await res.text();
    throw new Error(`Mailchimp archive failed (${res.status}): ${err}`);
  }

  console.log(`Mailchimp archive OK for ${contact.email} (status ${res.status})`);
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  // Only accept POST requests from the Supabase webhook
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const apiKey = Deno.env.get("MAILCHIMP_API_KEY");
  const audienceId = Deno.env.get("MAILCHIMP_AUDIENCE_ID");
  const serverPrefix = Deno.env.get("MAILCHIMP_SERVER");

  if (!apiKey || !audienceId || !serverPrefix) {
    console.error("Missing required Mailchimp secrets (MAILCHIMP_API_KEY, MAILCHIMP_AUDIENCE_ID, MAILCHIMP_SERVER).");
    return new Response("Server misconfiguration", { status: 500 });
  }

  let payload: WebhookPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  const { type, record, old_record } = payload;

  try {
    if (type === "INSERT" || type === "UPDATE") {
      if (!record) throw new Error("Missing record in INSERT/UPDATE payload");
      await upsertMember(record, apiKey, audienceId, serverPrefix);
    } else if (type === "DELETE") {
      const target = old_record ?? record;
      if (!target) throw new Error("Missing old_record in DELETE payload");
      await archiveMember(target, apiKey, audienceId, serverPrefix);
    } else {
      console.log(`Ignoring unknown event type: ${type}`);
    }
  } catch (err) {
    console.error("Sync error:", err);
    return new Response(`Sync error: ${(err as Error).message}`, {
      status: 500,
    });
  }

  return new Response("OK", { status: 200 });
});
