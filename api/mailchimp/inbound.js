/**
 * api/mailchimp/inbound.js
 *
 * MAIL-SYNC-001 inbound webhook listener.
 *
 * Mailchimp posts here on every audience event we care about:
 * subscribe, unsubscribe, profile update, email change (upemail),
 * cleaned address. Mailchimp does NOT post opens or clicks; those
 * come from the Reports API on a daily poll.
 *
 * Spec ref: section 5 (full unsubscribe pipeline).
 * Acceptance criteria: section 8.3.
 *
 * Configure the webhook in Mailchimp dashboard:
 *   Audience -> Settings -> Webhooks -> Create New Webhook
 *   URL: https://crm.diagonalthinking.co/api/mailchimp/inbound?secret=<MAILCHIMP_WEBHOOK_SECRET>
 *   Events: subscribes, unsubscribes, profile updates, email address changes, cleaned
 *   Sources: tick "By a campaign", "By an account admin", "By a list import"
 *
 * Standing rules respected:
 *   - Pre-creation duplicate-check rule applied to upemail handler (match by
 *     old email first, fall back to name + LinkedIn URL + company).
 *   - Mailchimp opt-out is GROUND TRUTH; CRM never overwrites.
 *   - Client status NEVER downgraded by sync logic (we touch
 *     email_marketing_opt_in, never type).
 *   - Idempotency on (contact_id, mailchimp_campaign_id, event_type, occurred_at)
 *     enforced by the unique index on email_engagement_log.
 */

import { getSupabaseAdmin } from "../_lib/client-area.js";
import { WEBHOOK_EVENT_TYPES } from "../_lib/mailchimp-config.js";
import { sendImessageOnEvent } from "../_lib/imessage.js";

// Vercel parses application/x-www-form-urlencoded into req.body for the
// Node runtime. Mailchimp sends webhooks in that format with PHP-style
// flat array notation, so req.body.data is already a flat object with
// keys like "email", "merges[FNAME]", "ip_opt", etc.
export const config = {
  api: {
    bodyParser: {
      sizeLimit: "1mb",
    },
  },
};

export default async function handler(req, res) {
  // ─── 1. Health check (Mailchimp pings GET on webhook create) ───────
  if (req.method === "GET") {
    return res.status(200).json({ status: "ok", endpoint: "mailchimp-inbound" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // ─── 2. Shared-secret query-string check ────────────────────────────
  const expectedSecret = process.env.MAILCHIMP_WEBHOOK_SECRET || "";
  const providedSecret = (req.query && req.query.secret) || "";

  if (!expectedSecret) {
    console.error(
      "[mailchimp/inbound] MAILCHIMP_WEBHOOK_SECRET is not set in env. Refusing all webhooks.",
    );
    return res.status(500).json({ error: "Webhook secret not configured." });
  }
  if (providedSecret !== expectedSecret) {
    console.warn(
      "[mailchimp/inbound] Rejected webhook with missing or wrong secret.",
    );
    return res.status(401).json({ error: "Invalid secret." });
  }

  // ─── 3. Parse the payload ───────────────────────────────────────────
  // Mailchimp sends type + fired_at + data[*]. Vercel surfaces these
  // in req.body. The structure is flat (no nested objects), so we
  // pluck what each event type needs from data and merges.
  const body = req.body || {};
  const eventType = String(body.type || "").trim().toLowerCase();
  const data = body.data || {};

  if (!WEBHOOK_EVENT_TYPES.includes(eventType)) {
    console.log(
      `[mailchimp/inbound] Ignoring unknown event type: ${eventType}`,
    );
    return res.status(200).json({ status: "ignored", reason: "event_type_not_handled" });
  }

  const occurredAt = parseFiredAt(body.fired_at) || new Date();
  const supabase = getSupabaseAdmin();

  // ─── 4. Route by event type ─────────────────────────────────────────
  try {
    let result;
    switch (eventType) {
      case "unsubscribe":
        result = await handleUnsubscribe({ supabase, data, occurredAt });
        break;
      case "subscribe":
        result = await handleSubscribe({ supabase, data, occurredAt });
        break;
      case "profile":
        result = await handleProfile({ supabase, data, occurredAt });
        break;
      case "upemail":
        result = await handleUpemail({ supabase, data, occurredAt });
        break;
      case "cleaned":
        result = await handleCleaned({ supabase, data, occurredAt });
        break;
      default:
        // Already filtered above, defensive only.
        result = { status: "ignored" };
    }
    return res.status(200).json({ status: "ok", event: eventType, result });
  } catch (err) {
    console.error(
      `[mailchimp/inbound] Handler error for ${eventType}:`,
      err && err.message ? err.message : err,
    );
    // Return 200 so Mailchimp does not retry storm. The error is logged
    // for follow-up; webhook retries can mask root cause.
    return res.status(200).json({
      status: "error_logged",
      event: eventType,
      message: err && err.message ? err.message : "unknown",
    });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────

/** Mailchimp fires_at format: "2009-03-26 21:40:57" UTC. */
function parseFiredAt(raw) {
  if (!raw) return null;
  const isoish = String(raw).replace(" ", "T") + "Z";
  const dt = new Date(isoish);
  return isNaN(dt.getTime()) ? null : dt;
}

/**
 * Find a CRM contact by email (case-insensitive). Returns the row or null.
 */
async function findContactByEmail(supabase, email) {
  if (!email) return null;
  const { data, error } = await supabase
    .from("contacts")
    .select("id, email, contact_name, type, linkedin_url, company")
    .ilike("email", String(email).trim())
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error(`[mailchimp/inbound] findContactByEmail error: ${error.message}`);
    return null;
  }
  return data;
}

/**
 * Pre-creation duplicate check for the upemail handler. Match priority:
 *   1. Exact (case-insensitive) match on the OLD email.
 *   2. Composite match on contact_name + linkedin_url + company (any one
 *      pair that uniquely identifies the contact).
 *
 * Mailchimp's webhook payload does not carry our internal contact_id, so
 * old-email lookup is the primary key. Phil's brief flagged this as
 * critical: "if you process upemail as create-new + delete-old, you'd
 * create a duplicate AND lose history".
 */
async function findContactForEmailChange({ supabase, oldEmail, newEmail, name, linkedinUrl, company }) {
  // Primary path: match on old email.
  const byOld = await findContactByEmail(supabase, oldEmail);
  if (byOld) return { contact: byOld, matchedBy: "old_email" };

  // Fallback: composite match. We require at least two of name, linkedin_url, company
  // to land on the same single row before we trust the match.
  const filters = [];
  if (name) filters.push(`contact_name.ilike.${encodeFilter(name)}`);
  if (linkedinUrl) filters.push(`linkedin_url.eq.${encodeFilter(linkedinUrl)}`);
  if (company) filters.push(`company.ilike.${encodeFilter(company)}`);

  if (filters.length < 2) {
    return { contact: null, matchedBy: "no_match" };
  }

  const { data, error } = await supabase
    .from("contacts")
    .select("id, email, contact_name, type, linkedin_url, company")
    .or(filters.join(","))
    .limit(5);

  if (error || !data || data.length === 0) {
    return { contact: null, matchedBy: "no_match" };
  }

  // Score each candidate. Demand at least 2 of 3 attribute matches to
  // accept a fallback hit. Otherwise hold and surface to Sol.
  const scored = data.map((row) => {
    let score = 0;
    if (name && row.contact_name && row.contact_name.toLowerCase() === String(name).toLowerCase()) score += 1;
    if (linkedinUrl && row.linkedin_url === linkedinUrl) score += 1;
    if (company && row.company && row.company.toLowerCase() === String(company).toLowerCase()) score += 1;
    return { row, score };
  }).sort((a, b) => b.score - a.score);

  if (scored[0] && scored[0].score >= 2) {
    return { contact: scored[0].row, matchedBy: "composite_fallback" };
  }
  return { contact: null, matchedBy: "no_match" };
}

function encodeFilter(value) {
  // PostgREST .or() expects values not URL-encoded but with commas escaped.
  // For our use here values do not contain commas; pass through.
  return String(value).replace(/,/g, "\\,");
}

/**
 * Append a row to email_engagement_log. Idempotent on
 * (contact_id, mailchimp_campaign_id, event_type, occurred_at) via the
 * unique index from the migration.
 */
async function logEngagementEvent(supabase, { contactId, campaignId, campaignTitle, eventType, eventUrl, occurredAt }) {
  if (!contactId || !campaignId) return { skipped: "missing_keys" };
  const row = {
    contact_id: contactId,
    mailchimp_campaign_id: String(campaignId),
    mailchimp_campaign_title: campaignTitle || null,
    event_type: eventType,
    event_url: eventUrl || null,
    occurred_at: occurredAt instanceof Date ? occurredAt.toISOString() : occurredAt,
  };
  const { error } = await supabase
    .from("email_engagement_log")
    .upsert(row, {
      onConflict: "contact_id,mailchimp_campaign_id,event_type,occurred_at",
      ignoreDuplicates: true,
    });
  if (error) {
    console.error(`[mailchimp/inbound] logEngagementEvent failed: ${error.message}`);
    return { error: error.message };
  }
  return { ok: true };
}

/** Append a row to contact_activities. */
async function logContactActivity(supabase, { contactId, activityType, subtype, subject, body }) {
  if (!contactId) return;
  const { error } = await supabase
    .from("contact_activities")
    .insert({
      contact_id: contactId,
      activity_type: activityType,
      activity_subtype: subtype || null,
      subject: subject || null,
      body: body || null,
      status: "received",
    });
  if (error) {
    console.error(`[mailchimp/inbound] logContactActivity failed: ${error.message}`);
  }
}

// ─── Event handlers ────────────────────────────────────────────────────

async function handleUnsubscribe({ supabase, data, occurredAt }) {
  const email = data.email || (data.merges && data.merges.EMAIL) || null;
  const reason = data.reason || data.unsubscribe_reason || null;
  const campaignId = data.campaign_id || "unsubscribe_event";

  const contact = await findContactByEmail(supabase, email);
  if (!contact) {
    console.warn(`[mailchimp/inbound] unsubscribe: no CRM contact for ${email}.`);
    return { matched: false, email };
  }

  // Flip opt-in to false. Mailchimp opt-out is GROUND TRUTH.
  // Type field is left untouched (Client status never downgraded).
  const { error: updErr } = await supabase
    .from("contacts")
    .update({
      email_marketing_opt_in: false,
      email_marketing_opt_in_changed_at: occurredAt.toISOString(),
      email_marketing_opt_in_source: "mailchimp_webhook",
      email_marketing_opt_in_reason: reason,
    })
    .eq("id", contact.id);
  if (updErr) throw new Error(`unsubscribe update failed: ${updErr.message}`);

  await logEngagementEvent(supabase, {
    contactId: contact.id,
    campaignId,
    eventType: "unsubscribe",
    occurredAt,
  });

  await logContactActivity(supabase, {
    contactId: contact.id,
    activityType: "email_unsubscribed",
    subtype: "mailchimp_webhook",
    subject: "Unsubscribed from marketing email",
    body: reason ? `Reason: ${reason}` : "No reason given.",
  });

  // Phil Q3: silent on unsubscribes. No iMessage. Log only.
  return { matched: true, contactId: contact.id, action: "opt_in_set_false" };
}

async function handleSubscribe({ supabase, data, occurredAt }) {
  // Spec section 5.3: do NOT auto-flip opt-in to true on a subscribe
  // event. The CRM-driven outbound sync triggers Mailchimp subscribes
  // routinely; flipping CRM opt-in on every echo back would create a
  // noisy update loop. The manual override path is the only way back in.
  // We do log the engagement event for parity.
  const email = data.email || null;
  const campaignId = data.campaign_id || "subscribe_event";
  const contact = await findContactByEmail(supabase, email);
  if (!contact) return { matched: false, email };

  await logEngagementEvent(supabase, {
    contactId: contact.id,
    campaignId,
    eventType: "sent",
    occurredAt,
  });
  return { matched: true, contactId: contact.id, action: "logged_only" };
}

async function handleProfile({ supabase, data, occurredAt }) {
  // Profile update: Mailchimp wins on contact identity blanks (name,
  // email, contact email per spec section 7), CRM wins on type, services,
  // network_partner, projected_value. Conservative approach: only fill
  // CRM blanks; never overwrite a CRM value with a Mailchimp value.
  const email = data.email || null;
  const merges = data.merges || {};
  const contact = await findContactByEmail(supabase, email);
  if (!contact) return { matched: false, email };

  const patch = {};
  const fname = merges.FNAME || merges.fname || null;
  const lname = merges.LNAME || merges.lname || null;
  if ((fname || lname) && !contact.contact_name) {
    patch.contact_name = [fname, lname].filter(Boolean).join(" ").trim();
  }
  const company = merges.COMPANY || null;
  if (company && !contact.company) {
    patch.company = company;
  }

  if (Object.keys(patch).length > 0) {
    const { error: updErr } = await supabase
      .from("contacts")
      .update(patch)
      .eq("id", contact.id);
    if (updErr) throw new Error(`profile update failed: ${updErr.message}`);
  }

  return { matched: true, contactId: contact.id, action: "filled_blanks", patch };
}

async function handleUpemail({ supabase, data, occurredAt }) {
  // Email address changed in Mailchimp. CRITICAL per Phil's brief:
  // pre-creation duplicate check before we touch anything. Match by old
  // email first; fallback to composite name + linkedin + company.
  const oldEmail = data.old_email || null;
  const newEmail = data.new_email || null;
  const merges = data.merges || {};
  const fname = merges.FNAME || "";
  const lname = merges.LNAME || "";
  const name = `${fname} ${lname}`.trim() || null;
  const company = merges.COMPANY || null;
  const linkedinUrl = merges.LINKEDIN || null;

  const { contact, matchedBy } = await findContactForEmailChange({
    supabase,
    oldEmail,
    newEmail,
    name,
    linkedinUrl,
    company,
  });

  if (!contact) {
    console.warn(
      `[mailchimp/inbound] upemail: NO MATCH for old=${oldEmail} new=${newEmail}. Holding, surfacing to Sol via iMessage.`,
    );
    await sendImessageOnEvent({
      eventKind: "upemail_no_match",
      lines: [
        "Mailchimp upemail event with no CRM match.",
        `Old: ${oldEmail || "(none)"}`,
        `New: ${newEmail || "(none)"}`,
        `Name: ${name || "(none)"}, Company: ${company || "(none)"}`,
        "Action: Sol to find or create the contact manually.",
      ],
    });
    return { matched: false, oldEmail, newEmail };
  }

  // Check whether the new email already belongs to ANOTHER CRM contact.
  // If so, do NOT auto-merge per spec section 5.3 upemail row.
  const conflict = await findContactByEmail(supabase, newEmail);
  if (conflict && conflict.id !== contact.id) {
    console.warn(
      `[mailchimp/inbound] upemail: new email ${newEmail} already belongs to contact ${conflict.id}. Holding, surfacing to Sol.`,
    );
    await sendImessageOnEvent({
      eventKind: "upemail_conflict",
      lines: [
        "Mailchimp upemail would create a duplicate.",
        `Old contact: ${contact.id} (${oldEmail})`,
        `Conflict contact: ${conflict.id} (${newEmail})`,
        "Action: Sol to merge or override manually.",
      ],
    });
    return {
      matched: true,
      contactId: contact.id,
      action: "held_conflict",
      conflictWith: conflict.id,
    };
  }

  // Safe to update.
  const { error: updErr } = await supabase
    .from("contacts")
    .update({ email: newEmail })
    .eq("id", contact.id);
  if (updErr) throw new Error(`upemail update failed: ${updErr.message}`);

  await logContactActivity(supabase, {
    contactId: contact.id,
    activityType: "email_address_changed",
    subtype: "mailchimp_webhook",
    subject: `Email changed from ${oldEmail} to ${newEmail}`,
    body: `Matched by ${matchedBy}.`,
  });

  return { matched: true, contactId: contact.id, action: "email_updated", matchedBy };
}

async function handleCleaned({ supabase, data, occurredAt }) {
  // Mailchimp cleaned an address (hard bounce, abuse complaint, or other
  // permanent failure). Spec section 5.3: set bounce status hard, set
  // opt-in false, write log + activity rows, iMessage Phil per Q3.
  const email = data.email || null;
  const reason = data.reason || "cleaned";
  const campaignId = data.campaign_id || "cleaned_event";

  const contact = await findContactByEmail(supabase, email);
  if (!contact) {
    console.warn(`[mailchimp/inbound] cleaned: no CRM contact for ${email}.`);
    return { matched: false, email };
  }

  const { error: updErr } = await supabase
    .from("contacts")
    .update({
      email_bounce_status: "hard",
      email_bounce_last_at: occurredAt.toISOString(),
      email_marketing_opt_in: false,
      email_marketing_opt_in_changed_at: occurredAt.toISOString(),
      email_marketing_opt_in_source: "mailchimp_webhook",
      email_marketing_opt_in_reason: `cleaned: ${reason}`,
    })
    .eq("id", contact.id);
  if (updErr) throw new Error(`cleaned update failed: ${updErr.message}`);

  await logEngagementEvent(supabase, {
    contactId: contact.id,
    campaignId,
    eventType: "bounce_hard",
    occurredAt,
  });

  await logContactActivity(supabase, {
    contactId: contact.id,
    activityType: "email_bounced",
    subtype: "hard_bounce_cleaned",
    subject: "Mailchimp marked address as cleaned (hard bounce)",
    body: `Reason: ${reason}.`,
  });

  // Phil Q3: ping on hard bounces.
  await sendImessageOnEvent({
    eventKind: "hard_bounce",
    lines: [
      `Hard bounce on ${contact.email}.`,
      `Contact: ${contact.contact_name || "(no name)"} at ${contact.company || "(no company)"}.`,
      `Reason: ${reason}.`,
      "Action: Sol to verify the email and find a replacement.",
    ],
  });

  return { matched: true, contactId: contact.id, action: "bounce_hard_set" };
}
