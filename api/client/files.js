import { getSupabaseAdmin } from "../_lib/client-area.js";
import { requireAuthedUser } from "../_lib/auth.js";
import {
  createFileUploadTarget,
  commitSessionFile,
  listSessionFilesForSession,
  softDeleteSessionFile,
  createFileViewUrl,
} from "../_lib/files.js";

/**
 * Session file management for the CRM admin.
 *
 * Gated by requireAuthedUser (SEC-API-001) - every action needs a valid
 * Supabase staff JWT. The file bytes never pass through this function:
 * the browser uploads directly to Supabase via a signed upload URL minted
 * by the 'sign-upload' action, then calls 'commit' to record metadata.
 */
export default async function handler(req, res) {
  try {
    const supabase = getSupabaseAdmin();

    const user = await requireAuthedUser(req, supabase);
    if (!user) {
      return res.status(401).end();
    }

    if (req.method === "GET") {
      const sessionId = req.query?.sessionId || "";
      if (!sessionId) {
        return res.status(400).json({ error: "sessionId is required." });
      }
      const files = await listSessionFilesForSession(supabase, sessionId);
      return res.status(200).json({ files });
    }

    if (req.method === "POST") {
      const body = req.body || {};
      const action = body.action || "";

      if (action === "sign-upload") {
        const target = await createFileUploadTarget(supabase, {
          sessionId: body.sessionId,
          fileName: body.fileName,
          sizeBytes: body.sizeBytes,
        });
        return res.status(200).json(target);
      }

      if (action === "commit") {
        const file = await commitSessionFile(supabase, {
          ...body,
          // Upload attribution comes from the verified staff identity,
          // never from the client payload.
          uploadedBy: user.email || user.id || "",
        });
        return res.status(200).json({ file });
      }

      if (action === "view") {
        const view = await createFileViewUrl(supabase, body.id);
        return res.status(200).json(view);
      }

      return res.status(400).json({ error: "Unknown action." });
    }

    if (req.method === "DELETE") {
      const id = req.query?.id || "";
      if (!id) {
        return res.status(400).json({ error: "A file id is required." });
      }
      const result = await softDeleteSessionFile(supabase, id);
      return res.status(200).json(result);
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Unable to handle session files.",
    });
  }
}
