/**
 * api/proposal-followup-cron.js
 *
 * Vercel serverless function. Runs daily at 09:00 UTC via vercel.json cron config.
 * Sends at most ONE nudge and at most ONE chase per proposal, ever.
 *
 * Two triggers (PROP-012 LinkedIn auto-draft was removed 2026-06-03 per Phil):
 *   PROP-011 Nudge: one-shot, at 4 working days after sent, while still unopened.
 *   PROP-013 Chase: one-shot, at 5 working days after first open, viewed but no reply.
 *
 * Gates that apply to BOTH triggers (Phil-set 2026-06-03):
 *   1. sent_at IS NOT NULL          (never act on a proposal that was not marked sent)
 *   2. reply_received = false       (status unchanged since sent; the client has not replied)
 *   3. the one-shot column is NULL  (nudged_at for nudge, chased_at for chase: never fired before)
 *   4. one send maximum, then the column is set and it never fires again
 *
 * Every send uses Reply-To: phil@diagonalthinking.co so replies reach Phil directly.
 *
 * Safety flag: the whole path is fail-closed behind PROPOSAL_CHASE_ENABLED. Unless it
 * is exactly "true", the handler sends nothing and returns 503. Default is off. Phil
 * enables it explicitly after Tes sign-off. (Born as the 2026-06-03 incident kill switch.)
 *
 * Required env vars:
 *   PROPOSAL_CHASE_ENABLED    Must be "true" to send anything. Default off.
 *   RESEND_API_KEY            Resend API key for outbound email.
 *   SUPABASE_URL or VITE_SUPABASE_URL          Supabase project URL.
 *   SUPABASE_SERVICE_ROLE_KEY                  Server-side Supabase key (falls back to anon).
 *   SUPABASE_ANON_KEY or VITE_SUPABASE_ANON_KEY  Anon key fallback.
 *   CRON_SECRET               Must match Authorization: Bearer <token> header.
 */

const FROM_ADDRESS = "Phil at Diagonal Thinking <phil@diagonalthinking.co>";
const REPLY_TO_ADDRESS = "phil@diagonalthinking.co";
const NUDGE_WORKING_DAYS = 4;
const CHASE_WORKING_DAYS = 5;

// --- Auth check ---------------------------------------------------------------

function verifyAuth(req) {
  const cronSecret = process.env.CRON_SECRET;
  // SEC-API-009: fail-closed, never allow if CRON_SECRET is unset.
  if (!cronSecret) return false;
  const authHeader = req.headers["authorization"] ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  return token === cronSecret;
}

// --- Working days calculation -------------------------------------------------

export function workingDaysBetween(startDate, endDate) {
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

// --- Pure decision predicates (unit-tested, no IO) ----------------------------

/**
 * PROP-011 nudge is due when the proposal was sent, has not been replied to,
 * has never been nudged, is still unopened, and 4+ working days have passed
 * since it was sent.
 */
export function nudgeDue(proposal, now) {
  if (!proposal.sentAt) return false;          // gate 1: sent_at not null
  if (proposal.replyReceived) return false;    // gate 2: status unchanged (no reply)
  if (proposal.nudgedAt) return false;         // gate 3: one-shot, never nudged
  if (proposal.views > 0) return false;        // nudge only applies before first open
  return workingDaysBetween(proposal.sentAt, now) >= NUDGE_WORKING_DAYS;
}

/**
 * PROP-013 chase is due when the proposal was sent, has not been replied to,
 * has never been chased, HAS been opened, and 5+ working days have passed
 * since the first open.
 */
export function chaseDue(proposal, now) {
  if (!proposal.sentAt) return false;                       // gate 1: sent_at not null (the Ruth bug)
  if (proposal.replyReceived) return false;                 // gate 2: status unchanged (no reply)
  if (proposal.chasedAt) return false;                      // gate 3: one-shot, never chased
  if (!(proposal.views > 0) || !proposal.firstOpenedAt) return false; // chase only applies after first open
  return workingDaysBetween(proposal.firstOpenedAt, now) >= CHASE_WORKING_DAYS;
}

// --- Supabase helpers ---------------------------------------------------------

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  // Prefer service role key for server-side access; fall back to anon key.
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

// --- Fetch active proposals with contact + first_opened_at --------------------

async function fetchActiveProposals(supabaseUrl, supabaseKey) {
  const params = new URLSearchParams({
    select:
      "id,proposal_code,program_title,client_name,contact_id,sent_at,reply_received,nudged_at,chased_at,is_active,contacts(id,contact_name,company,email)",
    is_active: "eq.true",
  });

  const proposals = await supabaseFetch(
    supabaseUrl,
    supabaseKey,
    `proposals?${params}`,
    { prefer: "return=representation" }
  );

  if (!proposals || proposals.length === 0) return [];

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
    // Non-fatal: treat as no accesses.
  }

  const firstOpened = {};
  const viewCounts = {};
  for (const row of accesses ?? []) {
    if (!firstOpened[row.proposal_id]) {
      firstOpened[row.proposal_id] = row.accessed_at;
    }
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
      nudgedAt: p.nudged_at,
      chasedAt: p.chased_at,
      views: viewCounts[p.id] ?? 0,
      firstOpenedAt: firstOpened[p.id] ?? null,
    }));
}

// --- Write activity + set the one-shot marker ---------------------------------

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

/**
 * Set the one-shot marker column (nudged_at or chased_at) on the proposal.
 * Guarded so it only writes when the column is still NULL, which makes a
 * concurrent double-fire impossible at the database level.
 */
async function markProposalOnce(supabaseUrl, supabaseKey, proposalId, column, nowIso) {
  await supabaseFetch(
    supabaseUrl,
    supabaseKey,
    `proposals?id=eq.${proposalId}&${column}=is.null`,
    {
      method: "PATCH",
      prefer: "return=minimal",
      body: JSON.stringify({ [column]: nowIso }),
    }
  );
}

// --- Send email via Resend ----------------------------------------------------

/**
 * Build the Resend payload. Pure and exported so a test can assert the
 * Reply-To address is always present without making a network call.
 */
export function buildResendPayload({ to, subject, text, html }) {
  return {
    from: FROM_ADDRESS,
    reply_to: REPLY_TO_ADDRESS,
    to: [to],
    subject,
    text,
    html,
  };
}

async function sendEmail({ to, subject, text, html }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildResendPayload({ to, subject, text, html })),
  });
  if (!res.ok) {
    // SEC-API-008: Resend error bodies can echo the API key in some failure
    // modes. Log the raw body server-side only; throw a sanitised message that
    // surfaces only the HTTP status to callers.
    const rawBody = await res.text();
    console.error(`[proposal-followup-cron] Resend send failed (${res.status}):`, rawBody);
    throw new Error(`Email send failed (status ${res.status})`);
  }
}

// --- Email body builders ------------------------------------------------------

export function buildNudgeEmail(proposal) {
  const { clientName, programTitle, proposalCode } = proposal;
  const viewUrl = `https://proposals.diagonalthinking.co/view?code=${proposalCode}`;
  const subject = `Following up on ${programTitle}`;
  const text = `Hi ${clientName},\n\nI just wanted to make sure the proposal I sent over landed okay. These things sometimes end up in junk.\n\nIf you'd like to take a look, here's the link: ${viewUrl}\n\nHappy to answer any questions or jump on a call if that's easier.\n\nBest,\nPhil`;
  const html = `<p>Hi ${clientName},</p><p>I just wanted to make sure the proposal I sent over landed okay. These things sometimes end up in junk.</p><p>If you'd like to take a look, here's the link: <a href="${viewUrl}">${viewUrl}</a></p><p>Happy to answer any questions or jump on a call if that's easier.</p><p>Best,<br>Phil</p>`;
  return { subject, text, html };
}

export function buildChaseEmail(proposal) {
  const { clientName, programTitle } = proposal;
  const subject = `Your thoughts on the proposal: ${programTitle}`;
  const text = `Hi ${clientName},\n\nI hope you've had a chance to look over the proposal. I just wanted to check in and see if you had any questions or thoughts on what I put together.\n\nAlways happy to jump on a quick call to talk through it. Just reply to this email and we'll find a time.\n\nBest,\nPhil`;
  const html = `<p>Hi ${clientName},</p><p>I hope you've had a chance to look over the proposal. I just wanted to check in and see if you had any questions or thoughts on what I put together.</p><p>Always happy to jump on a quick call to talk through it. Just reply to this email and we'll find a time.</p><p>Best,<br>Phil</p>`;
  return { subject, text, html };
}

// --- Main handler -------------------------------------------------------------

export default async function handler(req, res) {
  // Fail-closed safety flag. Default off. Sends nothing unless explicitly enabled.
  if (process.env.PROPOSAL_CHASE_ENABLED !== "true") {
    console.warn(
      "[proposal-followup-cron] disabled: PROPOSAL_CHASE_ENABLED is not 'true'. No email sent."
    );
    return res.status(503).json({
      disabled: true,
      reason: "Proposal follow-up automation is disabled (PROPOSAL_CHASE_ENABLED is not true)",
    });
  }

  // Only allow GET (Vercel cron) or POST (manual trigger).
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Auth check.
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
  const nowIso = now.toISOString();
  const summary = { processed: 0, nudges_sent: 0, chases_sent: 0, errors: [] };

  let proposals;
  try {
    proposals = await fetchActiveProposals(supabaseUrl, supabaseKey);
  } catch (err) {
    // SEC-API-006: log details server-side, return generic message to caller.
    console.error("[proposal-followup-cron] fetchActiveProposals failed:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }

  for (const proposal of proposals) {
    summary.processed++;

    try {
      // PROP-011 one-shot nudge.
      if (nudgeDue(proposal, now)) {
        const { subject, text, html } = buildNudgeEmail(proposal);
        await sendEmail({ to: proposal.contactEmail, subject, text, html });
        await markProposalOnce(supabaseUrl, supabaseKey, proposal.id, "nudged_at", nowIso);
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
        console.log(`PROP-011 nudge sent to ${proposal.contactEmail} (proposal ${proposal.id})`);
      }

      // PROP-013 one-shot chase.
      if (chaseDue(proposal, now)) {
        const { subject, text, html } = buildChaseEmail(proposal);
        await sendEmail({ to: proposal.contactEmail, subject, text, html });
        await markProposalOnce(supabaseUrl, supabaseKey, proposal.id, "chased_at", nowIso);
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
        console.log(`PROP-013 chase sent to ${proposal.contactEmail} (proposal ${proposal.id})`);
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
