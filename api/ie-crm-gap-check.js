/**
 * api/ie-crm-gap-check.js
 *
 * Vercel serverless function — runs Monday 09:00 UTC via vercel.json cron config.
 * Also triggered from the weekly-invoice-prefix-check skill (Monday 09:00).
 *
 * REX-TODO-001 — Phase 1: I&E-to-CRM gap detection
 *
 * Reads the I&E Google Sheet (Income tab, FY 26-27) and checks each client name
 * against the Supabase CRM contacts table. Uses fuzzy matching to handle:
 *   - Short vs full names (e.g. "Cuckoo" vs "Cuckoo Design")
 *   - Spacing inconsistency (e.g. "Wealthteck" vs "Wealth Teck")
 *   - Parenthetical patterns (e.g. "TACE (Contollo)" vs "Contollo Group Ltd")
 *   - Legal suffix differences (Ltd, Limited, Group stripped before comparison)
 *
 * Confidence tiers:
 *   HIGH (exact normalised match or substring) → already in CRM, skip
 *   NO MATCH → gap found, flag for review or auto-create
 *
 * Query params:
 *   auto_add=true  — auto-create gap records in Supabase (default: false, log only)
 *   dry_run=true   — same as not passing auto_add; alias for clarity
 *
 * Required env vars:
 *   GOOGLE_SHEETS_API_KEY          — Google Sheets API key (restricted to Sheets API)
 *   SUPABASE_URL or VITE_SUPABASE_URL  — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY      — Service role key for write access
 *   SUPABASE_ANON_KEY or VITE_SUPABASE_ANON_KEY — Anon key fallback (read-only)
 *   CRON_SECRET                    — Must match Authorization: Bearer <token> header
 */

// ─── Sheet config ─────────────────────────────────────────────────────────────

const SHEET_ID = "11DYOTeszgC3NAqxazK3EsPBvG2hKgjITL40Wa3mE73c";
const SHEET_TAB = "26-27 Income";
// Column indices (0-based): A=0 Date, B=1 Client, C=2 Project, D=3 Project Type,
// E=4 Notes, F=5 Invoice Number, G=6 Projected, H=7 Progress, I=8 Invoice Amount,
// J=9 Sent, K=10 Paid
const COL_CLIENT = 1;
const COL_PROJECT = 2;
const COL_PROJECT_TYPE = 3;
const COL_NOTES = 4;
const COL_PROGRESS = 7;

// ─── Auth check ───────────────────────────────────────────────────────────────

function verifyAuth(req) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return true; // if no secret configured, allow (dev only)
  const authHeader = req.headers["authorization"] ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  return token === cronSecret;
}

// ─── Normalisation ────────────────────────────────────────────────────────────

/**
 * Normalise a company name for fuzzy comparison.
 * Strips legal suffixes, punctuation, extra whitespace — lowercased.
 * Also strips parenthetical content (e.g. "TACE (Contollo)" → "tace")
 * so both the parent and the child can match.
 */
function normalise(name) {
  if (!name || typeof name !== "string") return "";
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")                        // strip parentheticals
    .replace(/\b(ltd|limited|group|llc|inc|plc|co|uk|design|studio|studios|agency)\b/g, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract the parenthetical part from a name, normalised.
 * "TACE (Contollo)" → "contollo"
 */
function normalisedParenthetical(name) {
  if (!name || typeof name !== "string") return "";
  const match = name.match(/\(([^)]+)\)/);
  if (!match) return "";
  return normalise(match[1]);
}

/**
 * Check if two normalised names match.
 * Returns: "exact" | "substring" | "none"
 */
function matchLevel(normA, normB) {
  if (!normA || !normB) return "none";
  if (normA === normB) return "exact";
  if (normA.includes(normB) || normB.includes(normA)) return "substring";
  return "none";
}

/**
 * Given an I&E client name, check if it matches any CRM company.
 * Handles the parenthetical pattern too.
 * Returns the best-matching CRM record, or null.
 */
function findCrmMatch(ieClient, crmNormed) {
  const ieNorm = normalise(ieClient);
  const ieParen = normalisedParenthetical(ieClient);

  for (const crm of crmNormed) {
    // Direct normalised comparison
    const direct = matchLevel(ieNorm, crm.norm);
    if (direct === "exact" || direct === "substring") return { crm, level: direct };

    // Parenthetical content vs CRM name (e.g. "TACE (Contollo)" → check "contollo" vs CRM)
    if (ieParen) {
      const parenMatch = matchLevel(ieParen, crm.norm);
      if (parenMatch === "exact" || parenMatch === "substring") {
        return { crm, level: parenMatch + "_paren" };
      }
    }
  }
  return null;
}

// ─── Supabase helpers ─────────────────────────────────────────────────────────

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY;
  return { url, key };
}

async function supabaseFetch(url, key, path, options = {}) {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: options.prefer ?? "return=representation",
      ...(options.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase ${options.method ?? "GET"} ${path} failed (${res.status}): ${text}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function fetchCrmContacts(supabaseUrl, supabaseKey) {
  const params = new URLSearchParams({
    select: "id,company,contact_name,type,source",
  });
  const rows = await supabaseFetch(supabaseUrl, supabaseKey, `contacts?${params}`);
  return rows ?? [];
}

async function createContact(supabaseUrl, supabaseKey, contact) {
  return supabaseFetch(supabaseUrl, supabaseKey, "contacts", {
    method: "POST",
    prefer: "return=representation",
    body: JSON.stringify(contact),
  });
}

// ─── Google Sheets helper ─────────────────────────────────────────────────────

async function fetchIeSheet(apiKey) {
  const tab = encodeURIComponent(SHEET_TAB);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${tab}?key=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Sheets fetch failed (${res.status}): ${text}`);
  }
  const data = await res.json();
  return data.values ?? [];
}

// ─── Row parsing ──────────────────────────────────────────────────────────────

function parseIeRows(rows) {
  // Skip header row (row 0)
  const data = rows.slice(1);
  const seen = new Set();
  const clients = [];

  for (const row of data) {
    const client = (row[COL_CLIENT] ?? "").trim();
    if (!client) continue;

    const progress = (row[COL_PROGRESS] ?? "").trim();
    // Only process rows that have a Progress value (active/tracked work)
    if (!progress) continue;

    const key = client.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    clients.push({
      client,
      project: (row[COL_PROJECT] ?? "").trim(),
      projectType: (row[COL_PROJECT_TYPE] ?? "").trim(),
      notes: (row[COL_NOTES] ?? "").trim(),
      progress,
    });
  }

  return clients;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!verifyAuth(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const autoAdd =
    req.query?.auto_add === "true" ||
    req.body?.auto_add === true ||
    req.body?.auto_add === "true";

  const dryRun = req.query?.dry_run === "true" || !autoAdd;

  const googleApiKey = process.env.GOOGLE_SHEETS_API_KEY;
  if (!googleApiKey) {
    return res.status(500).json({ error: "GOOGLE_SHEETS_API_KEY not configured" });
  }

  const { url: supabaseUrl, key: supabaseKey } = getSupabaseConfig();
  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: "Supabase env vars not configured" });
  }

  const runDate = new Date().toISOString().slice(0, 10);

  // ── 1. Fetch I&E sheet ──────────────────────────────────────────────────────
  let ieRows;
  try {
    ieRows = await fetchIeSheet(googleApiKey);
  } catch (err) {
    return res.status(500).json({ error: `Failed to fetch I&E sheet: ${err.message}` });
  }

  const ieClients = parseIeRows(ieRows);
  console.log(`[ie-crm-gap-check] I&E sheet: ${ieClients.length} unique active clients`);

  // ── 2. Fetch CRM contacts ───────────────────────────────────────────────────
  let crmContacts;
  try {
    crmContacts = await fetchCrmContacts(supabaseUrl, supabaseKey);
  } catch (err) {
    return res.status(500).json({ error: `Failed to fetch CRM contacts: ${err.message}` });
  }

  // Pre-normalise CRM company names for efficiency
  const crmNormed = crmContacts.map((c) => ({
    ...c,
    norm: normalise(c.company ?? ""),
  }));

  console.log(`[ie-crm-gap-check] CRM: ${crmContacts.length} contacts loaded`);

  // ── 3. Gap detection ────────────────────────────────────────────────────────
  const gaps = [];
  const matched = [];

  for (const ie of ieClients) {
    const result = findCrmMatch(ie.client, crmNormed);
    if (result) {
      matched.push({ ieClient: ie.client, crmCompany: result.crm.company, level: result.level });
    } else {
      gaps.push(ie);
    }
  }

  console.log(`[ie-crm-gap-check] Gaps found: ${gaps.length} | Matched: ${matched.length}`);

  // ── 4. Auto-add or log only ─────────────────────────────────────────────────
  const created = [];
  const createErrors = [];

  if (!dryRun && gaps.length > 0) {
    for (const gap of gaps) {
      const noteParts = [];
      if (gap.project) noteParts.push(`I&E: ${gap.project}`);
      if (gap.notes) noteParts.push(gap.notes);

      const contact = {
        company: gap.client,
        type: "Warm Lead",
        source: `Income & Expenditure`,
        notes: noteParts.join(" — ") || null,
      };

      try {
        const result = await createContact(supabaseUrl, supabaseKey, contact);
        const newId = Array.isArray(result) ? result[0]?.id : result?.id;
        created.push({ company: gap.client, id: newId, project: gap.project });
        console.log(`[ie-crm-gap-check] Created contact: ${gap.client} (id: ${newId})`);
      } catch (err) {
        const msg = `Failed to create ${gap.client}: ${err.message}`;
        createErrors.push(msg);
        console.error(`[ie-crm-gap-check] ${msg}`);
      }
    }
  }

  // ── 5. Build summary ────────────────────────────────────────────────────────
  const summary = {
    run_date: runDate,
    ie_clients_checked: ieClients.length,
    crm_contacts_loaded: crmContacts.length,
    gaps_found: gaps.length,
    gaps: gaps.map((g) => ({
      client: g.client,
      project: g.project,
      progress: g.progress,
    })),
    matched_count: matched.length,
    auto_add_enabled: !dryRun,
    contacts_created: created.length,
    created,
    errors: createErrors,
  };

  // Log concise output for scheduled task runner to capture
  if (gaps.length === 0) {
    console.log("[ie-crm-gap-check] All I&E clients accounted for in CRM. No gaps.");
  } else {
    console.log(`[ie-crm-gap-check] ${gaps.length} gap(s) found:`);
    for (const g of gaps) {
      const status = created.find((c) => c.company === g.client)
        ? "→ CREATED"
        : dryRun
        ? "→ (dry run — not created)"
        : "→ FAILED";
      console.log(`  - ${g.client} [${g.progress}] ${status}`);
    }
  }

  return res.status(200).json(summary);
}
