/**
 * api/sol/contacts/[id].js
 *
 * Sol's direct CRM write interface — update an existing contact.
 *
 * Auth: requires EITHER
 *   - header `x-sol-key` matching env var SOL_API_KEY (Sol agent path), OR
 *   - cookie `admin_session` (CRM admin UI path) — accepted as defence-
 *     in-depth so a leaked Sol key alone is not the only key to write.
 *
 * Uses Supabase service role key for writes.
 *
 * PATCH /api/sol/contacts/:id  — update a contact's non-locked fields
 *
 * Security (SEC-API-003, Hex 30 Apr 2026 risk register):
 *   - The :id path parameter is validated against a strict UUID v1-5 regex
 *     before any database call. Malformed values return 400 immediately.
 *   - The row is loaded first and ownership-class rules are enforced before
 *     mutation: Sol can only PATCH contacts whose current type is in the
 *     SOL_ALLOWED_TYPES set. Client-typed contacts are Flo's domain and any
 *     PATCH against a Client row returns 404 (no existence disclosure).
 *   - On mutation failure (RLS, FK, anything) the raw DB error message is
 *     never echoed to the caller — generic 500.
 *
 * Restrictions (unchanged):
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

// Strict RFC 4122 v1-5 UUID regex. Lower-or-upper hex. The Sol path receives
// :id straight from the URL, so this guard runs before any Supabase query.
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/**
 * Parse the Cookie header and return the value of the named cookie, or null.
 * Mirrors the helper used by the API-004 fix so the two routes share shape.
 */
function readCookie(req, name) {
  const header = req.headers?.cookie;
  if (!header || typeof header !== "string") return null;
  const parts = header.split(";");
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const k = trimmed.slice(0, eq).trim();
    if (k !== name) continue;
    const v = trimmed.slice(eq + 1).trim();
    return v.length > 0 ? v : null;
  }
  return null;
}

/**
 * Authenticate the request. Accepts EITHER a valid x-sol-key header (Sol
 * agent path) OR a non-empty admin_session cookie (CRM admin UI path).
 *
 * Returns true on success, otherwise responds 401 and returns false.
 */
function authenticate(req, res) {
  const solKey = req.headers["x-sol-key"];
  const solKeyValid =
    typeof solKey === "string" &&
    solKey.length > 0 &&
    process.env.SOL_API_KEY &&
    solKey === process.env.SOL_API_KEY;

  const adminCookie = readCookie(req, "admin_session");
  const adminCookieValid = typeof adminCookie === "string" && adminCookie.length > 0;

  if (!solKeyValid && !adminCookieValid) {
    // 401 with no body — never echo why the gate rejected.
    res.status(401).end();
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

  // SEC-API-003: Validate UUID format BEFORE any DB call. A malformed :id
  // would otherwise hit Supabase, surface a Postgres "invalid input syntax
  // for type uuid" error, and that error message would leak through the
  // generic catch path. Reject malformed early with a generic 400.
  if (typeof id !== "string" || !UUID_REGEX.test(id)) {
    return res.status(400).json({ error: "Invalid id" });
  }

  const supabase = getSupabase();

  // Load the current contact. Used for two checks:
  //   1) existence  → 404 if missing
  //   2) ownership-class → Sol can only PATCH contacts whose CURRENT type is
  //      in SOL_ALLOWED_TYPES. Client rows are Flo's domain and any PATCH
  //      attempt against a Client row returns 404 (existence-hiding) so an
  //      attacker who learned the Sol key cannot enumerate which UUIDs are
  //      Clients vs leads.
  const { data: existing, error: fetchError } = await supabase
    .from("contacts")
    .select("id, type")
    .eq("id", id)
    .maybeSingle();

  if (fetchError || !existing) {
    return res.status(404).json({ error: "Contact not found" });
  }

  // SEC-API-003 ownership check: Sol's mandate is leads only. If the row's
  // current type is anything other than a Sol-allowed type (i.e. it's a
  // Client), refuse and 404 to avoid leaking that the row exists.
  if (!SOL_ALLOWED_TYPES.includes(existing.type)) {
    return res.status(404).json({ error: "Contact not found" });
  }

  const body = req.body || {};

  // Enforce: cannot change type to/from Client
  if (body.type !== undefined) {
    if (existing.type === "Client") {
      // Defensive — already rejected by the ownership check above, kept so
      // the constraint is visible if the ownership check is ever loosened.
      return res.status(400).json({
        error: "Cannot change type of a Client contact — Client status is permanent.",
      });
    }
    if (body.type === "Client") {
      return res.status(400).json({
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

  // Email uniqueness check — exclude the contact's own ID so editing without
  // changing the email never triggers a false duplicate violation.
  if (updates.email) {
    const { data: conflict } = await supabase
      .from("contacts")
      .select("id")
      .eq("email", updates.email)
      .neq("id", id)
      .maybeSingle();
    if (conflict) {
      return res.status(400).json({
        error: `Email '${updates.email}' is already used by another contact.`,
      });
    }
  }

  const { data, error } = await supabase
    .from("contacts")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    // Never echo the raw DB error — could leak schema or internal state.
    return res.status(500).json({ error: "Failed to update contact" });
  }
  return res.status(200).json({ contact: data });
}
