/**
 * api/sol/contacts/[id].js
 *
 * Sol's direct CRM write interface — update an existing contact.
 *
 * Auth: requires header x-sol-key matching env var SOL_API_KEY.
 * Uses Supabase service role key for writes.
 *
 * PATCH /api/sol/contacts/:id  — update a contact's non-locked fields
 *
 * Restrictions:
 * - Cannot change type to/from 'Client'
 * - Cannot update total_client_value or live_work_value (Flo's fields)
 *
 * Required env vars:
 *   SOL_API_KEY
 *   SUPABASE_URL or VITE_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from "@supabase/supabase-js";

const SOL_ALLOWED_TYPES = ["Warm Lead", "Cold Lead", "Mailing List", "Enquiry"];

// Fields Sol is allowed to update
const UPDATABLE_FIELDS = [
  "company",
  "contact_name",
  "email",
  "phone",
  "type",
  "source",
  "projected_value",
  "services",
  "notes",
  "linkedin_url",
  "network_partner",
  "date_added",
  "last_updated",
];

function authenticate(req, res) {
  const key = req.headers["x-sol-key"];
  if (!key || key !== process.env.SOL_API_KEY) {
    res.status(401).json({ error: "Unauthorized — invalid or missing x-sol-key header" });
    return false;
  }
  return true;
}

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export default async function handler(req, res) {
  if (!authenticate(req, res)) return;

  if (req.method !== "PATCH") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { id } = req.query;
  if (!id) {
    return res.status(400).json({ error: "id is required" });
  }

  const supabase = getSupabase();

  // Load the current contact to enforce type rules
  const { data: existing, error: fetchError } = await supabase
    .from("contacts")
    .select("id, type")
    .eq("id", id)
    .single();

  if (fetchError || !existing) {
    return res.status(404).json({ error: "Contact not found" });
  }

  const body = req.body || {};

  // Enforce: cannot change type to/from Client
  if (body.type !== undefined) {
    if (existing.type === "Client") {
      return res.status(403).json({
        error: "Cannot change type of a Client contact — Client status is permanent.",
      });
    }
    if (body.type === "Client") {
      return res.status(403).json({
        error: "Sol cannot set type to 'Client'. Client designation is Flo's domain.",
      });
    }
    if (!SOL_ALLOWED_TYPES.includes(body.type)) {
      return res.status(400).json({
        error: `type '${body.type}' is not allowed. Must be one of: ${SOL_ALLOWED_TYPES.join(", ")}`,
      });
    }
  }

  // Build the update object — only allowed fields
  const updates = {};
  for (const field of UPDATABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      updates[field] = body[field];
    }
  }

  // Silently reject any attempt to touch Flo's locked fields
  // (total_client_value, live_work_value are not in UPDATABLE_FIELDS above)

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: "No valid updatable fields provided" });
  }

  // Auto-stamp last_updated if not explicitly set
  if (!updates.last_updated) {
    updates.last_updated = new Date().toISOString().slice(0, 10);
  }

  const { data, error } = await supabase
    .from("contacts")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ contact: data });
}
