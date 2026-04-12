/**
 * api/sol/contacts.js
 *
 * Sol's direct CRM write interface — search and create contacts.
 *
 * Auth: requires header x-sol-key matching env var SOL_API_KEY.
 * Uses Supabase service role key for writes.
 *
 * GET  /api/sol/contacts?search=  — search contacts by name/company/email
 * POST /api/sol/contacts           — create a new contact
 *
 * Sol is restricted to types: Warm Lead, Cold Lead, Mailing List, Enquiry.
 * 'Client' type is Flo's domain — Sol cannot create Client contacts.
 *
 * Required env vars:
 *   SOL_API_KEY                — shared secret header value
 *   SUPABASE_URL or VITE_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from "@supabase/supabase-js";

const SOL_ALLOWED_TYPES = ["Warm Lead", "Cold Lead", "Mailing List", "Enquiry"];

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

  const supabase = getSupabase();

  if (req.method === "GET") {
    const { search } = req.query;
    if (!search || !search.trim()) {
      return res.status(400).json({ error: "search query parameter is required" });
    }
    const term = `%${search.trim()}%`;
    const { data, error } = await supabase
      .from("contacts")
      .select("id, company, contact_name, email, phone, type, source, services, projected_value, notes, created_at")
      .or(`contact_name.ilike.${term},company.ilike.${term},email.ilike.${term}`)
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ contacts: data ?? [] });
  }

  if (req.method === "POST") {
    const {
      first_name,
      last_name,
      company_name,
      email,
      phone,
      type,
      source,
      projected_value,
      services,
      notes,
    } = req.body || {};

    // At least one of first_name or company_name is required
    if (!first_name && !company_name) {
      return res.status(400).json({ error: "first_name or company_name is required" });
    }

    // Type must be provided and must be one of Sol's allowed types
    if (!type) {
      return res.status(400).json({ error: `type is required. Must be one of: ${SOL_ALLOWED_TYPES.join(", ")}` });
    }
    if (!SOL_ALLOWED_TYPES.includes(type)) {
      return res.status(400).json({
        error: `type '${type}' is not allowed. Sol can only create: ${SOL_ALLOWED_TYPES.join(", ")}. 'Client' is Flo's domain.`,
      });
    }

    const contact_name = [first_name, last_name].filter(Boolean).join(" ") || null;

    const { data, error } = await supabase
      .from("contacts")
      .insert({
        company: company_name ?? null,
        contact_name: contact_name,
        email: email ?? null,
        phone: phone ?? null,
        type,
        source: source ?? "Manual",
        projected_value: projected_value ?? 0,
        services: services ?? [],
        notes: notes ?? null,
        date_added: new Date().toISOString().slice(0, 10),
        last_updated: new Date().toISOString().slice(0, 10),
      })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ contact: data });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
