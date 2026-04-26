/**
 * api/_lib/imessage.js
 *
 * Server-side iMessage notification helper.
 *
 * The CRM lives in Vercel serverless. macOS osascript is NOT available
 * to a Vercel function, so this helper writes a notification request to
 * a Supabase queue table (imessage_outbox), and a local Mac-side relay
 * (Oz scheduled task on Phil's machine) reads + sends.
 *
 * If the queue table does not exist yet, the helper falls back to a
 * console.warn so notifications are at least visible in Vercel logs.
 * Phil will not lose information; he just will not get a buzz on his
 * phone until the relay lands.
 *
 * Cadence per Phil's MAIL-SYNC-001 Q3 answer (verbatim 25 Apr 2026):
 *   "I don't need an update on unsubscribes, it only hurts my feelings."
 *
 *   Ping on:           Client tier flips, hard bounces, upemail held
 *                      (no-match or conflict), proposal-link click in
 *                      an open opportunity.
 *   DO NOT ping on:    unsubscribes (silent log only, no iMessage).
 *   No daily digest.   Phil has not asked for one.
 *
 * Recipient: phil_birchenall@mac.com (his iMessage handle, per
 *            wiki/CLAUDE.md and existing scheduled-task conventions).
 */

import { getSupabaseAdmin } from "./client-area.js";
import { IMESSAGE_NOTIFY } from "./mailchimp-config.js";

const PHIL_HANDLE = "phil_birchenall@mac.com";

/**
 * Decide whether to send + send. Caller passes an eventKind that maps
 * onto the IMESSAGE_NOTIFY toggles. Adding a new event kind requires
 * adding a toggle in mailchimp-config.js.
 *
 * @param {object} args
 * @param {string} args.eventKind   - one of: tier_flip_for_client,
 *                                    hard_bounce, unsubscribe,
 *                                    proposal_link_click_in_open_opportunity,
 *                                    upemail_no_match, upemail_conflict
 * @param {string[]} args.lines     - body lines, joined with newlines
 * @param {string} [args.recipient] - override (defaults to Phil)
 */
export async function sendImessageOnEvent({ eventKind, lines, recipient }) {
  const allowed = isEventAllowed(eventKind);
  if (!allowed) {
    console.log(
      `[imessage] eventKind=${eventKind} suppressed by IMESSAGE_NOTIFY config (Phil opted out).`,
    );
    return { sent: false, reason: "suppressed_by_config" };
  }

  const body = (Array.isArray(lines) ? lines : [String(lines || "")])
    .filter(Boolean)
    .join("\n");
  const to = recipient || PHIL_HANDLE;

  // Try the queue path first.
  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from("imessage_outbox").insert({
      recipient: to,
      body,
      event_kind: eventKind,
      source: "mailchimp_two_way_sync",
      status: "pending",
    });
    if (!error) {
      return { sent: true, mode: "queued", eventKind, recipient: to };
    }
    // Table missing or other error: fall through to console fallback.
    if (error.message && /relation .*imessage_outbox.* does not exist/i.test(error.message)) {
      console.warn(
        "[imessage] imessage_outbox table not yet present. Falling back to console log. " +
          "Create the table or wire a direct Mac-side relay to start delivering.",
      );
    } else {
      console.error(`[imessage] queue insert failed: ${error.message}`);
    }
  } catch (err) {
    console.error(`[imessage] supabase admin client unavailable: ${err.message}`);
  }

  // Console fallback so the message is at least visible in Vercel logs.
  console.warn(
    `[imessage:fallback] to=${to} kind=${eventKind}\n${body}`,
  );
  return { sent: false, mode: "console_fallback", eventKind, recipient: to };
}

function isEventAllowed(eventKind) {
  switch (eventKind) {
    case "tier_flip_for_client":
      return IMESSAGE_NOTIFY.on_tier_flip_for_client;
    case "hard_bounce":
      return IMESSAGE_NOTIFY.on_hard_bounce;
    case "unsubscribe":
      return IMESSAGE_NOTIFY.on_unsubscribe;
    case "proposal_link_click_in_open_opportunity":
      return IMESSAGE_NOTIFY.on_proposal_link_click_in_open_opportunity;
    case "upemail_no_match":
      // Operational alert, always on (data integrity issue, not a Phil-feeling issue).
      return true;
    case "upemail_conflict":
      // Same: operational, always on.
      return true;
    default:
      console.warn(`[imessage] unknown eventKind=${eventKind}, defaulting to allowed.`);
      return true;
  }
}
