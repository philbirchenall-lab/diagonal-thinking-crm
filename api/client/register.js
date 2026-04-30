import {
  ensureContactForSessionRegistration,
  getSessionBySlug,
  getSupabaseAdmin,
  logRegistrationIfNeeded,
} from "../_lib/client-area.js";
import { applyRateLimit } from "../_lib/rate-limit.js";

// SEC-API-002: 3 registrations per IP per hour. Tighter than the auth-request
// limit because legitimate users register a session once, not five times in
// ten minutes.
const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Run BEFORE any DB read.
  if (
    applyRateLimit(req, res, {
      bucket: "client-register",
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

    await logRegistrationIfNeeded(supabase, session.id, contact.id);

    return res.status(200).json({ success: true, contactId: contact.id });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Registration failed.",
    });
  }
}
