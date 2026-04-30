import { getSupabaseAdmin, listSessionDetails, saveSessionDetails } from "../_lib/client-area.js";
import { requireAuthedUser } from "../_lib/auth.js";

export default async function handler(req, res) {
  try {
    const supabase = getSupabaseAdmin();

    // SEC-API-001 (Hex risk register, 30 Apr 2026): gate every method on this
    // route behind a valid Supabase user JWT. Previously the GET returned the
    // full session list with embedded contact emails to anyone who could hit
    // the URL, and POST/PATCH let anyone mutate the table. The check runs
    // BEFORE any DB query so no service-role read fires for unauth callers.
    const user = await requireAuthedUser(req, supabase);
    if (!user) {
      return res.status(401).end();
    }

    if (req.method === "GET") {
      const sessions = await listSessionDetails(supabase);
      return res.status(200).json({ sessions });
    }

    if (req.method === "POST" || req.method === "PATCH") {
      const session = await saveSessionDetails(supabase, req.body || {});
      return res.status(200).json({ session });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Unable to handle client sessions.",
    });
  }
}
