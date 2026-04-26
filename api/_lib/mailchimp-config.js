/**
 * mailchimp-config.js
 *
 * Single source of truth for every Mailchimp two-way sync constant
 * the CRM cares about. Phil's directive (MAIL-SYNC-001 Q4 answer):
 * tune-able from one place, not hard-coded in nineteen.
 *
 * Imported by:
 *   - api/mailchimp/inbound.js     (webhook listener: event whitelist)
 *   - api/mailchimp-sync.js        (outbound guard: opt-in field name)
 *   - api/_lib/imessage.js         (notification cadence: who pings on what)
 *   - api/_lib/engagement-tier.js  (tier computation thresholds)
 *   - scripts/mailchimp-backfill.js               (90-day backfill)
 *   - ~/Documents/Claude/Scheduled/mae-mailchimp-engagement-pull/ (daily poll)
 *
 * If a value here changes, the ONLY thing that needs to change is
 * this file. Plus Sol's review at one month live, per spec section 12 Q4.
 */

// ─── Engagement tier thresholds (Phil deferred to Tes first cut) ──────
// Review with Sol after one month live, then tune.
// Spec ref: section 6.6 + Phil Q4 answer 2026-04-25.
export const ENGAGEMENT_TIER = {
  // engaged: at least one open OR click in the last N_DAYS_RECENT,
  // OR N_OPENS_BURST opens in any 30-day window.
  N_DAYS_RECENT: 14,
  N_OPENS_BURST: 3,

  // cooling: previously engaged, no open/click in last N_DAYS_COOLING.
  N_DAYS_COOLING: 30,

  // cold: no open or click in last N_DAYS_COLD.
  N_DAYS_COLD: 90,
};

// ─── Backfill window (Phil Q5 answer: "do it" = bigger option = 90d) ──
// If API cost or runtime turns out to be a problem on the first run,
// surface back to Dot before changing this number.
export const BACKFILL_DAYS = 90;

// ─── Webhook event-type whitelist ────────────────────────────────────
// Spec ref: section 5.2. Mailchimp does NOT webhook opens or clicks
// (those come from the Reports API on a poll), so they are absent here.
export const WEBHOOK_EVENT_TYPES = Object.freeze([
  'subscribe',
  'unsubscribe',
  'profile',
  'upemail',
  'cleaned',
]);

// ─── email_engagement_log event_type whitelist ───────────────────────
// MUST stay in sync with the CHECK constraint in
// supabase/migrations/20260425000001_mailchimp_two_way_sync.sql.
export const ENGAGEMENT_LOG_EVENT_TYPES = Object.freeze([
  'sent',
  'open',
  'click',
  'bounce_soft',
  'bounce_hard',
  'unsubscribe',
  'complaint',
]);

// ─── iMessage notification cadence (Phil Q3 answer verbatim) ─────────
// "I don't need an update on unsubscribes, it only hurts my feelings."
// Ping on:           Client tier flips, hard bounces.
// DO NOT ping on:    unsubscribes (silent log only).
// No daily digest.   Phil has not asked for one.
export const IMESSAGE_NOTIFY = Object.freeze({
  on_tier_flip_for_client: true,
  on_hard_bounce: true,
  on_unsubscribe: false,
  on_proposal_link_click_in_open_opportunity: true,
});

// ─── Privacy posture (spec section 11) ───────────────────────────────
// Email client, geo, and device data are NOT stored in v1.
// Smaller personal-data footprint, no PECR / ICO complications.
// Revisit if a specific signal proves load-bearing later.
export const STORE_PRIVACY_SENSITIVE_FIELDS = Object.freeze({
  email_client: false,
  geo_city: false,
  geo_country: false,
  device_class: false,
});

// ─── Proposal magic-link click pattern matchers ──────────────────────
// Spec section 6.5. A click on either pattern in a Mailchimp campaign
// promotes the engagement-log row to a contact_activities row of type
// proposal_link_clicked_in_email.
export const PROPOSAL_URL_PATTERNS = Object.freeze([
  /^https?:\/\/proposals\.diagonalthinking\.co\/view\?code=([A-Za-z0-9_-]+)/i,
  /^https?:\/\/proposals\.diagonalthinking\.co\/p\/([A-Za-z0-9_-]+)/i,
]);

// ─── Outbound-sync field name (single string, used in the guard) ─────
// If the column on contacts is ever renamed, this is the only literal
// the outbound code paths read.
export const OPT_IN_COLUMN = 'email_marketing_opt_in';
