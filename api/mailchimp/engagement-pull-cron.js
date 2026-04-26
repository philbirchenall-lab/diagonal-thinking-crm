/**
 * api/mailchimp/engagement-pull-cron.js
 *
 * Daily polling task for MAIL-SYNC-001 engagement intelligence.
 *
 * Triggered by Vercel cron at 02:00 UTC daily (vercel.json crons block).
 * Pulls Mailchimp Member Activity API + Reports API, updates the seven
 * engagement fields per contact, writes email_engagement_log rows for
 * any new opens / clicks, recomputes engagement tier, applies sales
 * triggers (proposal magic-link click detection).
 *
 * Spec ref: section 6.3 the polling task.
 *
 * Cron auth: Authorization: Bearer <CRON_SECRET> header (Vercel cron
 * sends this automatically when CRON_SECRET is set as the project env
 * var, mirroring the proposal-followup-cron pattern).
 *
 * Window: 36 hours back from now to give one cycle of overlap (catches
 * any events that landed late or were missed by the previous run).
 * Idempotency on email_engagement_log unique index makes the overlap safe.
 *
 * Phil Q3: iMessage triggers only on material events (Client tier flips,
 * hard bounces, proposal click in open opportunity). All handled by the
 * helper modules.
 */

import { createClient } from "@supabase/supabase-js";

import {
  computeEngagementTier,
  applyTierChange,
  detectProposalClick,
  applyProposalClickTrigger,
} from "../_lib/engagement-tier.js";

const POLL_HOURS_BACK = 36;

function verifyAuth(req) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return true; // dev only
  const authHeader = req.headers["authorization"] ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  return token === cronSecret;
}

async function mcGet(baseUrl, authHeader, pathPart) {
  const res = await fetch(`${baseUrl}${pathPart}`, {
    headers: { Authorization: authHeader, "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Mailchimp GET ${pathPart} -> ${res.status}: ${txt}`);
  }
  return res.json();
}

export default async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!verifyAuth(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  const MC_API_KEY = (process.env.MAILCHIMP_API_KEY || "").trim();
  const MC_AUDIENCE = process.env.MAILCHIMP_AUDIENCE_ID;
  const MC_SERVER = (process.env.MAILCHIMP_SERVER || MC_API_KEY.split("-").pop() || "").trim().split(".")[0];

  if (!SUPABASE_URL || !SUPABASE_KEY || !MC_API_KEY || !MC_AUDIENCE || !MC_SERVER) {
    return res.status(500).json({ error: "Missing required env vars." });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const baseUrl = `https://${MC_SERVER}.api.mailchimp.com/3.0`;
  const authHeader = "Basic " + Buffer.from(`anystring:${MC_API_KEY}`).toString("base64");

  const sinceMs = Date.now() - POLL_HOURS_BACK * 60 * 60 * 1000;
  const sinceIso = new Date(sinceMs).toISOString();

  const stats = {
    started_at: new Date().toISOString(),
    campaigns_touched: 0,
    log_rows_written: 0,
    contacts_updated: 0,
    tier_flips: 0,
    proposal_clicks_detected: 0,
    errors: [],
  };

  try {
    // 1. Pull recently-sent campaigns.
    const reportsRes = await mcGet(
      baseUrl,
      authHeader,
      `/reports?count=100&since_send_time=${encodeURIComponent(sinceIso)}&fields=reports.id,reports.campaign_title,reports.send_time,reports.list_id`,
    );
    const campaigns = (reportsRes.reports || []).filter((r) => r.list_id === MC_AUDIENCE);

    for (const c of campaigns) {
      stats.campaigns_touched += 1;

      // 2. Pull per-member activity for each campaign.
      const activityRes = await mcGet(
        baseUrl,
        authHeader,
        `/reports/${c.id}/email-activity?count=1000&fields=emails.email_address,emails.activity`,
      );
      const emails = activityRes.emails || [];

      for (const e of emails) {
        const events = Array.isArray(e.activity) ? e.activity : [];
        // Find CRM contact.
        const { data: contact } = await supabase
          .from("contacts")
          .select("id, contact_name, type, email_engagement_tier, email_marketing_opt_in, email_bounce_status, email_last_open_at, email_last_click_at, email_opens_30d, email_clicks_30d")
          .ilike("email", e.email_address)
          .limit(1)
          .maybeSingle();
        if (!contact) continue;

        let lastOpen = contact.email_last_open_at ? new Date(contact.email_last_open_at) : null;
        let lastClick = contact.email_last_click_at ? new Date(contact.email_last_click_at) : null;
        let opens30dDelta = 0;
        let clicks30dDelta = 0;
        const cutoff30d = Date.now() - 30 * 24 * 60 * 60 * 1000;

        for (const ev of events) {
          const occurredAt = ev.timestamp ? new Date(ev.timestamp) : null;
          if (!occurredAt || occurredAt.getTime() < sinceMs) continue;
          let logEvent = null;
          let url = null;
          if (ev.action === "open") {
            logEvent = "open";
            if (!lastOpen || occurredAt > lastOpen) lastOpen = occurredAt;
            if (occurredAt.getTime() >= cutoff30d) opens30dDelta += 1;
          } else if (ev.action === "click") {
            logEvent = "click";
            url = ev.url || null;
            if (!lastClick || occurredAt > lastClick) lastClick = occurredAt;
            if (occurredAt.getTime() >= cutoff30d) clicks30dDelta += 1;
          } else if (ev.action === "bounce") {
            logEvent = ev.type === "hard" ? "bounce_hard" : "bounce_soft";
          }
          if (logEvent) {
            const { error: logErr } = await supabase
              .from("email_engagement_log")
              .upsert({
                contact_id: contact.id,
                mailchimp_campaign_id: c.id,
                mailchimp_campaign_title: c.campaign_title || null,
                event_type: logEvent,
                event_url: url,
                occurred_at: occurredAt.toISOString(),
              }, {
                onConflict: "contact_id,mailchimp_campaign_id,event_type,occurred_at",
                ignoreDuplicates: true,
              });
            if (!logErr) stats.log_rows_written += 1;

            // Sales trigger: detect proposal magic-link click.
            if (logEvent === "click" && url) {
              const det = detectProposalClick(url);
              if (det.isProposalClick) {
                stats.proposal_clicks_detected += 1;
                try {
                  await applyProposalClickTrigger({
                    supabase,
                    contactId: contact.id,
                    proposalCode: det.proposalCode,
                    campaignId: c.id,
                    campaignTitle: c.campaign_title,
                    eventUrl: url,
                    occurredAt,
                  });
                } catch (trgErr) {
                  stats.errors.push(`proposal trigger ${contact.id}: ${trgErr.message}`);
                }
              }
            }
          }
        }

        // 3. Update contact aggregates.
        const patch = {};
        if (lastOpen) patch.email_last_open_at = lastOpen.toISOString();
        if (lastClick) patch.email_last_click_at = lastClick.toISOString();
        if (opens30dDelta > 0) patch.email_opens_30d = (contact.email_opens_30d || 0) + opens30dDelta;
        if (clicks30dDelta > 0) patch.email_clicks_30d = (contact.email_clicks_30d || 0) + clicks30dDelta;

        if (Object.keys(patch).length > 0) {
          const { error: updErr } = await supabase
            .from("contacts")
            .update(patch)
            .eq("id", contact.id);
          if (updErr) stats.errors.push(`contact update ${contact.id}: ${updErr.message}`);
          else stats.contacts_updated += 1;
        }

        // 4. Recompute tier.
        const newTier = computeEngagementTier({
          lastOpenAt: patch.email_last_open_at || contact.email_last_open_at,
          lastClickAt: patch.email_last_click_at || contact.email_last_click_at,
          opens30d: patch.email_opens_30d || contact.email_opens_30d || 0,
          clicks30d: patch.email_clicks_30d || contact.email_clicks_30d || 0,
          hasUnsubscribed: contact.email_marketing_opt_in === false,
          hasHardBounce: contact.email_bounce_status === "hard",
          currentTier: contact.email_engagement_tier,
        });
        const tierResult = await applyTierChange({ supabase, contact, newTier });
        if (tierResult.changed) stats.tier_flips += 1;
      }
    }

    return res.status(200).json({ ok: true, stats });
  } catch (err) {
    console.error("[engagement-pull-cron] aborted:", err);
    stats.errors.push(`fatal: ${err.message}`);
    return res.status(500).json({ ok: false, stats, error: err.message });
  }
}
