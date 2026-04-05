// MAIL-003: Auto-create Mailchimp saved segments for every CRM segmentation dimension.
// This is a manually-triggered endpoint — call it once after a full sync to ensure
// segments are up to date. Idempotent: existing segments are skipped, not duplicated.
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const authHeader = req.headers.authorization || "";
  const cronSecret = process.env.CRON_SECRET || "";
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const apiKey = (process.env.MAILCHIMP_API_KEY || "").trim();
  const audienceId = process.env.MAILCHIMP_AUDIENCE_ID;
  const server = (process.env.MAILCHIMP_SERVER || apiKey.split("-").pop() || "").trim().split(".")[0];
  const baseUrl = `https://${server}.api.mailchimp.com/3.0`;
  const mcAuth = "Basic " + Buffer.from(`anystring:${apiKey}`).toString("base64");

  if (!apiKey || !audienceId) {
    return res.status(500).json({ error: "Mailchimp not configured" });
  }

  const segmentsToCreate = [
    // CRM_TYPE segments
    { name: "Type: Client",       field: "CRM_TYPE", value: "Client" },
    { name: "Type: Warm Lead",    field: "CRM_TYPE", value: "Warm Lead" },
    { name: "Type: Cold Lead",    field: "CRM_TYPE", value: "Cold Lead" },
    { name: "Type: Mailing List", field: "CRM_TYPE", value: "Mailing List" },
    // SOURCE segments (MAIL-003)
    { name: "Source: Invoices",               field: "SOURCE", value: "Invoices" },
    { name: "Source: Income & Expenditure",   field: "SOURCE", value: "Income & Expenditure" },
    { name: "Source: Gmail",                  field: "SOURCE", value: "Gmail" },
    { name: "Source: Squarespace",            field: "SOURCE", value: "Squarespace" },
    { name: "Source: Manual",                 field: "SOURCE", value: "Manual" },
    // NETPARTNER segments
    { name: "Network Partner: Yes", field: "NETPARTNER", value: "Yes" },
    { name: "Network Partner: No",  field: "NETPARTNER", value: "No" },
  ];

  // Fetch existing segments to avoid duplicates
  const existRes = await fetch(`${baseUrl}/lists/${audienceId}/segments?count=200`, {
    headers: { Authorization: mcAuth },
  });
  const existData = await existRes.json();
  const existingNames = new Set((existData.segments || []).map((s) => s.name));

  const results = [];

  for (const seg of segmentsToCreate) {
    if (existingNames.has(seg.name)) {
      results.push({ name: seg.name, action: "skipped — already exists" });
      continue;
    }

    const createRes = await fetch(`${baseUrl}/lists/${audienceId}/segments`, {
      method: "POST",
      headers: { Authorization: mcAuth, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: seg.name,
        options: {
          match: "any",
          conditions: [
            { condition_type: "TextMerge", field: seg.field, op: "is", value: seg.value },
          ],
        },
      }),
    });

    if (createRes.ok) {
      results.push({ name: seg.name, action: "created" });
    } else {
      const err = await createRes.json().catch(() => ({}));
      results.push({ name: seg.name, action: "error", detail: err.detail || err.title });
    }
  }

  return res.status(200).json({ segments: results });
}
