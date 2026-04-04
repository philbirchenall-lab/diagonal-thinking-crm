import { createHash } from "crypto";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = (process.env.MAILCHIMP_API_KEY || "").trim();
  const audienceId = process.env.MAILCHIMP_AUDIENCE_ID;

  if (!apiKey || !audienceId) {
    return res.status(500).json({
      error:
        "Mailchimp not configured — add MAILCHIMP_API_KEY and MAILCHIMP_AUDIENCE_ID to Vercel env vars",
    });
  }

  // Extract datacenter: prefer MAILCHIMP_SERVER env var, strip any trailing domain content
  // e.g. "us21.api.mailchimp.com" → "us21", or fall back to parsing the API key
  const server = (process.env.MAILCHIMP_SERVER || apiKey.split("-").pop() || "").trim().split(".")[0];
  const baseUrl = `https://${server}.api.mailchimp.com/3.0`;
  const authHeader =
    "Basic " + Buffer.from(`anystring:${apiKey}`).toString("base64");

  const { contacts } = req.body;
  if (!Array.isArray(contacts) || contacts.length === 0) {
    return res.status(400).json({ error: "No contacts provided" });
  }

  // CRM-011: Ensure NETWORK_PARTNER and CRM_TYPE merge fields exist in the audience.
  // Runs once per request (before batching) so new deployments self-configure on first sync.
  await ensureMergeFields(baseUrl, audienceId, authHeader);

  const BATCH_SIZE = 500;
  let totalAdded = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  const syncedIds = [];

  for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
    const batch = contacts.slice(i, i + BATCH_SIZE);

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
        // Note: Mailchimp truncates tags to 10 chars — NETWORK_PARTNER was stored as NETWORK_PA
        NETWORK_PA: c.network_partner ? "Yes" : "No",
        CRM_TYPE: c.type || "",
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
    // Existing non-service tags on each contact are preserved — we only add, never wipe.
    await applyServiceTags(batch, baseUrl, audienceId, authHeader);
  }

  return res.status(200).json({
    added: totalAdded,
    updated: totalUpdated,
    skipped: totalSkipped,
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

    // Mailchimp truncates tags to 10 chars — use NETWORK_PA (10 chars), not NETWORK_PARTNER (14)
    const required = [
      { tag: "NETWORK_PA", name: "Network Partner", type: "text" },
      { tag: "CRM_TYPE", name: "CRM Type", type: "text" },
    ];

    for (const field of required) {
      if (!existingTags.has(field.tag)) {
        await fetch(`${baseUrl}/lists/${audienceId}/merge-fields`, {
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
      }
    }
  } catch (_) {
    // Non-fatal — merge field creation failure should not block contact sync
  }
}

/**
 * CRM-011: Apply each contact's services array as Mailchimp tags.
 * Only contacts with a non-empty services array are processed.
 * Existing tags on the Mailchimp contact that are not in this services list
 * are left untouched — we never strip tags added outside the CRM.
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
      // Non-fatal — tag sync failure should not abort the broader contact sync
    }
  }
}
