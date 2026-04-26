/**
 * api/_lib/engagement-tier.js
 *
 * Pure tier-computation logic + sales-trigger helpers.
 *
 * Spec ref: section 6.6 (tier rules) + section 6.7 (triggers).
 * Phil Q4 2026-04-25: thresholds in config, not hard-coded.
 *
 * Tier rules (Tes first cut, review with Sol after one month live):
 *   engaged  = at least one open OR click in the last N_DAYS_RECENT,
 *              OR N_OPENS_BURST opens in any 30-day window.
 *              AND no unsubscribe AND no hard bounce.
 *   neutral  = has email on file, opt-in true, but no open/click in
 *              last N_DAYS_RECENT. Default state.
 *   cooling  = previously engaged, no open/click in last N_DAYS_COOLING.
 *   cold     = no open/click in last N_DAYS_COLD.
 *
 * Tier flips write a contact_activities row of type
 * email_engagement_tier_changed so Sol sees the move on the contact panel.
 */

import { ENGAGEMENT_TIER, PROPOSAL_URL_PATTERNS, IMESSAGE_NOTIFY } from "./mailchimp-config.js";
import { sendImessageOnEvent } from "./imessage.js";

/**
 * Compute the tier from a contact's current engagement signals.
 *
 * Pure function. No DB, no I/O.
 *
 * @param {object} signals
 * @param {Date|string|null} signals.lastOpenAt
 * @param {Date|string|null} signals.lastClickAt
 * @param {number|null} signals.opens30d
 * @param {number|null} signals.clicks30d
 * @param {boolean} signals.hasUnsubscribed
 * @param {boolean} signals.hasHardBounce
 * @param {string|null} signals.currentTier - existing tier (for cooling logic)
 * @param {Date} [signals.now] - injectable for tests
 * @returns {'engaged'|'neutral'|'cooling'|'cold'}
 */
export function computeEngagementTier({
  lastOpenAt,
  lastClickAt,
  opens30d,
  clicks30d,
  hasUnsubscribed,
  hasHardBounce,
  currentTier,
  now,
}) {
  const today = now instanceof Date ? now : new Date();

  // Hard short-circuits: an unsubscribed or hard-bounced contact is
  // never engaged. Tier becomes cold (the chase posture is "do not chase
  // via email", which "cold" expresses cleanly).
  if (hasUnsubscribed || hasHardBounce) {
    return "cold";
  }

  const lastOpen = parseDate(lastOpenAt);
  const lastClick = parseDate(lastClickAt);
  const lastTouch = maxDate(lastOpen, lastClick);

  if (lastTouch) {
    const daysSinceTouch = daysBetween(lastTouch, today);

    if (daysSinceTouch <= ENGAGEMENT_TIER.N_DAYS_RECENT) {
      return "engaged";
    }
    if ((opens30d || 0) >= ENGAGEMENT_TIER.N_OPENS_BURST) {
      // Burst path: 3+ opens in a 30-day window earns engaged even if the
      // most recent touch was just outside N_DAYS_RECENT.
      return "engaged";
    }
    if (
      currentTier === "engaged" &&
      daysSinceTouch <= ENGAGEMENT_TIER.N_DAYS_COOLING
    ) {
      // Was engaged, still inside cooling window.
      return "cooling";
    }
    if (daysSinceTouch >= ENGAGEMENT_TIER.N_DAYS_COLD) {
      return "cold";
    }
    if (currentTier === "engaged") {
      // Was engaged, gone past cooling threshold but inside cold.
      return "cooling";
    }
    return "neutral";
  }

  // No engagement history at all.
  return "neutral";
}

/**
 * Apply the computed tier to a contact, writing a contact_activities
 * row when the tier changes and (per Phil Q3) iMessaging when the
 * affected contact is a Client.
 *
 * @param {object} args
 * @param {object} args.supabase - service-role supabase client
 * @param {object} args.contact - { id, contact_name, type, email_engagement_tier }
 * @param {string} args.newTier - computed tier
 */
export async function applyTierChange({ supabase, contact, newTier }) {
  const oldTier = contact.email_engagement_tier || null;
  if (newTier === oldTier) {
    return { changed: false, tier: newTier };
  }

  const { error: updErr } = await supabase
    .from("contacts")
    .update({ email_engagement_tier: newTier })
    .eq("id", contact.id);
  if (updErr) {
    console.error(`[engagement-tier] update failed for ${contact.id}: ${updErr.message}`);
    return { changed: false, error: updErr.message };
  }

  const oldLabel = oldTier || "(unset)";
  await supabase.from("contact_activities").insert({
    contact_id: contact.id,
    activity_type: "email_engagement_tier_changed",
    activity_subtype: `${oldLabel}_to_${newTier}`,
    subject: `Engagement tier changed: ${oldLabel} -> ${newTier}`,
    body: `Computed by mae-mailchimp-engagement-pull on ${new Date().toISOString()}.`,
    status: "received",
  });

  // Phil Q3: ping on Client tier flips only.
  const isClient = String(contact.type || "").trim().toLowerCase() === "client";
  if (isClient && IMESSAGE_NOTIFY.on_tier_flip_for_client) {
    await sendImessageOnEvent({
      eventKind: "tier_flip_for_client",
      lines: [
        `Engagement tier changed for Client ${contact.contact_name || contact.id}.`,
        `${oldLabel} -> ${newTier}.`,
        "Surfacing in case you want to look at the contact panel.",
      ],
    });
  }

  return { changed: true, oldTier, newTier };
}

/**
 * Sales trigger: detect a proposal magic-link click in a Mailchimp
 * campaign click event. Returns { isProposalClick, proposalCode }.
 *
 * Spec section 6.5. Pattern matchers in mailchimp-config.js.
 */
export function detectProposalClick(eventUrl) {
  if (!eventUrl) return { isProposalClick: false, proposalCode: null };
  for (const pattern of PROPOSAL_URL_PATTERNS) {
    const match = String(eventUrl).match(pattern);
    if (match) {
      return { isProposalClick: true, proposalCode: match[1] || null };
    }
  }
  return { isProposalClick: false, proposalCode: null };
}

/**
 * On a detected proposal click, write a contact_activities row tagged
 * to the proposal (if findable). iMessage Phil ONLY when the contact is
 * in an open opportunity (any opportunity not in Won / Lost / Cancelled).
 */
export async function applyProposalClickTrigger({ supabase, contactId, proposalCode, campaignId, campaignTitle, eventUrl, occurredAt }) {
  // Look up proposal by code (proposals.code or magic_links.code).
  let proposalId = null;
  let proposalLabel = proposalCode;
  try {
    const { data: prop } = await supabase
      .from("proposals")
      .select("id, code, title")
      .eq("code", proposalCode)
      .maybeSingle();
    if (prop) {
      proposalId = prop.id;
      proposalLabel = prop.title || prop.code || proposalCode;
    }
  } catch (err) {
    // Non-fatal. Activity row will still write.
    console.warn(`[engagement-tier] proposal lookup failed for ${proposalCode}: ${err.message}`);
  }

  await supabase.from("contact_activities").insert({
    contact_id: contactId,
    proposal_id: proposalId,
    activity_type: "proposal_link_clicked_in_email",
    activity_subtype: campaignId || "mailchimp_campaign",
    subject: `Proposal link clicked from email: ${proposalLabel}`,
    body: `Campaign: ${campaignTitle || campaignId || "(unknown)"}\nURL: ${eventUrl}\nOccurred at: ${occurredAt instanceof Date ? occurredAt.toISOString() : occurredAt}`,
    status: "received",
  });

  // Open opportunity check.
  let inOpenOpportunity = false;
  try {
    const { data: opps } = await supabase
      .from("opportunities")
      .select("id, stage")
      .eq("contact_id", contactId);
    if (opps && opps.length > 0) {
      const openStages = new Set(["Qualifying", "Discovery", "Proposal", "Negotiating"]);
      inOpenOpportunity = opps.some((o) => openStages.has(o.stage));
    }
  } catch (err) {
    console.warn(`[engagement-tier] open-opp check failed for contact ${contactId}: ${err.message}`);
  }

  if (inOpenOpportunity) {
    await sendImessageOnEvent({
      eventKind: "proposal_link_click_in_open_opportunity",
      lines: [
        `Proposal click in active opportunity.`,
        `Contact ID: ${contactId}.`,
        `Proposal: ${proposalLabel}.`,
        `Campaign: ${campaignTitle || campaignId || "(unknown)"}.`,
        "This is a stop-what-you-are-doing signal.",
      ],
    });
  }

  return { proposalId, inOpenOpportunity };
}

// ─── small utils ─────────────────────────────────────────────────────

function parseDate(d) {
  if (!d) return null;
  if (d instanceof Date) return d;
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? null : dt;
}

function maxDate(a, b) {
  if (!a && !b) return null;
  if (!a) return b;
  if (!b) return a;
  return a.getTime() >= b.getTime() ? a : b;
}

function daysBetween(earlier, later) {
  const ms = later.getTime() - earlier.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}
