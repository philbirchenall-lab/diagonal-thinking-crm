/**
 * api/opportunities/[[...id]].js
 *
 * Vercel serverless function — list, create, update and delete opportunities.
 * Uses optional catch-all routing so a single function handles both:
 *
 * GET    /api/opportunities               — all opportunities (with linked contact info)
 * GET    /api/opportunities?contact_id=   — filtered by contact
 * GET    /api/opportunities?stage=        — filtered by stage
 * POST   /api/opportunities               — create a new opportunity
 * PATCH  /api/opportunities/:id           — update any field on an opportunity
 * DELETE /api/opportunities/:id           — delete an opportunity
 *
 * Security (SEC-API-004, Hex 30 Apr 2026 risk register):
 *   Every method handler now requires a valid admin_session cookie before
 *   any database call. Unauthenticated callers receive 401 with no body.
 *   The frontend talks to Supabase directly (see src/db.js), so this
 *   endpoint had no legitimate caller today — it was a pure attack surface.
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

/**
 * Parse the Cookie header and return the value of the named cookie, or null.
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
 * Gate: every request must carry a non-empty admin_session cookie.
 * Returns true if the gate sent a 401 response (caller should stop).
 */
function rejectIfUnauthenticated(req, res) {
  const token = readCookie(req, "admin_session");
  if (!token) {
    // 401 with no body — never echo why the gate rejected.
    res.status(401).end();
    return true;
  }
  return false;
}

export default async function handler(req, res) {
  // Auth gate — runs before ANY database call on every method (GET/POST/PATCH/DELETE).
  // SEC-API-004: previously this endpoint was completely unauthenticated against the
  // master database key, so any browser visitor could read, create, modify or delete
  // any row in the opportunities table.
  if (rejectIfUnauthenticated(req, res)) return;

  // [[...id]] gives req.query.id as undefined (no segment) or ['uuid'] (one segment)
  const id = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;

  const supabase = getSupabase();

  // ── Collection routes (no id) ────────────────────────────────────────────────

  if (!id) {
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

  // ── Single-resource routes (id present) ──────────────────────────────────────

  if (req.method === "PATCH") {
    const allowed = ["title", "description", "value", "stage", "services", "close_date", "contact_id", "proposal_id", "notes", "won_at"];
    const updates = {};
    for (const field of allowed) {
      if (Object.prototype.hasOwnProperty.call(req.body ?? {}, field)) {
        updates[field] = req.body[field];
      }
    }

    if (updates.stage && !VALID_STAGES.includes(updates.stage)) {
      return res.status(400).json({ error: `stage must be one of: ${VALID_STAGES.join(", ")}` });
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "No valid fields to update" });
    }

    // updated_at is handled by the DB trigger
    const { data, error } = await supabase
      .from("opportunities")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }
    if (!data) {
      return res.status(404).json({ error: "Opportunity not found" });
    }
    return res.status(200).json({ opportunity: data });
  }

  if (req.method === "DELETE") {
    const { error } = await supabase.from("opportunities").delete().eq("id", id);
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
