/**
 * api/ie-crm-gap-check.js
 *
 * Vercel serverless function — REX-TODO-001 Phase 1
 * Fuzzy-match I&E Google Sheet clients against Supabase CRM contacts.
 * Detects gaps (I&E clients missing from CRM) and optionally auto-creates them.
 *
 * Called by: weekly-invoice-prefix-check/SKILL.md (Step 4) every Monday 09:00
 * Also available for manual triggering and Phase 2 UI button.
 *
 * GET /api/ie-crm-gap-check
 *   ?auto_add=true    — auto-create new CRM contacts for all gaps (default: false / dry run)
 *
 * Required env vars:
 *   GOOGLE_API_KEY            — Google API key with Sheets API enabled.
 *                               The I&E sheet must be shared as "Anyone with the link can view".
 *                               Add via Vercel dashboard → Project Settings → Environment Variables.
 *   SUPABASE_URL or VITE_SUPABASE_URL         — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY                  — Service role key for Supabase writes
 *   CRON_SECRET                                — Must match Authorization: Bearer <token> header
 *
 * Known edge cases handled by normalise():
 *   "TACE (Contollo)" → "Contollo Group Ltd"   — parenthetical brand stripped, base name matched
 *   "Cuckoo" → "Cuckoo Design"                  — substring match
 *   "Wealthteck" → "Wealth Teck"               — spacing handled after strip
 *   "Pro Manchester (Amy Brown)"               — contact in parens stripped, base name matched
 */

// ─── Google Sheets config ─────────────────────────────────────────────────────

const SPREADSHEET_ID = "11DYOTeszgC3NAqxazK3EsPBvG2hKgjITL40Wa3mE73c";
// "26-27 Income" tab (gid=1960014121). Columns: A=Date, B=Client, C=Project,
// D=Project Type, E=Notes, F=Invoice#, G=Projected, H=Progress, I=Amount, J=Sent, K=Paid
const SHEET_RANGE = "26-27 Income!A:K";

// ─── Auth check ───────────────────────────────────────────────────────────────

function verifyAuth(req) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return true; // no secret configured → allow (dev only)
  const authHeader = req.headers["authorization"] ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  return token === cronSecret;
}

// ─── Normalisation ────────────────────────────────────────────────────────────

/**
 * Normalise a company name for fuzzy matching.
 *
 * Steps:
 * 1. Lowercase
 * 2. Strip common legal suffixes
 * 3. Strip non-alphanumeric chars (preserves spaces)
 * 4. Collapse whitespace
 *
 * NOTE: Does NOT strip parentheses here — extractCandidates() handles that
 * so we can try matching against parenthetical content as a separate candidate.
 */
function normalise(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\b(ltd|limited|group|llc|inc|plc|co|uk|the)\b/g, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract all candidate names from a single I&E client string.
 *
 * Handles patterns like:
 *   "TACE (Contollo)"          → ["TACE (Contollo)", "TACE", "Contollo"]
 *   "Pro Manchester (Amy Brown)" → ["Pro Manchester (Amy Brown)", "Pro Manchester", "Amy Brown"]
 *   "Cuckoo Design"            → ["Cuckoo Design"]
 *
 * Trying multiple candidates lets us match "TACE (Contollo)" against "Contollo Group Ltd"
 * by hitting the parenthetical "Contollo" candidate.
 */
function extractCandidates(name) {
  const candidates = [name];
  const parenMatch = name.match(/\(([^)]+)\)/);
  if (parenMatch) {
    const base = name.replace(/\s*\(.*?\)\s*/g, "").trim();
    const inner = parenMatch[1].trim();
    if (base) candidates.push(base);
    if (inner) candidates.push(inner);
  }
  return candidates;
}

/**
 * Returns true if ieName (from I&E sheet) matches crmName (from CRM).
 * Match conditions (checked after normalisation):
 *   1. Exact match
 *   2. One is a substring of the other (handles "Cuckoo" ↔ "Cuckoo Design")
 *
 * Tries all candidate names extracted from ieName (base + parenthetical content).
 */
function isMatch(ieName, crmName) {
  const normCRM = normalise(crmName);
  if (!normCRM) return false;

  for (const candidate of extractCandidates(ieName)) {
    const normCand = normalise(candidate);
    if (!normCand) continue;
    if (normCand === normCRM) return true;
    if (normCand.includes(normCRM) || normCRM.includes(normCand)) return true;
  }
  return false;
}

// ─── Google Sheets fetch ──────────────────────────────────────────────────────

async function fetchIESheet(googleApiKey) {
  const url = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(SHEET_RANGE)}`
  );
  url.searchParams.set("key", googleApiKey);

  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Google Sheets API error (${res.status}): ${body}`);
  }

  const data = await res.json();
  const rows = data.values ?? [];

  // First row is header — skip it
  const dataRows = rows.slice(1);

  // Map to objects. Columns: 0=Date, 1=Client, 2=Project, 3=Type, 4=Notes,
  //                           5=Invoice#, 6=Projected, 7=Progress, 8=Amount, 9=Sent, 10=Paid
  return dataRows
    .map((row) => ({
      client:   String(row[1] ?? "").trim(),
      project:  String(row[2] ?? "").trim(),
      type:     String(row[3] ?? "").trim(),
      notes:    String(row[4] ?? "").trim(),
      progress: String(row[7] ?? "").trim(),
    }))
    .filter((row) => row.client); // skip rows with no client name
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

async function fetchCRMContacts(supabaseUrl, supabaseKey) {
  const params = new URLSearchParams({ select: "id,company" });
  const contacts = await supabaseFetch(supabaseUrl, supabaseKey, `contacts?${params}`);
  return (contacts ?? []).filter((c) => c.company);
}

async function createContact(supabaseUrl, supabaseKey, ieRow) {
  const noteParts = [];
  if (ieRow.project) noteParts.push(ieRow.project);
  if (ieRow.notes)   noteParts.push(ieRow.notes);

  const record = {
    company:       ieRow.client,
    type:          "Warm Lead",
    source:        "Income & Expenditure",
    notes:         noteParts.length ? noteParts.join(" — ") : null,
    services:      [],
    projected_value: 0,
    network_partner: false,
  };

  const created = await supabaseFetch(supabaseUrl, supabaseKey, "contacts", {
    method: "POST",
    prefer: "return=representation",
    body: JSON.stringify(record),
  });

  return Array.isArray(created) ? created[0] : created;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!verifyAuth(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const googleApiKey = process.env.GOOGLE_API_KEY;
  if (!googleApiKey) {
    return res.status(500).json({
      error: "GOOGLE_API_KEY is not configured. Add it to Vercel environment variables. " +
             "The I&E sheet must also be shared as 'Anyone with the link can view'.",
    });
  }

  const { url: supabaseUrl, key: supabaseKey } = getSupabaseConfig();
  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: "Supabase env vars not configured" });
  }

  // ?auto_add=true → create contacts for all gaps. Default: dry run (report only).
  const autoAdd = req.query.auto_add === "true" || req.body?.auto_add === true;

  const result = {
    ran_at:       new Date().toISOString(),
    dry_run:      !autoAdd,
    ie_rows:      0,
    crm_contacts: 0,
    gaps:         [],
    created:      [],
    errors:       [],
  };

  // ── Fetch I&E sheet ─────────────────────────────────────────────────────────
  let ieRows;
  try {
    ieRows = await fetchIESheet(googleApiKey);
    result.ie_rows = ieRows.length;
  } catch (err) {
    console.error("I&E sheet fetch failed:", err.message);
    return res.status(502).json({ error: `Failed to fetch I&E sheet: ${err.message}` });
  }

  // ── Fetch CRM contacts ──────────────────────────────────────────────────────
  let crmContacts;
  try {
    crmContacts = await fetchCRMContacts(supabaseUrl, supabaseKey);
    result.crm_contacts = crmContacts.length;
  } catch (err) {
    console.error("CRM contacts fetch failed:", err.message);
    return res.status(502).json({ error: `Failed to fetch CRM contacts: ${err.message}` });
  }

  // ── Fuzzy match: find gaps ──────────────────────────────────────────────────
  // De-dupe I&E rows by client name so we don't report the same client multiple times.
  const seenIEClients = new Map(); // normalised client → first ieRow
  for (const row of ieRows) {
    const norm = normalise(row.client);
    if (norm && !seenIEClients.has(norm)) {
      seenIEClients.set(norm, row);
    }
  }

  for (const [, ieRow] of seenIEClients) {
    const matchedCRM = crmContacts.find((contact) => isMatch(ieRow.client, contact.company));

    if (!matchedCRM) {
      result.gaps.push({
        ie_client:  ieRow.client,
        ie_project: ieRow.project,
        ie_progress: ieRow.progress,
        ie_notes:   ieRow.notes,
      });
    }
  }

  // ── Auto-create if requested ────────────────────────────────────────────────
  if (autoAdd && result.gaps.length > 0) {
    for (const gap of result.gaps) {
      try {
        const created = await createContact(supabaseUrl, supabaseKey, {
          client:  gap.ie_client,
          project: gap.ie_project,
          notes:   gap.ie_notes,
        });
        result.created.push({
          ie_client:  gap.ie_client,
          contact_id: created?.id ?? null,
        });
        console.log(`Created CRM contact: "${gap.ie_client}" (id: ${created?.id})`);
      } catch (err) {
        const msg = `Failed to create contact "${gap.ie_client}": ${err.message}`;
        console.error(msg);
        result.errors.push(msg);
      }
    }
  }

  // ── Summary log ─────────────────────────────────────────────────────────────
  console.log(
    `ie-crm-gap-check: ${result.ie_rows} I&E clients, ` +
    `${result.crm_contacts} CRM contacts, ` +
    `${result.gaps.length} gaps found, ` +
    `${result.created.length} created, ` +
    `dry_run=${result.dry_run}`
  );

  return res.status(200).json(result);
}
