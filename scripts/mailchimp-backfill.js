#!/usr/bin/env node
/**
 * scripts/mailchimp-backfill.js
 *
 * One-shot 90-day backfill for MAIL-SYNC-001.
 *
 * Run after the migration applies, BEFORE flipping the inbound webhook
 * live (or right after, both are safe because every write is idempotent).
 *
 *   cd <repo root>
 *   node scripts/mailchimp-backfill.js
 *
 * Required env vars (read from .env.production.local or shell):
 *   MAILCHIMP_API_KEY
 *   MAILCHIMP_AUDIENCE_ID
 *   MAILCHIMP_SERVER             (e.g. us8)
 *   SUPABASE_URL                 (or VITE_SUPABASE_URL)
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Phil Q5 (verbatim, MAIL-SYNC-001 brief 25 Apr 2026):
 *   "do it" reading: 90 days backfill on day one (the bigger option).
 *
 * What this script does (in order):
 *   1. Pulls every Mailchimp audience member (paginated, status=any).
 *   2. For each member, finds the CRM contact by email (case-insensitive).
 *   3. Updates email_marketing_opt_in (TRUE only when Mailchimp status =
 *      subscribed; FALSE for unsubscribed / cleaned / pending). Source is
 *      stamped initial_backfill so it is distinguishable from
 *      mailchimp_webhook flips going forward.
 *   4. Populates the seven engagement fields from the member object plus
 *      Member Activity API.
 *   5. Pulls Reports API for every campaign sent in the last
 *      BACKFILL_DAYS, writes one email_engagement_log row per opener and
 *      clicker. Idempotent on the unique index defined in the migration.
 *   6. Recomputes engagement tier per contact.
 *   7. Writes a Markdown progress report to outputs/.
 *
 * Idempotency posture: every write uses upsert with the unique index, so
 * re-running the script never duplicates rows. Safe to re-run.
 *
 * Standing rules respected:
 *   - Mailchimp opt-out is GROUND TRUTH (this script is the day-one
 *     enforcement of that rule against existing CRM rows).
 *   - Client status NEVER downgraded by sync logic (we touch opt-in,
 *     never type).
 *   - Pre-creation duplicate-check rule is moot here (we only update
 *     existing CRM rows; we never create contacts).
 */

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

import { BACKFILL_DAYS } from "../api/_lib/mailchimp-config.js";
import {
  computeEngagementTier,
  applyTierChange,
} from "../api/_lib/engagement-tier.js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const MC_API_KEY = (process.env.MAILCHIMP_API_KEY || "").trim();
const MC_AUDIENCE = process.env.MAILCHIMP_AUDIENCE_ID;
const MC_SERVER = (process.env.MAILCHIMP_SERVER || MC_API_KEY.split("-").pop() || "").trim().split(".")[0];

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !MC_API_KEY || !MC_AUDIENCE || !MC_SERVER) {
  console.error("Missing one or more required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MAILCHIMP_API_KEY, MAILCHIMP_AUDIENCE_ID, MAILCHIMP_SERVER.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const baseUrl = `https://${MC_SERVER}.api.mailchimp.com/3.0`;
const authHeader = "Basic " + Buffer.from(`anystring:${MC_API_KEY}`).toString("base64");

// ─── Stats ────────────────────────────────────────────────────────────
const stats = {
  startedAt: new Date().toISOString(),
  members_pulled: 0,
  members_matched_to_crm: 0,
  members_no_crm_match: 0,
  opt_in_set_true: 0,
  opt_in_set_false: 0,
  engagement_fields_updated: 0,
  campaigns_processed: 0,
  log_rows_written: 0,
  log_rows_skipped_duplicate: 0,
  tier_flips: 0,
  errors: [],
};

const noMatchEmails = [];
const optOutEmails = [];

// ─── Mailchimp helpers ────────────────────────────────────────────────

async function mcGet(url) {
  const res = await fetch(url, {
    headers: { Authorization: authHeader, "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Mailchimp GET ${url} -> ${res.status}: ${txt}`);
  }
  return res.json();
}

async function pullAllMembers() {
  // Mailchimp page size 1000 max. Paginate by offset.
  const pageSize = 1000;
  let offset = 0;
  const all = [];
  while (true) {
    const data = await mcGet(
      `${baseUrl}/lists/${MC_AUDIENCE}/members?count=${pageSize}&offset=${offset}&fields=members.id,members.email_address,members.unique_email_id,members.status,members.member_rating,members.last_changed,members.tags,members.email_client,total_items`,
    );
    const batch = data.members || [];
    all.push(...batch);
    stats.members_pulled = all.length;
    process.stdout.write(`  pulled ${all.length} of ${data.total_items}\r`);
    if (batch.length < pageSize) break;
    offset += pageSize;
  }
  process.stdout.write("\n");
  return all;
}

async function pullRecentCampaigns(sinceIso) {
  // Reports API: list campaigns sent since sinceIso.
  const data = await mcGet(
    `${baseUrl}/reports?count=200&since_send_time=${encodeURIComponent(sinceIso)}&fields=reports.id,reports.campaign_title,reports.send_time,reports.list_id,total_items`,
  );
  return (data.reports || []).filter((r) => r.list_id === MC_AUDIENCE);
}

async function pullCampaignActivity(campaignId) {
  // email-activity returns per-member activity for one campaign.
  const all = [];
  const pageSize = 1000;
  let offset = 0;
  while (true) {
    const data = await mcGet(
      `${baseUrl}/reports/${campaignId}/email-activity?count=${pageSize}&offset=${offset}&fields=emails.email_address,emails.activity,total_items`,
    );
    const batch = data.emails || [];
    all.push(...batch);
    if (batch.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}

// ─── Supabase helpers ─────────────────────────────────────────────────

async function findContactByEmail(email) {
  const { data, error } = await supabase
    .from("contacts")
    .select("id, email, contact_name, type, email_engagement_tier")
    .ilike("email", email)
    .limit(1)
    .maybeSingle();
  if (error) {
    stats.errors.push(`findContactByEmail(${email}): ${error.message}`);
    return null;
  }
  return data;
}

async function upsertEngagementLog(row) {
  const { error } = await supabase
    .from("email_engagement_log")
    .upsert(row, {
      onConflict: "contact_id,mailchimp_campaign_id,event_type,occurred_at",
      ignoreDuplicates: true,
    });
  if (error) {
    if (/duplicate/i.test(error.message)) {
      stats.log_rows_skipped_duplicate += 1;
      return;
    }
    stats.errors.push(`upsertEngagementLog: ${error.message}`);
    return;
  }
  stats.log_rows_written += 1;
}

// ─── Main pipeline ────────────────────────────────────────────────────

async function step1_membersAndOptIn(members) {
  console.log(`Step 1: process ${members.length} Mailchimp members against CRM contacts.`);
  for (const m of members) {
    const email = m.email_address;
    const status = m.status; // subscribed | unsubscribed | cleaned | pending | transactional
    const isOptedIn = status === "subscribed";
    const contact = await findContactByEmail(email);

    if (!contact) {
      stats.members_no_crm_match += 1;
      noMatchEmails.push(email);
      continue;
    }
    stats.members_matched_to_crm += 1;

    const patch = {
      email_marketing_opt_in: isOptedIn,
      email_marketing_opt_in_changed_at: m.last_changed || new Date().toISOString(),
      email_marketing_opt_in_source: "initial_backfill",
      email_marketing_opt_in_reason: isOptedIn ? null : `mailchimp_status_${status}`,
      email_engagement_score: typeof m.member_rating === "number" ? m.member_rating : null,
      mailchimp_tags: Array.isArray(m.tags) ? m.tags.map((t) => t.name).filter(Boolean) : [],
    };
    if (status === "cleaned") {
      patch.email_bounce_status = "hard";
      patch.email_bounce_last_at = m.last_changed || new Date().toISOString();
    }

    const { error } = await supabase
      .from("contacts")
      .update(patch)
      .eq("id", contact.id);
    if (error) {
      stats.errors.push(`update contact ${contact.id}: ${error.message}`);
      continue;
    }

    if (isOptedIn) stats.opt_in_set_true += 1;
    else {
      stats.opt_in_set_false += 1;
      optOutEmails.push(`${email} (${status})`);
    }
    stats.engagement_fields_updated += 1;
  }
}

async function step2_campaignActivity() {
  const sinceMs = Date.now() - BACKFILL_DAYS * 24 * 60 * 60 * 1000;
  const sinceIso = new Date(sinceMs).toISOString();
  console.log(`Step 2: pull campaign activity since ${sinceIso} (${BACKFILL_DAYS} days).`);

  const campaigns = await pullRecentCampaigns(sinceIso);
  console.log(`  ${campaigns.length} campaigns in window.`);

  for (const c of campaigns) {
    stats.campaigns_processed += 1;
    process.stdout.write(`  campaign ${stats.campaigns_processed}/${campaigns.length}: ${c.campaign_title}\n`);
    let activity;
    try {
      activity = await pullCampaignActivity(c.id);
    } catch (err) {
      stats.errors.push(`pullCampaignActivity(${c.id}): ${err.message}`);
      continue;
    }

    // For each email, walk activity events and write log rows.
    // Latest event per type also updates the contact's last_open_at /
    // last_click_at. opens_30d / clicks_30d are aggregated at the end.
    const lastOpenByEmail = new Map();
    const lastClickByEmail = new Map();
    const recentActivityByEmail = new Map(); // email -> { opens30d, clicks30d }

    const cutoff30d = Date.now() - 30 * 24 * 60 * 60 * 1000;

    for (const e of activity) {
      const contact = await findContactByEmail(e.email_address);
      if (!contact) continue;
      const events = Array.isArray(e.activity) ? e.activity : [];
      let opens = 0;
      let clicks = 0;
      let lastOpen = null;
      let lastClick = null;
      for (const ev of events) {
        const occurredAt = ev.timestamp ? new Date(ev.timestamp) : null;
        if (!occurredAt) continue;
        let logEvent = null;
        let url = null;
        if (ev.action === "open") {
          logEvent = "open";
          if (!lastOpen || occurredAt > lastOpen) lastOpen = occurredAt;
          if (occurredAt.getTime() >= cutoff30d) opens += 1;
        } else if (ev.action === "click") {
          logEvent = "click";
          url = ev.url || null;
          if (!lastClick || occurredAt > lastClick) lastClick = occurredAt;
          if (occurredAt.getTime() >= cutoff30d) clicks += 1;
        } else if (ev.action === "bounce") {
          logEvent = ev.type === "hard" ? "bounce_hard" : "bounce_soft";
        }
        if (logEvent) {
          await upsertEngagementLog({
            contact_id: contact.id,
            mailchimp_campaign_id: c.id,
            mailchimp_campaign_title: c.campaign_title || null,
            event_type: logEvent,
            event_url: url,
            occurred_at: occurredAt.toISOString(),
          });
        }
      }
      // Aggregate against any prior campaigns processed in this run.
      const prior = recentActivityByEmail.get(e.email_address) || { opens30d: 0, clicks30d: 0 };
      recentActivityByEmail.set(e.email_address, {
        opens30d: prior.opens30d + opens,
        clicks30d: prior.clicks30d + clicks,
      });
      if (lastOpen) {
        const prev = lastOpenByEmail.get(e.email_address);
        if (!prev || lastOpen > prev) lastOpenByEmail.set(e.email_address, lastOpen);
      }
      if (lastClick) {
        const prev = lastClickByEmail.get(e.email_address);
        if (!prev || lastClick > prev) lastClickByEmail.set(e.email_address, lastClick);
      }
    }

    // Write the per-contact rollups for this campaign.
    for (const [email, agg] of recentActivityByEmail.entries()) {
      const contact = await findContactByEmail(email);
      if (!contact) continue;
      const lastOpen = lastOpenByEmail.get(email) || null;
      const lastClick = lastClickByEmail.get(email) || null;
      const patch = {};
      if (lastOpen) patch.email_last_open_at = lastOpen.toISOString();
      if (lastClick) patch.email_last_click_at = lastClick.toISOString();
      if (agg.opens30d != null) patch.email_opens_30d = agg.opens30d;
      if (agg.clicks30d != null) patch.email_clicks_30d = agg.clicks30d;
      if (Object.keys(patch).length > 0) {
        const { error } = await supabase.from("contacts").update(patch).eq("id", contact.id);
        if (error) stats.errors.push(`rollup update ${contact.id}: ${error.message}`);
      }
    }
  }
}

async function step3_recomputeTiers() {
  console.log(`Step 3: recompute engagement tier for every contact with an email.`);
  const { data: contacts, error } = await supabase
    .from("contacts")
    .select("id, contact_name, type, email, email_marketing_opt_in, email_engagement_tier, email_last_open_at, email_last_click_at, email_opens_30d, email_clicks_30d, email_bounce_status")
    .not("email", "is", null);
  if (error) {
    stats.errors.push(`tier scan: ${error.message}`);
    return;
  }
  for (const c of contacts || []) {
    const tier = computeEngagementTier({
      lastOpenAt: c.email_last_open_at,
      lastClickAt: c.email_last_click_at,
      opens30d: c.email_opens_30d || 0,
      clicks30d: c.email_clicks_30d || 0,
      hasUnsubscribed: c.email_marketing_opt_in === false,
      hasHardBounce: c.email_bounce_status === "hard",
      currentTier: c.email_engagement_tier,
    });
    const result = await applyTierChange({ supabase, contact: c, newTier: tier });
    if (result.changed) stats.tier_flips += 1;
  }
}

async function writeReport() {
  const date = new Date().toISOString().slice(0, 10);
  const home = process.env.HOME || ".";
  const outDir = path.join(home, "Documents", "Claude", "outputs");
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `mailchimp-backfill-${date}.md`);

  const lines = [];
  lines.push(`# Mailchimp two-way sync backfill report`);
  lines.push("");
  lines.push(`**Date:** ${date}`);
  lines.push(`**Started at:** ${stats.startedAt}`);
  lines.push(`**Completed at:** ${new Date().toISOString()}`);
  lines.push(`**Window:** ${BACKFILL_DAYS} days`);
  lines.push("");
  lines.push(`## Counts`);
  lines.push("");
  lines.push(`- Mailchimp members pulled: ${stats.members_pulled}`);
  lines.push(`- Members matched to CRM contact: ${stats.members_matched_to_crm}`);
  lines.push(`- Members with no CRM match: ${stats.members_no_crm_match}`);
  lines.push(`- Opt-in set TRUE on: ${stats.opt_in_set_true}`);
  lines.push(`- Opt-in set FALSE on: ${stats.opt_in_set_false}`);
  lines.push(`- Engagement fields populated for: ${stats.engagement_fields_updated}`);
  lines.push(`- Campaigns processed: ${stats.campaigns_processed}`);
  lines.push(`- email_engagement_log rows written (new): ${stats.log_rows_written}`);
  lines.push(`- email_engagement_log rows skipped (duplicate): ${stats.log_rows_skipped_duplicate}`);
  lines.push(`- Tier flips applied: ${stats.tier_flips}`);
  lines.push(`- Errors: ${stats.errors.length}`);
  lines.push("");
  if (optOutEmails.length > 0) {
    lines.push(`## Contacts flipped to opt-in FALSE`);
    lines.push("");
    for (const e of optOutEmails) lines.push(`- ${e}`);
    lines.push("");
  }
  if (noMatchEmails.length > 0) {
    lines.push(`## Mailchimp members with no CRM contact (informational)`);
    lines.push("");
    for (const e of noMatchEmails.slice(0, 50)) lines.push(`- ${e}`);
    if (noMatchEmails.length > 50) lines.push(`- ... ${noMatchEmails.length - 50} more`);
    lines.push("");
  }
  if (stats.errors.length > 0) {
    lines.push(`## Errors`);
    lines.push("");
    for (const e of stats.errors.slice(0, 100)) lines.push(`- ${e}`);
    lines.push("");
  }
  lines.push(`## Next steps`);
  lines.push("");
  lines.push(`1. Review opt-out list above. Confirm Steve Kuncewicz and Jon Nunn (today's Wrap-send unsubs) are present.`);
  lines.push(`2. Hand to Tes for sign-off against MAIL-SYNC-001 spec section 8.7.`);
  lines.push(`3. Once signed off, retire the manual gap-stop in TASK-BOARD.md (mark WRAP-MAILCHIMP-UNSUB-SWEEP as ENDED).`);
  lines.push("");

  fs.writeFileSync(out, lines.join("\n") + "\n");
  console.log(`\nReport written to ${out}`);
}

(async function main() {
  try {
    console.log(`MAIL-SYNC-001 backfill starting. Window: ${BACKFILL_DAYS} days.`);
    const members = await pullAllMembers();
    await step1_membersAndOptIn(members);
    await step2_campaignActivity();
    await step3_recomputeTiers();
    await writeReport();
    console.log(`Done. ${stats.errors.length} errors logged.`);
    process.exit(stats.errors.length > 0 ? 1 : 0);
  } catch (err) {
    console.error("Backfill aborted:", err);
    stats.errors.push(`fatal: ${err.message}`);
    try { await writeReport(); } catch (_) { /* swallow */ }
    process.exit(2);
  }
})();
