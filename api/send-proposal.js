/**
 * api/send-proposal.js
 *
 * Vercel serverless function — sends a proposal email to the linked contact.
 *
 * POST /api/send-proposal
 * Body: { proposalId: string }
 *
 * On success:
 *   - Sends email via Resend to the contact's email address
 *   - Sets sent_at = now() on the proposals row (used by follow-up cron PROP-011/012/013)
 *   - Logs an email_sent activity to contact_activities (if contact_id is set)
 *
 * Required env vars:
 *   RESEND_API_KEY
 *   SUPABASE_URL or VITE_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY or VITE_SUPABASE_ANON_KEY
 */

import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY;
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function buildProposalEmail(proposal) {
  const rawName =
    proposal.prepared_for ||
    proposal.contacts?.contact_name ||
    "";
  // Use first name only (everything before the first space or comma)
  const firstName = rawName.split(/[\s,]+/)[0] || "there";

  const viewUrl = `https://proposals.diagonalthinking.co/view?code=${proposal.proposal_code}`;
  const subject = `Your proposal — ${proposal.program_title}`;

  const text = [
    `Hi ${firstName},`,
    "",
    `Following our conversations, I've put together a proposal. You can view it anytime using this link:`,
    "",
    viewUrl,
    "",
    `If you have any questions or would like to talk through anything, just hit reply and we'll get something in the diary.`,
    "",
    "Cheers,",
    "Phil",
    "",
    "Diagonal Thinking",
  ].join("\n");

  const html = `
    <p>Hi ${firstName},</p>
    <p>Following our conversations, I've put together a proposal. You can view it anytime using this link:</p>
    <p><a href="${viewUrl}">${viewUrl}</a></p>
    <p>If you have any questions or would like to talk through anything, just hit reply and we'll get something in the diary.</p>
    <p>Cheers,<br>Phil<br><br>Diagonal Thinking</p>
  `.trim();

  return { subject, text, html };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { proposalId } = req.body || {};
  if (!proposalId) {
    return res.status(400).json({ error: "proposalId is required" });
  }

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    return res.status(500).json({
      error: "RESEND_API_KEY is not configured — add it to Vercel env vars.",
    });
  }

  const supabase = getSupabase();

  // Load the proposal with linked contact
  const { data: proposal, error: proposalErr } = await supabase
    .from("proposals")
    .select("*, contacts(id, contact_name, email)")
    .eq("id", proposalId)
    .single();

  if (proposalErr || !proposal) {
    return res.status(404).json({ error: "Proposal not found." });
  }

  const recipientEmail = proposal.contacts?.email;
  if (!recipientEmail) {
    return res.status(400).json({
      error:
        "No email address on the linked contact. Link this proposal to a contact with an email first.",
    });
  }

  const { subject, text, html } = buildProposalEmail(proposal);

  // Send via Resend
  const emailRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Phil at Diagonal Thinking <phil@diagonalthinking.co>",
      to: [recipientEmail],
      cc: ["phil@diagonalthinking.co"],
      subject,
      text,
      html,
    }),
  });

  if (!emailRes.ok) {
    const err = await emailRes.text();
    return res.status(500).json({ error: `Email send failed: ${err}` });
  }

  const now = new Date().toISOString();

  // Mark proposal as sent
  await supabase
    .from("proposals")
    .update({ sent_at: now })
    .eq("id", proposalId);

  // Log activity to contact_activities (non-fatal if it fails)
  if (proposal.contact_id) {
    await supabase.from("contact_activities").insert({
      contact_id: proposal.contact_id,
      proposal_id: proposalId,
      activity_type: "email_sent",
      subject: `Proposal sent — ${proposal.program_title}`,
      status: "sent",
    });
  }

  return res.status(200).json({ ok: true, to: recipientEmail });
}
