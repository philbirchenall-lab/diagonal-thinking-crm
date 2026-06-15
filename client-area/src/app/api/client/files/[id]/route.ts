import { NextRequest, NextResponse } from "next/server";
import { readSessionCookie } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const FILES_BUCKET = "session-files";
const SIGNED_URL_TTL_SECONDS = 300; // 5 minutes

/**
 * Attendee file download.
 *
 * Auth is enforced here, NOT by RLS: attendees have no Supabase identity,
 * only the `dt_client_session` JWT cookie (bound to a single session). We
 *   1. require a valid cookie (else 401),
 *   2. confirm the file belongs to the cookie's session (else 403/404),
 *   3. log the download to engagement_log,
 *   4. mint a short-lived Supabase signed URL and redirect to it.
 * The storage bucket is private, so the signed URL is the only way in and
 * it expires in 5 minutes.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await readSessionCookie(request.cookies);

  if (!session?.sessionId) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  }

  const { id } = await params;
  const supabase = createServiceClient();

  const { data: file, error } = await supabase
    .from("session_files")
    .select("id, session_id, storage_path, file_name, deleted_at")
    .eq("id", id)
    .maybeSingle();

  if (error || !file || file.deleted_at) {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }

  // Cross-session guard: an attendee may only reach files for their own
  // session. A different engagement's file id returns 403.
  if (file.session_id !== session.sessionId) {
    return NextResponse.json({ error: "Not found." }, { status: 403 });
  }

  // Download audit (best effort - never block the download).
  try {
    await supabase.from("engagement_log").insert({
      contact_id: session.contactId,
      session_id: session.sessionId,
      file_id: file.id,
      event_type: "file_download",
      occurred_at: new Date().toISOString(),
    });
  } catch {
    // Logging failures must not stop the attendee getting their file.
  }

  const { data: signed, error: signError } = await supabase.storage
    .from(FILES_BUCKET)
    .createSignedUrl(file.storage_path, SIGNED_URL_TTL_SECONDS, {
      download: file.file_name,
    });

  if (signError || !signed?.signedUrl) {
    return NextResponse.json(
      { error: "Could not prepare the download." },
      { status: 500 },
    );
  }

  const response = NextResponse.redirect(signed.signedUrl, 302);
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}
