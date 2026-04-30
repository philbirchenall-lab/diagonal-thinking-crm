/**
 * api/proposal-followup-cron.js
 *
 * Vercel serverless function — runs daily at 09:00 UTC via vercel.json cron config.
 * Checks all active proposals and sends follow-up emails / creates LinkedIn drafts
 * based on working days since the proposal was sent or first opened.
 *
 * Three triggers:
 *   PROP-011 — Nudge at 4 working days (no views yet)
 *   PROP-012 — LinkedIn draft at 7 working days (no views yet)
 *   PROP-013 — Chase at 5 working days post-first-open (viewed but no reply)
 *
 * NOTE (PROP-005 integration): When the send-proposal-email feature in dt-proposals
 * is activated, it should set sent_at = now() on the proposals row at the time the
 * email is sent. Until then, the backfill (sent_at = created_at) is the fallback.
 *
 * Required env vars:
 *   RESEND_API_KEY            — Resend API key for outbound emails
 *   SUPABASE_URL or VITE_SUPABASE_URL — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY — Server-side Supabase key (falls back to anon key)
 *   SUPABASE_ANON_KEY or VITE_SUPABASE_ANON_KEY — Anon key fallback
 *   CRON_SECRET               — Must match Authorization: Bearer <token> header
 */

// ─── Auth check ───────────────────────────────────────────────────────────────

function verifyAuth(req) {
  const cronSecret = process.env.CRON_SECRET;
  // SEC-API-009 — fail-closed: never allow if CRON_SECRET is unset
  if (!cronSecret) return false;
  const authHeader = req.headers["authorization"] ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  return token === cronSecret;
}

// ─── Working days calculation ─────────────────────────────────────────────────

function workingDaysBetween(startDate, endDate) {
  let count = 0;
  const current = new Date(startDate);
  current.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(0, 0, 0, 0);

  while (current < end) {
    current.setDate(current.getDate() + 1);
    const day = current.getDay();
    if (day !== 0 && day !== 6) count++; // skip Saturday (6) and Sunday (0)
  }
  return count;
}

// ─── Supabase helpers ─────────────────────────────────────────────────────────

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  // Prefer service role key for server-side access; fall back to anon key
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

// ─── Fetch active proposals with contact + first_opened_at ───────────────────

async function fetchActiveProposals(supabaseUrl, supabaseKey) {
  // Use Supabase PostgREST with embedded relationship for contacts
  // and a subquery for first_opened_at via proposal_access
  const params = new URLSearchParams({
    select: "id,proposal_code,program_title,client_name,contact_id,sent_at,reply_received,is_active,views:proposal_access(count),contacts(id,contact_name,company,email)",
    is_active: "eq.true",
  });

  // Fetch proposals with contacts
  const proposals = await supabaseFetch(
    supabaseUrl,
    supabaseKey,
    `proposals?${params}`,
    { prefer: "return=representation" }
  );

  if (!proposals || proposals.length === 0) return [];

  // Fetch first_opened_at for all proposals in one query
  const proposalIds = proposals.map((p) => p.id);
  const accessParams = new URLSearchParams({
    select: "proposal_id,accessed_at",
    proposal_id: `in.(${proposalIds.join(",")})`,
    order: "accessed_at.asc",
  });

  let accesses = [];
  try {
    accesses = await supabaseFetch(
      supabaseUrl,
      supabaseKey,
      `proposal_access?${accessParams}`,
      { prefer: "return=representation" }
    );
  } catch (_) {
    // Non-fatal: treat as no accesses
  }

  // Build first_opened_at map
  const firstOpened = {};
  for (const row of accesses ?? []) {
    if (!firstOpened[row.proposal_id]) {
      firstOpened[row.proposal_id] = row.accessed_at;
    }
  }

  // Fetch view counts
  const viewCountParams = new URLSearchParams({
    select: "proposal_id",
    proposal_id: `in.(${proposalIds.join(",")})`,
  });
  let viewRows = [];
  try {
    viewRows = await supabaseFetch(
      supabaseUrl,
      supabaseKey,
      `proposal_access?${viewCountParams}`,
      { prefer: "return=representation" }
    );
  } catch (_) {
    // Non-fatal
  }

  const viewCounts = {};
  for (const row of viewRows ?? []) {
    viewCounts[row.proposal_id] = (viewCounts[row.proposal_id] ?? 0) + 1;
  }

  return proposals
    .filter((p) => p.contacts && p.contacts.email)
    .map((p) => ({
      id: p.id,
      proposalCode: p.proposal_code,
      programTitle: p.program_title,
      clientName: p.client_name,
      contactId: p.contact_id,
      contactEmail: p.contacts.email,
      contactName: p.contacts.contact_name,
      sentAt: p.sent_at,
      replyReceived: p.reply_received,
      views: viewCounts[p.id] ?? 0,
      firstOpenedAt: firstOpened[p.id] ?? null,
    }));
}

// ─── Check existing activities (dedup) ───────────────────────────────────────

async function hasExistingActivity(supabaseUrl, supabaseKey, proposalId, subtype) {
  const params = new URLSearchParams({
    select: "id",
    proposal_id: `eq.${proposalId}`,
    activity_subtype: `eq.${subtype}`,
    limit: "1",
  });
  const rows = await supabaseFetch(
    supabaseUrl,
    supabaseKey,
    `contact_activities?${params}`,
    { prefer: "return=representation" }
  );
  return (rows ?? []).length > 0;
}

// ─── Save activity to Supabase ────────────────────────────────────────────────

async function saveActivity(supabaseUrl, supabaseKey, activity) {
  await supabaseFetch(supabaseUrl, supabaseKey, "contact_activities", {
    method: "POST",
    prefer: "return=minimal",
    body: JSON.stringify({
      contact_id: activity.contactId,
      proposal_id: activity.proposalId,
      activity_type: activity.activityType,
      activity_subtype: activity.activitySubtype,
      subject: activity.subject,
      body: activity.body,
      status: activity.status,
    }),
  });
}

// ─── Send email via Resend ────────────────────────────────────────────────────

async function sendEmail({ to, subject, text, html }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Phil at Diagonal Thinking <phil@diagonalthinking.co>",
      to: [to],
      subject,
      text,
      html,
    }),
  });
  if (!res.ok) {
    // SEC-API-008 — Resend error bodies can echo the API key in some failure
    // modes. Log the raw body server-side only; throw a sanitised message that
    // surfaces only the HTTP status to callers.
    const rawBody = await res.text();
    console.error(`[proposal-followup-cron] Resend send failed (${res.status}):`, rawBody);
    throw new Error(`Email send failed (status ${res.status})`);
  }
}

// ─── Email body builders ──────────────────────────────────────────────────────

function buildNudgeEmail(proposal) {
  const { clientName, programTitle, proposalCode } = proposal;
  const viewUrl = `https://proposals.diagonalthinking.co/view?code=${proposalCode}`;
  const subject = `Following up — ${programTitle}`;
  const text = `Hi ${clientName},\n\nI just wanted to make sure the proposal I sent over landed okay — these things sometimes end up in junk!\n\nIf you'd like to take a look, here's the link: ${viewUrl}\n\nHappy to answer any questions or jump on a call if that's easier.\n\nBest,\nPhil`;
  const html = `<p>Hi ${clientName},</p><p>I just wanted to make sure the proposal I sent over landed okay — these things sometimes end up in junk!</p><p>If you'd like to take a look, here's the link: <a href="${viewUrl}">${viewUrl}</a></p><p>Happy to answer any questions or jump on a call if that's easier.</p><p>Best,<br>Phil</p>`;
  return { subject, text, html };
}

function buildChaseEmail(proposal) {
  const { clientName, programTitle } = proposal;
  const subject = `Your thoughts on the proposal — ${programTitle}`;
  const text = `Hi ${clientName},\n\nI hope you've had a chance to look over the proposal. I just wanted to check in and see if you had any questions or thoughts on what I put together.\n\nAlways happy to jump on a quick call to talk through it — just reply to this email and we'll find a time.\n\nBest,\nPhil`;
  const html = `<p>Hi ${clientName},</p><p>I hope you've had a chance to look over the proposal. I just wanted to check in and see if you had any questions or thoughts on what I put together.</p><p>Always happy to jump on a quick call to talk through it — just reply to this email and we'll find a time.</p><p>Best,<br>Phil</p>`;
  return { subject, text, html };
}

function buildLinkedInDraftBody(proposal) {
  const { clientName, proposalCode } = proposal;
  const viewUrl = `https://proposals.diagonalthinking.co/view?code=${proposalCode}`;
  return `Hi ${clientName}, just wanted to check you received the proposal okay — here's the link in case it got lost: ${viewUrl} (access code: ${proposalCode}). Happy to chat through it if useful!`;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  // Only allow GET (Vercel cron) or POST (manual trigger)
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Auth check
  if (!verifyAuth(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { url: supabaseUrl, key: supabaseKey } = getSupabaseConfig();
  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: "Supabase env vars not configured" });
  }

  if (!process.env.RESEND_API_KEY) {
    return res.status(500).json({ error: "RESEND_API_KEY not configured" });
  }

  const now = new Date();
  const summary = {
    processed: 0,
    nudges_sent: 0,
    linkedin_drafts_created: 0,
    chases_sent: 0,
    errors: [],
  };

  let proposals;
  try {
    proposals = await fetchActiveProposals(supabaseUrl, supabaseKey);
  } catch (err) {
    // SEC-API-006 — log details server-side, return generic message to caller.
    console.error("[proposal-followup-cron] fetchActiveProposals failed:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }

  for (const proposal of proposals) {
    summary.processed++;
    const sentAt = proposal.sentAt ? new Date(proposal.sentAt) : null;
    const firstOpenedAt = proposal.firstOpenedAt ? new Date(proposal.firstOpenedAt) : null;

    try {
      // ── PROP-011: Nudge at 4 working days (no views) ─────────────────────
      if (proposal.views === 0 && sentAt) {
        const days = workingDaysBetween(sentAt, now);
        if (days >= 4) {
          const alreadySent = await hasExistingActivity(
            supabaseUrl,
            supabaseKey,
            proposal.id,
            "nudge_4day"
          );
          if (!alreadySent) {
            const { subject, text, html } = buildNudgeEmail(proposal);
            await sendEmail({ to: proposal.contactEmail, subject, text, html });
            await saveActivity(supabaseUrl, supabaseKey, {
              contactId: proposal.contactId,
              proposalId: proposal.id,
              activityType: "email_sent",
              activitySubtype: "nudge_4day",
              subject,
              body: text,
              status: "sent",
            });
            summary.nudges_sent++;
            console.log(`PROP-011 nudge sent → ${proposal.contactEmail} (proposal ${proposal.id})`);
          }
        }
      }

      // ── PROP-012: LinkedIn draft at 7 working days (no views) ────────────
      if (proposal.views === 0 && sentAt) {
        const days = workingDaysBetween(sentAt, now);
        if (days >= 7) {
          const alreadyDrafted = await hasExistingActivity(
            supabaseUrl,
            supabaseKey,
            proposal.id,
            "linkedin_7day"
          );
          if (!alreadyDrafted) {
            const body = buildLinkedInDraftBody(proposal);
            await saveActivity(supabaseUrl, supabaseKey, {
              contactId: proposal.contactId,
              proposalId: proposal.id,
              activityType: "linkedin_draft",
              activitySubtype: "linkedin_7day",
              subject: "LinkedIn message — check proposal received",
              body,
              status: "pending",
            });
            summary.linkedin_drafts_created++;
            console.log(`PROP-012 LinkedIn draft created → contact ${proposal.contactId} (proposal ${proposal.id})`);
          }
        }
      }

      // ── PROP-013: Chase at 5 working days post-first-open ─────────────────
      if (
        proposal.views > 0 &&
        firstOpenedAt &&
        !proposal.replyReceived
      ) {
        const daysSinceOpen = workingDaysBetween(firstOpenedAt, now);
        if (daysSinceOpen >= 5) {
          const alreadySent = await hasExistingActivity(
            supabaseUrl,
            supabaseKey,
            proposal.id,
            "chase_5day"
          );
          if (!alreadySent) {
            const { subject, text, html } = buildChaseEmail(proposal);
            await sendEmail({ to: proposal.contactEmail, subject, text, html });
            await saveActivity(supabaseUrl, supabaseKey, {
              contactId: proposal.contactId,
              proposalId: proposal.id,
              activityType: "email_sent",
              activitySubtype: "chase_5day",
              subject,
              body: text,
              status: "sent",
            });
            summary.chases_sent++;
            console.log(`PROP-013 chase sent → ${proposal.contactEmail} (proposal ${proposal.id})`);
          }
        }
      }
    } catch (err) {
      const msg = `Proposal ${proposal.id}: ${err.message}`;
      console.error(msg);
      summary.errors.push(msg);
    }
  }

  console.log("Cron summary:", summary);
  return res.status(200).json(summary);
}
