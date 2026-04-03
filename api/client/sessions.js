import { getSupabaseAdmin, listSessionDetails, saveSessionDetails } from "../_lib/client-area.js";

export default async function handler(req, res) {
  try {
    const supabase = getSupabaseAdmin();

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
