import {
  createMagicLink,
  ensureContactForSessionRegistration,
  getSessionBySlug,
  getSupabaseAdmin,
  sendMagicLinkEmail,
} from "../../_lib/client-area.js";
import { applyRateLimit } from "../../_lib/rate-limit.js";

// SEC-API-002: 5 magic-link requests per IP per 10 minutes. Defaults sized
// for legitimate UX (occasional re-send, multiple devices) while shutting
// down enumeration/Resend-spam attacks.
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Run BEFORE any DB read or Resend call. Returning early on 429 is the
  // whole point of this fix.
  if (
    applyRateLimit(req, res, {
      bucket: "client-auth-request",
      max: RATE_LIMIT_MAX,
      windowMs: RATE_LIMIT_WINDOW_MS,
    })
  ) {
    return;
  }

  try {
    const body = req.body || {};
    const email = String(body.email || "").trim().toLowerCase();
    const sessionSlug = String(body.sessionSlug || "").trim();

    if (!email || !email.includes("@")) {
      return res.status(400).json({ error: "A valid email address is required." });
    }

    if (!sessionSlug) {
      return res.status(400).json({ error: "A session slug is required." });
    }

    const supabase = getSupabaseAdmin();
    const session = await getSessionBySlug(supabase, sessionSlug);

    if (!session) {
      return res.status(404).json({ error: "Session not found." });
    }

    if (session.status !== "active") {
      return res.status(400).json({ error: "This session is not active." });
    }

    const contact = await ensureContactForSessionRegistration(supabase, {
      email,
      firstName: body.firstName,
      lastName: body.lastName,
      companyName: body.companyName,
      jobTitle: body.jobTitle,
      session,
    });

    const magicLink = await createMagicLink(supabase, session.slug, contact.id);
    const verifyUrl = await sendMagicLinkEmail({
      email,
      sessionName: session.name,
      token: magicLink.token,
    });

    return res.status(200).json({
      success: true,
      email,
      sessionSlug: session.slug,
      verifyUrl,
    });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Unable to send magic link.",
    });
  }
}
