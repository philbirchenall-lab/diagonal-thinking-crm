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
 *   CRON_SECRET                    — Authorization: Bearer <token>
 *   GOOGLE_SERVICE_ACCOUNT_JSON    — stringified JSON of a Google Cloud service
 *                                    account key with access to the I&E sheet.
 *                                    The service account email (`client_email`
 *                                    field inside the JSON) must be granted at
 *                                    least "Viewer" on the I&E sheet via Share.
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
 *
 * Auth change (14 Apr 2026):
 *   Original implementation supported GOOGLE_SHEETS_API_KEY or a CSV export fallback
 *   that required the sheet to be public ("Anyone with link can view"). Phil chose
 *   to keep the I&E sheet private, so this endpoint now authenticates as a Google
 *   Cloud service account via a signed JWT. The service account must be granted
 *   Viewer access on the I&E sheet.
 */

import { JWT } from "google-auth-library";

const IE_SHEET_ID = "11DYOTeszgC3NAqxazK3EsPBvG2hKgjITL40Wa3mE73c";
const IE_SHEET_TAB = "26-27 Income";
const SHEETS_READ_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";

// ─── Auth ─────────────────────────────────────────────────────────────────────

function verifyAuth(req) {
  const cronSecret = process.env.CRON_SECRET;
  // SEC-API-009 — fail-closed: never allow if CRON_SECRET is unset
  if (!cronSecret) return false;
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

// ─── Google service account ───────────────────────────────────────────────────
//
// SEC-API-010 (Hex risk register, 30 Apr 2026): the service account JSON key
// lives in a Vercel env var. Per the rotation runbook in the PR that
// introduced these checks, the value should be stored as a Sensitive
// environment variable in Vercel (so it is masked in the dashboard and not
// returned by the Vercel API), and rotated quarterly via the Google Cloud
// Console. See: wiki/security/risk-register-2026-04-30.md#api-010.
//
// The fail-fast checks below are deliberate: if the env var is missing,
// empty, malformed, or shaped wrong, we throw a clear error here rather
// than letting cryptic JSON / PEM / OAuth errors surface several layers
// deeper inside google-auth-library.

/**
 * Parse GOOGLE_SERVICE_ACCOUNT_JSON into a credentials object.
 * Accepts the raw JSON string pasted from a downloaded service account key.
 * Handles the common \\n → \n conversion required when the private_key field
 * is stored flat as an env var.
 *
 * Throws a clear, actionable Error if the env var is missing, empty,
 * malformed, or missing required fields. Callers should let the error
 * propagate — it is intended to surface in the cron run log so Phil sees
 * "rotate the key, the new one is broken" rather than an opaque OAuth
 * failure 200ms later.
 */
function parseServiceAccountCredentials() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  // Treat both unset and whitespace-only as "not set". Vercel sometimes
  // round-trips an empty string when an env var is "removed but not deleted".
  if (!raw || raw.trim() === "") {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON env var is not set (or is empty). " +
        "Add the stringified JSON of a Google Cloud service account key with " +
        "Viewer access on the I&E sheet. See SEC-API-010 rotation runbook."
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON: ${err.message}. ` +
        `Re-export the key from Google Cloud Console and paste the full file contents into Vercel.`
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON parsed to a non-object. Expected a service account key JSON object."
    );
  }

  if (!parsed.client_email || !parsed.private_key) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON is missing client_email or private_key fields. " +
        "Confirm the value pasted into Vercel is a service account key (not an OAuth client secret)."
    );
  }

  if (typeof parsed.client_email !== "string" || !parsed.client_email.includes("@")) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON client_email is not a valid email string."
    );
  }

  if (typeof parsed.private_key !== "string") {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON private_key is not a string."
    );
  }

  // When env vars are set via Vercel dashboard, newlines inside private_key
  // are often stored as the two-character sequence "\n" rather than actual
  // line breaks. Normalise so the PEM parser is happy.
  if (parsed.private_key.includes("\\n")) {
    parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
  }

  if (!parsed.private_key.includes("BEGIN PRIVATE KEY") && !parsed.private_key.includes("BEGIN RSA PRIVATE KEY")) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON private_key does not look like a PEM block. " +
        "Expected a string containing '-----BEGIN PRIVATE KEY-----'. Re-export the key from Google Cloud Console."
    );
  }

  return parsed;
}

/**
 * Build a JWT client authorised for read-only Sheets access and return it.
 * The client caches its access token internally across calls.
 */
function buildSheetsClient() {
  const creds = parseServiceAccountCredentials();
  return new JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: [SHEETS_READ_SCOPE],
  });
}

// ─── Google Sheets access ─────────────────────────────────────────────────────

/**
 * Fetch all rows from the I&E 26-27 Income tab using a signed service account
 * JWT. Returns an array of raw row arrays (header row stripped).
 */
async function fetchIESheetRows() {
  const client = buildSheetsClient();
  const range = encodeURIComponent(`'${IE_SHEET_TAB}'!A:K`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${IE_SHEET_ID}/values/${range}`;

  // JWT.request() signs the call with a fresh OAuth2 access token from the
  // service account key and handles token refresh. We ask for JSON explicitly.
  const res = await client.request({
    url,
    method: "GET",
    responseType: "json",
  });

  const rows = res?.data?.values ?? [];
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
    // SEC-API-006 — log details server-side, return generic message to caller.
    console.error("[ie-crm-gap-check] fetchIESheetRows failed:", err);
    return res.status(500).json({ error: "Internal Server Error" });
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
    // SEC-API-006 — log details server-side, return generic message to caller.
    console.error("[ie-crm-gap-check] fetch CRM contacts failed:", err);
    return res.status(500).json({ error: "Internal Server Error" });
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
