import { createHash } from "crypto";
import { getSupabaseAdmin } from "./_lib/client-area.js";
import { OPT_IN_COLUMN } from "./_lib/mailchimp-config.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = (process.env.MAILCHIMP_API_KEY || "").trim();
  const audienceId = process.env.MAILCHIMP_AUDIENCE_ID;

  if (!apiKey || !audienceId) {
    return res.status(500).json({
      error:
        "Mailchimp not configured. Add MAILCHIMP_API_KEY and MAILCHIMP_AUDIENCE_ID to Vercel env vars.",
    });
  }

  // Extract datacenter: prefer MAILCHIMP_SERVER env var, strip any trailing domain content
  // e.g. "us21.api.mailchimp.com" -> "us21", or fall back to parsing the API key
  const server = (process.env.MAILCHIMP_SERVER || apiKey.split("-").pop() || "").trim().split(".")[0];
  const baseUrl = `https://${server}.api.mailchimp.com/3.0`;
  const authHeader =
    "Basic " + Buffer.from(`anystring:${apiKey}`).toString("base64");

  const { contacts } = req.body;
  if (!Array.isArray(contacts) || contacts.length === 0) {
    return res.status(400).json({ error: "No contacts provided" });
  }

  // ─── MAIL-SYNC-001 outbound opt-out guard ────────────────────────────
  // Filter out any contact whose email_marketing_opt_in is false BEFORE
  // we hit Mailchimp. Mailchimp opt-out is GROUND TRUTH; the inbound
  // webhook flips this column whenever a contact unsubscribes, and this
  // guard stops the next outbound sync silently re-adding them.
  // Spec ref: section 5.5. Acceptance criteria: section 8.2.
  let optOutSkipped = 0;
  const optOutSkippedIds = [];
  let permittedContacts = contacts;
  try {
    const ids = contacts.map((c) => c.id).filter(Boolean);
    if (ids.length > 0) {
      const supabase = getSupabaseAdmin();
      const { data: optInRows, error: optInErr } = await supabase
        .from("contacts")
        .select(`id, ${OPT_IN_COLUMN}`)
        .in("id", ids);

      if (optInErr) {
        console.error(
          `[mailchimp-sync] opt-out guard query failed (${optInErr.message}). Failing closed: aborting sync.`,
        );
        return res.status(500).json({
          error:
            "Could not verify marketing opt-in status before sync. Aborting to avoid re-adding any opted-out contact.",
        });
      }

      const optInById = new Map(
        (optInRows || []).map((r) => [r.id, r[OPT_IN_COLUMN] !== false]),
      );

      permittedContacts = contacts.filter((c) => {
        // Default-true posture: if a contact id is missing from the
        // Supabase result the column may not exist yet (pre-migration)
        // OR the row was deleted between request build and sync. In
        // either case we keep the existing behaviour (push to Mailchimp)
        // for backward compatibility. The Edge Function path provides
        // a second layer of defence in depth.
        const optedIn = optInById.has(c.id) ? optInById.get(c.id) : true;
        if (!optedIn) {
          optOutSkipped += 1;
          optOutSkippedIds.push(c.id);
        }
        return optedIn;
      });

      if (optOutSkipped > 0) {
        console.log(
          `[mailchimp-sync] opt-out guard: skipped ${optOutSkipped} contact(s) flagged email_marketing_opt_in=false. ids=${optOutSkippedIds.join(",")}`,
        );
      }
    }
  } catch (guardErr) {
    console.error(
      `[mailchimp-sync] opt-out guard threw (${guardErr.message}). Failing closed: aborting sync.`,
    );
    return res.status(500).json({
      error:
        "Could not verify marketing opt-in status before sync. Aborting to avoid re-adding any opted-out contact.",
    });
  }

  if (permittedContacts.length === 0) {
    return res.status(200).json({
      added: 0,
      updated: 0,
      skipped: 0,
      optOutSkipped,
      optOutSkippedIds,
      syncedIds: [],
      note: "All requested contacts are opted out of marketing email. No Mailchimp call made.",
    });
  }

  // CRM-011: Ensure NETWORK_PARTNER and CRM_TYPE merge fields exist in the audience.
  // Runs once per request (before batching) so new deployments self-configure on first sync.
  await ensureMergeFields(baseUrl, audienceId, authHeader);

  const BATCH_SIZE = 500;
  let totalAdded = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  const syncedIds = [];

  for (let i = 0; i < permittedContacts.length; i += BATCH_SIZE) {
    const batch = permittedContacts.slice(i, i + BATCH_SIZE);

    const members = batch.map((c) => ({
      email_address: c.email,
      status_if_new: "subscribed",
      merge_fields: {
        FNAME: c.fname || "",
        LNAME: c.lname || "",
        COMPANY: c.company || "",
        PIPELINE: c.pipeline || "",
        SERVICES: Array.isArray(c.services) ? c.services.join(", ") : (c.services || ""),
        // CRM-011: segmentation fields
        // NOTE: Mailchimp merge field tags max 10 chars; use NETPARTNER (10) not NETWORK_PARTNER (15).
        NETPARTNER: c.network_partner ? "Yes" : "No",
        CRM_TYPE: c.type || "",
        // MAIL-003: acquisition source field
        SOURCE: c.source || "",
      },
    }));

    let mcRes, data;
    try {
      mcRes = await fetch(`${baseUrl}/lists/${audienceId}`, {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ members, update_existing: true }),
      });

      if (!mcRes.ok) {
        const errData = await mcRes.json().catch(() => ({}));
        return res.status(mcRes.status).json({
          error: errData.detail || errData.title || "Mailchimp API error",
        });
      }

      data = await mcRes.json();
    } catch (err) {
      return res.status(500).json({
        error: `Mailchimp request failed: ${err.message}`,
      });
    }
    totalAdded += data.total_created ?? 0;
    totalUpdated += data.total_updated ?? 0;
    totalSkipped += data.error_count ?? 0;

    for (const c of batch) {
      syncedIds.push(c.id);
    }

    // CRM-011: Apply services as Mailchimp tags (one tag per service).
    // Existing non-service tags on each contact are preserved (we only add, never wipe).
    await applyServiceTags(batch, baseUrl, audienceId, authHeader);
  }

  return res.status(200).json({
    added: totalAdded,
    updated: totalUpdated,
    skipped: totalSkipped,
    optOutSkipped,
    optOutSkippedIds,
    syncedIds,
  });
}

/**
 * CRM-011: Ensure NETWORK_PARTNER (text) and CRM_TYPE (text) merge fields exist
 * in the Mailchimp audience. Creates them via the API if absent.
 * Failures are swallowed so they never block the main sync.
 */
async function ensureMergeFields(baseUrl, audienceId, authHeader) {
  try {
    const res = await fetch(
      `${baseUrl}/lists/${audienceId}/merge-fields?count=100`,
      { headers: { Authorization: authHeader } }
    );
    if (!res.ok) return;

    const data = await res.json();
    const existingTags = new Set(
      (data.merge_fields || []).map((f) => f.tag)
    );

    const required = [
      // NOTE: Mailchimp merge field tags are limited to 10 characters.
      // NETPARTNER (10 chars) is correct; NETWORK_PARTNER (15 chars) would be rejected silently.
      { tag: "NETPARTNER", name: "Network Partner", type: "text" },
      { tag: "CRM_TYPE", name: "CRM Type", type: "text" },
      // MAIL-003: SOURCE (6 chars) is the contact acquisition source.
      { tag: "SOURCE", name: "Source", type: "text" },
    ];

    for (const field of required) {
      if (!existingTags.has(field.tag)) {
        const createRes = await fetch(`${baseUrl}/lists/${audienceId}/merge-fields`, {
          method: "POST",
          headers: {
            Authorization: authHeader,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            tag: field.tag,
            name: field.name,
            type: field.type,
          }),
        });
        if (!createRes.ok) {
          const errBody = await createRes.text().catch(() => "(unreadable)");
          console.error(`[ensureMergeFields] Failed to create ${field.tag} (${createRes.status}): ${errBody}`);
        } else {
          console.log(`[ensureMergeFields] Created merge field: ${field.tag}`);
        }
      }
    }
  } catch (_) {
    // Non-fatal: merge field creation failure should not block contact sync.
  }
}

/**
 * CRM-011: Apply each contact's services array as Mailchimp tags.
 * Only contacts with a non-empty services array are processed.
 * Existing tags on the Mailchimp contact that are not in this services list
 * are left untouched: we never strip tags added outside the CRM.
 */
async function applyServiceTags(batch, baseUrl, audienceId, authHeader) {
  for (const c of batch) {
    if (!c.email) continue;
    const services = Array.isArray(c.services) ? c.services : [];
    if (services.length === 0) continue;

    const subscriberHash = createHash("md5")
      .update(c.email.toLowerCase())
      .digest("hex");

    const tags = services.map((s) => ({ name: String(s), status: "active" }));

    try {
      await fetch(
        `${baseUrl}/lists/${audienceId}/members/${subscriberHash}/tags`,
        {
          method: "POST",
          headers: {
            Authorization: authHeader,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ tags }),
        }
      );
    } catch (_) {
      // Non-fatal: tag sync failure should not abort the broader contact sync.
    }
  }
}
