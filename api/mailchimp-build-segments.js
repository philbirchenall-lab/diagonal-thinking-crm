/**
 * MAIL-002: One-time segment builder for Mailchimp.
 * Creates saved segments for CRM_TYPE, NETWORK_PARTNER, SOURCE, and service tags.
 * Protected by Authorization: Bearer {MAILCHIMP_SEGMENT_SECRET}.
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const secret = process.env.MAILCHIMP_SEGMENT_SECRET;
  if (!secret) {
    return res.status(500).json({ error: "MAILCHIMP_SEGMENT_SECRET not configured" });
  }

  const authHeader = req.headers["authorization"] || "";
  if (authHeader !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const apiKey = (process.env.MAILCHIMP_API_KEY || "").trim();
  const audienceId = process.env.MAILCHIMP_AUDIENCE_ID;

  if (!apiKey || !audienceId) {
    return res.status(500).json({
      error: "MAILCHIMP_API_KEY and MAILCHIMP_AUDIENCE_ID must be set",
    });
  }

  const server = (process.env.MAILCHIMP_SERVER || apiKey.split("-").pop() || "")
    .trim()
    .split(".")[0];
  const baseUrl = `https://${server}.api.mailchimp.com/3.0`;
  const mcAuth = "Basic " + Buffer.from(`anystring:${apiKey}`).toString("base64");

  // --- Segment definitions ---
  const segments = [
    // By CRM_TYPE
    {
      name: "Clients",
      options: {
        match: "all",
        conditions: [{ condition_type: "TextMerge", field: "CRM_TYPE", op: "is", value: "Client" }],
      },
    },
    {
      name: "Leads",
      options: {
        match: "all",
        conditions: [{ condition_type: "TextMerge", field: "CRM_TYPE", op: "is", value: "Lead" }],
      },
    },
    {
      name: "Partners",
      options: {
        match: "all",
        conditions: [{ condition_type: "TextMerge", field: "CRM_TYPE", op: "is", value: "Partner" }],
      },
    },
    {
      name: "Warm Leads",
      options: {
        match: "all",
        conditions: [{ condition_type: "TextMerge", field: "CRM_TYPE", op: "is", value: "Warm Lead" }],
      },
    },
    {
      name: "Cold Leads",
      options: {
        match: "all",
        conditions: [{ condition_type: "TextMerge", field: "CRM_TYPE", op: "is", value: "Cold Lead" }],
      },
    },
    // By NETWORK_PARTNER
    {
      name: "Network Partners",
      options: {
        match: "all",
        conditions: [{ condition_type: "TextMerge", field: "NETWORK_PARTNER", op: "is", value: "Yes" }],
      },
    },
    // By SOURCE
    {
      name: "Source: LinkedIn",
      options: {
        match: "all",
        conditions: [{ condition_type: "TextMerge", field: "SOURCE", op: "is", value: "LinkedIn" }],
      },
    },
    {
      name: "Source: Referral",
      options: {
        match: "all",
        conditions: [{ condition_type: "TextMerge", field: "SOURCE", op: "is", value: "Referral" }],
      },
    },
    {
      name: "Source: Event",
      options: {
        match: "all",
        conditions: [{ condition_type: "TextMerge", field: "SOURCE", op: "is", value: "Event" }],
      },
    },
    {
      name: "Source: Website",
      options: {
        match: "all",
        conditions: [{ condition_type: "TextMerge", field: "SOURCE", op: "is", value: "Website" }],
      },
    },
    {
      name: "Source: Email",
      options: {
        match: "all",
        conditions: [{ condition_type: "TextMerge", field: "SOURCE", op: "is", value: "Email" }],
      },
    },
    // By service tag
    {
      name: "Service: The AI Advantage",
      options: {
        match: "all",
        conditions: [{ condition_type: "Tags", field: "tag", op: "is", value: "The AI Advantage" }],
      },
    },
    {
      name: "Service: Agent Advantage",
      options: {
        match: "all",
        conditions: [{ condition_type: "Tags", field: "tag", op: "is", value: "Agent Advantage" }],
      },
    },
    {
      name: "Service: AI Action Day",
      options: {
        match: "all",
        conditions: [{ condition_type: "Tags", field: "tag", op: "is", value: "AI Action Day" }],
      },
    },
    {
      name: "Service: Leadership Strategy Day",
      options: {
        match: "all",
        conditions: [{ condition_type: "Tags", field: "tag", op: "is", value: "Leadership Strategy Day" }],
      },
    },
    {
      name: "Service: Team Accelerator Day",
      options: {
        match: "all",
        conditions: [{ condition_type: "Tags", field: "tag", op: "is", value: "Team Accelerator Day" }],
      },
    },
    {
      name: "Service: The AI Navigator",
      options: {
        match: "all",
        conditions: [{ condition_type: "Tags", field: "tag", op: "is", value: "The AI Navigator" }],
      },
    },
  ];

  // Fetch existing segments (up to 200)
  let existingNames = new Set();
  try {
    const listRes = await fetch(
      `${baseUrl}/lists/${audienceId}/segments?count=200&type=saved`,
      { headers: { Authorization: mcAuth } }
    );
    if (listRes.ok) {
      const listData = await listRes.json();
      for (const s of listData.segments || []) {
        existingNames.add(s.name);
      }
    }
  } catch (_) {
    // Non-fatal — proceed without skip logic if fetch fails
  }

  let created = 0;
  let skipped = 0;
  const errors = [];

  for (const seg of segments) {
    if (existingNames.has(seg.name)) {
      skipped++;
      continue;
    }

    try {
      const createRes = await fetch(`${baseUrl}/lists/${audienceId}/segments`, {
        method: "POST",
        headers: {
          Authorization: mcAuth,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: seg.name, options: seg.options }),
      });

      if (createRes.ok) {
        created++;
      } else {
        const errData = await createRes.json().catch(() => ({}));
        errors.push({ name: seg.name, error: errData.detail || errData.title || `HTTP ${createRes.status}` });
      }
    } catch (err) {
      errors.push({ name: seg.name, error: err.message });
    }
  }

  return res.status(200).json({ created, skipped, errors });
}
