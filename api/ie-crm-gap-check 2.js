/**
 * api/ie-crm-gap-check.js
 *
 * Vercel serverless function — REX-TODO-001 Phase 1
 * Detects companies in the I&E Income tab that are missing from Supabase CRM contacts,
 * using fuzzy name matching. Called from the weekly-invoice-prefix-check task (Step 4).
 *
 * Usage:
 *   GET /api/ie-crm-gap-check                — dry run (list gaps, no writes)
 *   GET /api/ie-crm-gap-check?auto_add=true  — create missing contacts in CRM
 *
 * Required env vars:
 *   SUPABASE_URL or VITE_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY (preferred) or VITE_SUPABASE_ANON_KEY
 *   CRON_SECRET                              — Authorization: Bearer <token>
 *
 * Optional env vars:
 *   GOOGLE_SHEETS_API_KEY                    — enables Sheets API v4 (more reliable).
 *                                              If not set, falls back to CSV export URL,
 *                                              which requires the sheet to be set to
 *                                              "Anyone with the link can view".
 *
 * I&E Google Sheet: https://docs.google.com/spreadsheets/d/11DYOTeszgC3NAqxazK3EsPBvG2hKgjITL40Wa3mE73c/
 * Tab: 26-27 Income (gid=1960014121)
 * Columns: A=Date, B=Client, C=Project, D=Project Type, E=Notes, F=Invoice Number,
 *          G=Projected, H=Progress, I=Invoice Amount, J=Sent, K=Paid
 *
 * Fuzzy match logic (brief: REX-TODO-001, normalisation from Sol audit 5 Apr 2026):
 *   - Normalise: lowercase, strip parentheticals, strip legal suffixes, strip punctuation
 *   - Exact match after normalisation → already in CRM
 *   - One normalised string is a substring of the other → already in CRM (short/long name variant)
 *   - No match → gap found
 *
 * Known edge cases handled:
 *   "TACE (Contollo)" vs "Contollo Group Ltd"  — parenthetical stripped, then substring match
 *   "Cuckoo" vs "Cuckoo Design"                — substring match
 *   "Wealthteck" vs "Wealth Teck"              — spacing normalised → same token
 *   "Pro Manchester (Amy Brown)"               — parenthetical stripped → base name matched
 */

const IE_SHEET_ID = "11DYOTeszgC3NAqxazK3EsPBvG2hKgjITL40Wa3mE73c";
const IE_SHEET_GID = "1960014121";
const IE_SHEET_TAB = "26-27 Income";

// ─── Auth ─────────────────────────────────────────────────────────────────────

function verifyAuth(req) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return true; // no secret configured → allow (dev only)
  const authHeader = req.headers["authorization"] ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  return token === cronSecret;
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
    throw new Error(`Supabase ${options.method ?? "GET"} /${path} failed (${res.status}): ${text}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ─── Google Sheets access ─────────────────────────────────────────────────────

/**
 * Minimal CSV parser. Handles quoted fields with embedded commas.
 * Returns array of string arrays (rows × columns).
 */
function parseCSV(text) {
  const rows = [];
  // Split on \r\n or \n
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    const cells = [];
    let inQuote = false;
    let cell = "";
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') {
          // Escaped double-quote inside a quoted field
          cell += '"';
          i++;
        } else {
          inQuote = !inQuote;
        }
      } else if (ch === "," && !inQuote) {
        cells.push(cell);
        cell = "";
      } else {
        cell += ch;
      }
    }
    cells.push(cell);
    rows.push(cells);
  }
  return rows;
}

/**
 * Fetch all rows from the I&E 26-27 Income tab.
 * Returns an array of raw row arrays (header row stripped).
 *
 * Primary:  Google Sheets API v4 (GOOGLE_SHEETS_API_KEY env var)
 * Fallback: CSV export URL (requires sheet to be "Anyone with link can view")
 */
async function fetchIESheetRows() {
  const apiKey = process.env.GOOGLE_SHEETS_API_KEY;

  if (apiKey) {
    const range = encodeURIComponent(`'${IE_SHEET_TAB}'!A:K`);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${IE_SHEET_ID}/values/${range}?key=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Sheets API v4 error (${res.status}): ${body}`);
    }
    const data = await res.json();
    const rows = data.values ?? [];
    return rows.slice(1); // strip header row
  }

  // Fallback: CSV export (requires public "Anyone with link can view" permission)
  const url = `https://docs.google.com/spreadsheets/d/${IE_SHEET_ID}/export?format=csv&gid=${IE_SHEET_GID}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Sheet CSV export failed (${res.status}). ` +
        `Set GOOGLE_SHEETS_API_KEY env var, or ensure the I&E sheet is set to "Anyone with the link can view".`
    );
  }
  const text = await res.text();
  const rows = parseCSV(text);
  return rows.slice(1); // strip header row
}

// ─── Parse I&E rows ───────────────────────────────────────────────────────────

/**
 * Convert a raw sheet row array into a structured record.
 * Columns: A=Date, B=Client, C=Project, D=ProjectType, E=Notes, F=InvoiceNum,
 *          G=Projected, H=Progress, I=InvoiceAmount, J=Sent, K=Paid
 */
function parseIERow(row) {
  return {
    client: (row[1] ?? "").trim(),
    project: (row[2] ?? "").trim(),
    projectType: (row[3] ?? "").trim(),
    notes: (row[4] ?? "").trim(),
    progress: (row[7] ?? "").trim(),
    projected: parseFloat((row[6] ?? "").replace(/[£,\s]/g, "")) || 0,
  };
}

// ─── Fuzzy matching ───────────────────────────────────────────────────────────

/**
 * Normalise a company name for fuzzy comparison:
 *  1. Strip parenthetical content — "(Contollo)" → removed
 *  2. Lowercase
 *  3. Strip common legal suffixes
 *  4. Strip punctuation
 *  5. Collapse whitespace
 */
function normalise(name) {
  if (!name) return "";
  return name
    .replace(/\s*\([^)]*\)/g, "") // strip "(anything)"
    .toLowerCase()
    .replace(/\b(ltd|limited|group|llc|inc|plc|co|uk)\b/g, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Check whether an I&E client name already exists in the CRM company list.
 * Matching rules (from REX-TODO-001 brief):
 *  - exact match after normalisation → matched
 *  - one normalised string is a substring of the other → matched
 *  - exact match after additionally stripping all spaces → matched
 *    (handles spacing inconsistencies e.g. "Wealthteck" vs "Wealth Teck")
 *
 * Returns { matched, matchedCompany, matchType }
 */
function fuzzyMatch(ieName, crmCompanies) {
  const normIe = normalise(ieName);
  if (!normIe) return { matched: false, matchedCompany: null, matchType: "none" };

  const normIeCompact = normIe.replace(/\s/g, "");

  for (const crm of crmCompanies) {
    const normCrm = normalise(crm);
    if (!normCrm) continue;

    // Exact match after normalisation
    if (normIe === normCrm) {
      return { matched: true, matchedCompany: crm, matchType: "exact" };
    }

    // Substring match (short name vs long name, e.g. "Cuckoo" ⊂ "Cuckoo Design")
    if (normIe.includes(normCrm) || normCrm.includes(normIe)) {
      return { matched: true, matchedCompany: crm, matchType: "substring" };
    }

    // Space-stripped exact match (e.g. "Wealthteck" vs "Wealth Teck")
    const normCrmCompact = normCrm.replace(/\s/g, "");
    if (normIeCompact === normCrmCompact) {
      return { matched: true, matchedCompany: crm, matchType: "spacing" };
    }
  }

  return { matched: false, matchedCompany: null, matchType: "none" };
}

// ─── Create CRM contact ───────────────────────────────────────────────────────

async function createContact(supabaseUrl, supabaseKey, ieRecord) {
  const { client, project, notes, projected } = ieRecord;
  const notesStr = [project, notes].filter(Boolean).join(" — ") || null;
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  await supabaseFetch(supabaseUrl, supabaseKey, "contacts", {
    method: "POST",
    prefer: "return=minimal",
    body: JSON.stringify({
      id,
      company: client,
      type: "Warm Lead",
      source: "Income & Expenditure",
      notes: notesStr,
      projected_value: projected || 0,
      date_added: now,
      last_updated: now,
    }),
  });

  return id;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!verifyAuth(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { url: supabaseUrl, key: supabaseKey } = getSupabaseConfig();
  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: "Supabase env vars not configured" });
  }

  const autoAdd = req.query.auto_add === "true";

  // ── 1. Fetch I&E Income tab ─────────────────────────────────────────────────
  let sheetRows;
  try {
    sheetRows = await fetchIESheetRows();
  } catch (err) {
    return res.status(500).json({ error: `Failed to fetch I&E sheet: ${err.message}` });
  }

  // Parse rows; skip blanks
  const ieRecords = sheetRows.map(parseIERow).filter((r) => r.client);

  // Dedupe by client name — one gap check per unique company
  const seenClients = new Set();
  const uniqueIEClients = [];
  for (const rec of ieRecords) {
    if (!seenClients.has(rec.client)) {
      seenClients.add(rec.client);
      uniqueIEClients.push(rec);
    }
  }

  // ── 2. Fetch all CRM company names ─────────────────────────────────────────
  let crmRows;
  try {
    crmRows = await supabaseFetch(supabaseUrl, supabaseKey, "contacts?select=id,company");
  } catch (err) {
    return res.status(500).json({ error: `Failed to fetch CRM contacts: ${err.message}` });
  }

  const crmCompanyNames = (crmRows ?? []).map((c) => c.company).filter(Boolean);

  // ── 3. Fuzzy-match and classify ─────────────────────────────────────────────
  const gaps = [];
  const matched = [];

  for (const rec of uniqueIEClients) {
    const result = fuzzyMatch(rec.client, crmCompanyNames);
    if (result.matched) {
      matched.push({
        ieClient: rec.client,
        crmCompany: result.matchedCompany,
        matchType: result.matchType,
      });
    } else {
      gaps.push(rec);
    }
  }

  // ── 4. Auto-create contacts (only when explicitly requested) ────────────────
  const created = [];
  const errors = [];

  if (autoAdd) {
    for (const rec of gaps) {
      try {
        const id = await createContact(supabaseUrl, supabaseKey, rec);
        created.push({ id, company: rec.client, project: rec.project });
        console.log(`[ie-crm-gap-check] created contact → "${rec.client}" (${id})`);
      } catch (err) {
        const msg = `Failed to create "${rec.client}": ${err.message}`;
        console.error(`[ie-crm-gap-check] ${msg}`);
        errors.push(msg);
      }
    }
  }

  // ── 5. Return summary ───────────────────────────────────────────────────────
  const summary = {
    mode: autoAdd ? "auto_add" : "dry_run",
    run_at: new Date().toISOString(),
    ie_clients_checked: uniqueIEClients.length,
    crm_contacts_checked: crmCompanyNames.length,
    gaps_found: gaps.length,
    gaps: gaps.map((r) => ({
      client: r.client,
      project: r.project,
      progress: r.progress,
      projected: r.projected,
    })),
    matched_count: matched.length,
    contacts_created: created.length,
    created,
    errors,
  };

  console.log("[ie-crm-gap-check] summary:", JSON.stringify(summary, null, 2));
  return res.status(200).json(summary);
}
