import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3001;

const DATA_FILE = path.join(
  __dirname,
  "Diagonal Thinking CRM Data - DO NOT DELETE.json"
);
const SEED_FILE = path.join(__dirname, "crm-import-data.json");

// ─── Seed local data file if missing ────────────────────────────────────────

if (!fs.existsSync(DATA_FILE)) {
  if (fs.existsSync(SEED_FILE)) {
    fs.copyFileSync(SEED_FILE, DATA_FILE);
    console.log("Data file seeded from crm-import-data.json");
  } else {
    fs.writeFileSync(DATA_FILE, "[]", "utf8");
    console.log("Data file created (empty — seed file not found)");
  }
}

// ─── Optional Supabase sync ──────────────────────────────────────────────────
// When SUPABASE_URL + SUPABASE_SERVICE_KEY are set in the environment:
//   • On startup: refresh local JSON from Supabase (so local is never stale)
//   • On every write: push updated array to Supabase alongside the local file
// This keeps the hosted (Vercel) version and the local fallback in sync.

let supabase = null;

async function initSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) return;
  try {
    const { createClient } = await import("@supabase/supabase-js");
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY // service role key for server-side writes
    );
    console.log("Supabase sync enabled — refreshing local data from cloud...");
    await refreshLocalFromSupabase();
  } catch (err) {
    console.warn("Supabase init failed (continuing local-only):", err.message);
  }
}

async function refreshLocalFromSupabase() {
  if (!supabase) return;
  try {
    const { data, error } = await supabase.from("contacts").select("*");
    if (error) throw error;
    if (data && data.length > 0) {
      const contacts = data.map(snakeToCamel);
      fs.writeFileSync(DATA_FILE, JSON.stringify(contacts, null, 2), "utf8");
      console.log(`Local data refreshed from Supabase: ${contacts.length} contacts`);
    }
  } catch (err) {
    console.warn("Supabase refresh failed (using local file):", err.message);
  }
}

async function syncToSupabase(contacts) {
  if (!supabase) return;
  try {
    const rows = contacts.map(camelToSnake);

    // Upsert all contacts
    const { error: upsertErr } = await supabase.from("contacts").upsert(rows);
    if (upsertErr) throw upsertErr;

    // Delete any contacts removed from the local array
    const { data: existing } = await supabase.from("contacts").select("id");
    if (existing) {
      const currentIds = new Set(contacts.map((c) => c.id));
      const toDelete = existing.filter((r) => !currentIds.has(r.id)).map((r) => r.id);
      if (toDelete.length > 0) {
        await supabase.from("contacts").delete().in("id", toDelete);
      }
    }
  } catch (err) {
    console.warn("Supabase sync failed (local write succeeded):", err.message);
  }
}

// ─── Field name conversion ───────────────────────────────────────────────────

function camelToSnake(c) {
  return {
    id: c.id,
    company: c.company ?? null,
    contact_name: c.contactName ?? null,
    email: c.email ?? null,
    phone: c.phone ?? null,
    type: c.type ?? "Warm Lead",
    services: c.services ?? [],
    projected_value: c.projectedValue ?? 0,
    notes: c.notes ?? null,
    source: c.source ?? null,
    date_added: c.dateAdded ?? null,
    last_updated: c.lastUpdated ?? null,
    linkedin_url: c.linkedinUrl ?? null,
  };
}

function snakeToCamel(r) {
  return {
    id: r.id,
    company: r.company ?? "",
    contactName: r.contact_name ?? "",
    email: r.email ?? "",
    phone: r.phone ?? "",
    type: r.type ?? "Warm Lead",
    services: r.services ?? [],
    projectedValue: r.projected_value ?? 0,
    notes: r.notes ?? "",
    source: r.source ?? "",
    dateAdded: r.date_added ?? "",
    lastUpdated: r.last_updated ?? "",
    linkedinUrl: r.linkedin_url ?? "",
  };
}

// ─── Express setup ───────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json({ limit: "10mb" }));

// GET /api/contacts — return all contacts
app.get("/api/contacts", (req, res) => {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    res.json(JSON.parse(raw));
  } catch (err) {
    console.error("Error reading data file:", err);
    res.status(500).json({ error: "Failed to read contacts" });
  }
});

// POST /api/contacts — write the full contacts array (+ optional Supabase sync)
app.post("/api/contacts", async (req, res) => {
  try {
    const contacts = req.body;
    if (!Array.isArray(contacts)) {
      return res.status(400).json({ error: "Expected an array of contacts" });
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(contacts, null, 2), "utf8");
    res.json({ success: true, count: contacts.length });

    // Fire-and-forget Supabase sync (doesn't block the response)
    syncToSupabase(contacts);
  } catch (err) {
    console.error("Error writing data file:", err);
    res.status(500).json({ error: "Failed to save contacts" });
  }
});

// POST /api/contacts/:id — update or insert a single contact by id
app.post("/api/contacts/:id", async (req, res) => {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const contacts = JSON.parse(raw);
    const { id } = req.params;
    const updated = req.body;
    const index = contacts.findIndex((c) => c.id === id);
    if (index === -1) {
      contacts.push(updated);
    } else {
      contacts[index] = updated;
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(contacts, null, 2), "utf8");
    res.json({ success: true });

    // Fire-and-forget Supabase sync
    syncToSupabase(contacts);
  } catch (err) {
    console.error("Error updating contact:", err);
    res.status(500).json({ error: "Failed to update contact" });
  }
});

// ─── Start ───────────────────────────────────────────────────────────────────

await initSupabase();

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Diagonal Thinking CRM local server running on port ${PORT}`);
  if (supabase) {
    console.log("Two-way Supabase sync active — local writes will push to cloud");
  } else {
    console.log("Local-only mode — set SUPABASE_URL + SUPABASE_SERVICE_KEY to enable cloud sync");
  }
});
