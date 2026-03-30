/**
 * db.js — Data access layer for the Diagonal Thinking CRM
 *
 * When VITE_SUPABASE_URL is set (deployed to Vercel), uses Supabase.
 * When not set (running locally via Open CRM.command), uses the local Express API.
 *
 * This lets the local setup work as a fully self-contained fallback with no
 * internet required.
 */

// ─── Mode detection ─────────────────────────────────────────────────────────

const USE_SUPABASE = Boolean(import.meta.env.VITE_SUPABASE_URL);
const LOCAL_API = "http://localhost:3001/api/contacts";

// ─── Supabase client (only initialised when env vars present) ───────────────

let supabase = null;

if (USE_SUPABASE) {
  const { createClient } = await import("@supabase/supabase-js");
  supabase = createClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_ANON_KEY
  );
}

// ─── Field name conversion ───────────────────────────────────────────────────

function toSnake(contact) {
  return {
    id: contact.id,
    company: contact.company ?? null,
    contact_name: contact.contactName ?? null,
    email: contact.email ?? null,
    phone: contact.phone ?? null,
    type: contact.type ?? "Warm Lead",
    services: contact.services ?? [],
    projected_value: contact.projectedValue ?? 0,
    notes: contact.notes ?? null,
    source: contact.source ?? null,
    date_added: contact.dateAdded ?? null,
    last_updated: contact.lastUpdated ?? null,
    linkedin_url: contact.linkedinUrl ?? null,
  };
}

function toCamel(row) {
  return {
    id: row.id,
    company: row.company ?? "",
    contactName: row.contact_name ?? "",
    email: row.email ?? "",
    phone: row.phone ?? "",
    type: row.type ?? "Warm Lead",
    services: row.services ?? [],
    projectedValue: row.projected_value ?? 0,
    notes: row.notes ?? "",
    source: row.source ?? "",
    dateAdded: row.date_added ?? "",
    lastUpdated: row.last_updated ?? "",
    linkedinUrl: row.linkedin_url ?? "",
  };
}

// ─── Auth (Supabase mode only) ───────────────────────────────────────────────

export function getSupabaseClient() {
  return supabase;
}

export function isSupabaseMode() {
  return USE_SUPABASE;
}

// ─── Data operations ─────────────────────────────────────────────────────────

export async function loadContacts() {
  if (USE_SUPABASE) {
    const { data, error } = await supabase
      .from("contacts")
      .select("*")
      .order("date_added", { ascending: false, nullsFirst: false });

    if (error) throw new Error(`Supabase load failed: ${error.message}`);
    return data.map(toCamel);
  } else {
    const res = await fetch(LOCAL_API);
    if (!res.ok) throw new Error(`Local API load failed: ${res.status}`);
    return res.json();
  }
}

export async function saveAllContacts(contacts) {
  if (USE_SUPABASE) {
    const rows = contacts.map(toSnake);

    // Upsert all current contacts
    const { error: upsertErr } = await supabase.from("contacts").upsert(rows);
    if (upsertErr) throw new Error(`Supabase upsert failed: ${upsertErr.message}`);

    // Delete any contacts that exist in Supabase but not in the current array
    const { data: existing, error: fetchErr } = await supabase
      .from("contacts")
      .select("id");
    if (fetchErr) throw new Error(`Supabase fetch IDs failed: ${fetchErr.message}`);

    const currentIds = new Set(contacts.map((c) => c.id));
    const toDelete = existing.filter((r) => !currentIds.has(r.id)).map((r) => r.id);

    if (toDelete.length > 0) {
      const { error: deleteErr } = await supabase
        .from("contacts")
        .delete()
        .in("id", toDelete);
      if (deleteErr) throw new Error(`Supabase delete failed: ${deleteErr.message}`);
    }
  } else {
    // Local mode: POST the full array to Express
    const res = await fetch(LOCAL_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(contacts),
    });
    if (!res.ok) throw new Error(`Local API save failed: ${res.status}`);
  }
}
