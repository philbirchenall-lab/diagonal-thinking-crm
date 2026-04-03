export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.MAILCHIMP_API_KEY;
  const audienceId = process.env.MAILCHIMP_AUDIENCE_ID;

  if (!apiKey || !audienceId) {
    return res.status(500).json({
      error:
        "Mailchimp not configured — add MAILCHIMP_API_KEY and MAILCHIMP_AUDIENCE_ID to Vercel env vars",
    });
  }

  // Extract datacenter: prefer MAILCHIMP_SERVER env var, strip any trailing domain content
  // e.g. "us21.api.mailchimp.com" → "us21", or fall back to parsing the API key
  const server = (process.env.MAILCHIMP_SERVER || apiKey.split("-").pop() || "").split(".")[0];
  const baseUrl = `https://${server}.api.mailchimp.com/3.0`;
  const authHeader =
    "Basic " + Buffer.from(`anystring:${apiKey}`).toString("base64");

  const { contacts } = req.body;
  if (!Array.isArray(contacts) || contacts.length === 0) {
    return res.status(400).json({ error: "No contacts provided" });
  }

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
        SERVICES: c.services || "",
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
  }

  return res.status(200).json({
    added: totalAdded,
    updated: totalUpdated,
    skipped: totalSkipped,
    syncedIds,
  });
}
