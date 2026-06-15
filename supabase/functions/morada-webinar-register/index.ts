// Form 1: Morada / Steve "AI for Contractors" free webinar registration.
//   Event: Mon 20 Jul 2026, 15:00-16:00 BST, Zoom Webinar. Free.
//   Spec: outputs/tes-spec-morada-forms-1-and-2-2026-06-15.md section 2.
//
// Posted to from the Squarespace page /morada-ai-webinar (Code Block embed at
// outputs/rex-morada-forms-built-2026-06-15/form-1-webinar/). Returns JSON; the
// embed renders the success panel and fires GA4 client-side (spec 1.4 / 2.4).

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import {
  badRequest,
  brandedEmail,
  buildCorsHeaders,
  buildIcs,
  checkDbRateLimit,
  escapeHtml,
  getClientIp,
  icsToBase64,
  isHoneypotTripped,
  json,
  ok,
  originRefererOk,
  parseUtm,
  routeFromUtm,
  sendResend,
  serviceClient,
  syncToMailchimp,
  testMode,
  tooFast,
  upsertContactAndActivity,
  validateCommon,
} from "../_shared/forms.ts";

// Event constants (spec 2). Times in UTC (BST is UTC+1).
const EVENT_START_UTC = "20260720T140000Z";
const EVENT_END_UTC = "20260720T150000Z";
const EVENT_LABEL = "Diagonal Thinking: AI for Contractors (free webinar)";
// Join link source is the Zoom Webinar 500-attendee add-on (D13, blocks launch).
// Read from env so the link can be set without a code change.
const ZOOM_WEBINAR_JOIN = Deno.env.get("MORADA_WEBINAR_JOIN_URL") ?? "";

serve(async (req: Request) => {
  const cors = buildCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: cors, status: 204 });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);

  // P0: server-side Origin + Referer allowlist (not just CORS headers).
  if (!originRefererOk(req)) {
    console.log("[security] origin/referer rejected");
    return json({ error: "Forbidden" }, 403, cors);
  }
  const clientIp = getClientIp(req);

  try {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return badRequest("Invalid JSON body", cors);
    }

    // Honeypot -> benign (bots get no signal). Timing -> clear retryable message
    // so a fast/autofill legit user is never silently dropped.
    if (isHoneypotTripped(body)) {
      console.log(`[spam] honeypot tripped, silent drop (IP: ${clientIp})`);
      return ok({}, cors);
    }
    if (tooFast(body)) {
      console.log(`[spam] too-fast submit (IP: ${clientIp})`);
      return json({
        success: false,
        reason: "too_fast",
        error: "That was quick - please review your details and submit again.",
      }, 200, cors);
    }

    const fields = {
      first_name: String(body.first_name ?? "").trim(),
      last_name: String(body.last_name ?? "").trim(),
      email: String(body.email ?? "").trim().toLowerCase(),
      company: String(body.company ?? "").trim(),
      role: String(body.role ?? "").trim(),
    };
    const howHeard = String(body.how_heard ?? "").trim().slice(0, 100);
    const takeaway = String(body.takeaway ?? "").trim().slice(0, 500);
    const marketingConsent = body.marketing_consent === true || body.marketing_consent === "true";

    // Layer 2: shared validation.
    const validationError = validateCommon(fields);
    if (validationError) {
      console.log(`[validation] ${validationError} (IP: ${clientIp})`);
      return badRequest(validationError, cors);
    }

    const utm = parseUtm(body);
    const route = routeFromUtm(utm);

    const supabase = serviceClient();
    // P0: persistent rate limit (survives cold start), separate Form 1 bucket.
    if (!(await checkDbRateLimit(supabase, `webinar:${clientIp}`))) {
      return json({ error: "Too many requests. Please try again later." }, 429, cors);
    }

    // CRM write (email-keyed upsert + non-blocking activity). Spec 1.6 / 2.3.
    const { contactError } = await upsertContactAndActivity(supabase, {
      contactName: `${fields.first_name} ${fields.last_name}`,
      email: fields.email,
      company: fields.company,
      type: "Warm Lead",
      source: route.source,
      activityType: "webinar_registration",
      activitySubject: "Registered: AI for Contractors webinar (20 Jul 2026)",
      activityMeta: {
        role: fields.role,
        how_heard: howHeard,
        takeaway,
        marketing_consent: marketingConsent,
        ...utm,
        opp_route: route.oppRoute, // "link" -> opp 229660dd, "new" -> new opp (manual recon)
      },
    });
    if (contactError) {
      return json({ error: "Failed to save your registration. Please try again." }, 500, cors);
    }

    // Mailchimp: event tags always; marketing tag only on consent (spec 1.3 / 2.2).
    const mailchimpKey = Deno.env.get("MAILCHIMP_API_KEY");
    if (testMode()) {
      console.log(`[test-mode] mailchimp: skipped, would-have-tagged: ${fields.email}`);
    } else if (mailchimpKey) {
      syncToMailchimp(
        {
          email: fields.email,
          firstName: fields.first_name,
          lastName: fields.last_name,
          company: fields.company,
          type: "Warm Lead",
          tags: ["morada-ai-2026", "morada-webinar-2026-07-20-registered"],
          marketingTag: "morada-ai-2026-marketing",
          marketingConsent,
        },
        mailchimpKey,
      ).catch((err) => console.error("Mailchimp sync error:", err));
    }

    // Build the .ics for the confirmation panel and email.
    const ics = buildIcs([
      {
        uid: `morada-webinar-2026-07-20-${fields.email}`,
        startUtc: EVENT_START_UTC,
        endUtc: EVENT_END_UTC,
        summary: EVENT_LABEL,
        description: ZOOM_WEBINAR_JOIN
          ? `Join link: ${ZOOM_WEBINAR_JOIN}`
          : "Your Zoom join link will follow by email.",
        url: ZOOM_WEBINAR_JOIN || undefined,
      },
    ]);

    // Transactional confirmation email. Always sent, regardless of consent
    // (spec 1.2 / 2.2). Body copy is a Mae deliverable; this is the v1 wiring
    // with Phil-voice sign-off (D16 default).
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (testMode()) {
      console.log(`[test-mode] email: skipped, would-have-sent: {to:${fields.email}, subject:webinar confirmation}`);
    } else if (resendKey) {
      const joinBlock = ZOOM_WEBINAR_JOIN
        ? `<p><strong>Join link:</strong> <a href="${escapeHtml(ZOOM_WEBINAR_JOIN)}">${escapeHtml(ZOOM_WEBINAR_JOIN)}</a></p>`
        : `<p>Your Zoom join link will follow by email before the session.</p>`;
      sendResend(
        {
          to: fields.email,
          subject: "You are registered: AI for Contractors webinar, Mon 20 Jul",
          html: brandedEmail({
            heading: "You are registered",
            bodyHtml:
              `<p>Hi ${escapeHtml(fields.first_name)},</p>` +
              `<p>You are registered for the AI for Contractors webinar with Diagonal Thinking and Morada.</p>` +
              `<p><strong>When:</strong> Monday 20 July 2026, 3:00pm to 4:00pm BST.</p>` +
              joinBlock +
              `<p>A calendar invite is attached so you do not lose the slot.</p>` +
              `<p>See you there,<br>Phil<br>Diagonal Thinking</p>`,
          }),
          attachments: [{ filename: "ai-for-contractors-webinar.ics", content: icsToBase64(ics) }],
        },
        resendKey,
      ).catch((err) => console.error("Resend send error:", err));
    }

    // Return the join link + ics so the embed can render the success panel and
    // fire GA4 generate_lead once on this 200 (spec 2.4).
    return ok({
      join_url: ZOOM_WEBINAR_JOIN || null,
      ics_base64: icsToBase64(ics),
      campaign: utm.utm_campaign,
    }, cors);
  } catch (err) {
    console.error("Unexpected error:", err);
    return json({ error: "An unexpected error occurred." }, 500, cors);
  }
});
