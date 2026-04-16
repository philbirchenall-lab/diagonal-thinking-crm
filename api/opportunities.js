/**
 * api/opportunities.js
 *
 * Vercel serverless function — list and create opportunities.
 *
 * GET  /api/opportunities               — all opportunities (with linked contact info)
 * GET  /api/opportunities?contact_id=   — filtered by contact
 * GET  /api/opportunities?stage=        — filtered by stage
 * POST /api/opportunities               — create a new opportunity
 *
 * Required env vars:
 *   SUPABASE_URL or VITE_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY or VITE_SUPABASE_ANON_KEY
 */

import { createClient } from "@supabase/supabase-js";

const VALID_STAGES = ["Identified", "Qualifying", "Proposal", "Negotiating", "Won", "Lost"];

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY;
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export default async function handler(req, res) {
  const supabase = getSupabase();

  if (req.method === "GET") {
    let query = supabase
      .from("opportunities")
      .select("*, contacts(id, company, contact_name, email)")
      .order("created_at", { ascending: false });

    if (req.query.contact_id) {
      query = query.eq("contact_id", req.query.contact_id);
    }
    if (req.query.stage) {
      query = query.eq("stage", req.query.stage);
    }

    const { data, error } = await query;
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    return res.status(200).json({ opportunities: data ?? [] });
  }

  if (req.method === "POST") {
    const { title, description, value, stage, services, close_date, contact_id, proposal_id, notes } =
      req.body || {};

    if (!title || !title.trim()) {
      return res.status(400).json({ error: "title is required" });
    }
    if (stage && !VALID_STAGES.includes(stage)) {
      return res.status(400).json({ error: `stage must be one of: ${VALID_STAGES.join(", ")}` });
    }

    const { data, error } = await supabase
      .from("opportunities")
      .insert({
        title: title.trim(),
        description: description ?? null,
        value: value ?? 0,
        stage: stage ?? "Identified",
        services: services ?? [],
        close_date: close_date ?? null,
        contact_id: contact_id ?? null,
        proposal_id: proposal_id ?? null,
        notes: notes ?? null,
      })
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }
    return res.status(201).json({ opportunity: data });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
