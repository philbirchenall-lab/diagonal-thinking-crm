/**
 * files.js - session file helpers for the CRM admin API.
 *
 * Files attach to a session (same entity as URL resources) but live in
 * the `session_files` table. Privileged operations run with the
 * service-role client passed in by the route, mirroring client-area.js.
 *
 * Upload flow (avoids Vercel's ~4.5MB function body limit on 50MB files):
 *   1. createFileUploadTarget() -> service_role mints a signed UPLOAD url.
 *   2. The browser uploads bytes DIRECTLY to Supabase Storage with the
 *      returned token (see db.js uploadSessionFile).
 *   3. commitSessionFile() -> service_role records the metadata row.
 *
 * The file-type allowlist is enforced here by extension because .md
 * files frequently arrive with an empty or text/plain MIME type.
 */
import crypto from "node:crypto";

export const FILES_BUCKET = "session-files";
export const MAX_FILE_BYTES = 52428800; // 50 MB

// extension -> canonical content type stored with the object
export const ALLOWED_FILE_TYPES = {
  pdf: "application/pdf",
  md: "text/markdown",
  markdown: "text/markdown",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export const ALLOWED_EXTENSIONS_LABEL = "PDF, MD, PPTX, DOCX";

function getExtension(fileName) {
  const clean = String(fileName || "").trim().toLowerCase();
  const dot = clean.lastIndexOf(".");
  return dot >= 0 ? clean.slice(dot + 1) : "";
}

/**
 * Validate a proposed upload. Returns { ext, contentType } or throws a
 * message safe to surface to the admin user.
 */
export function validateUpload({ fileName, sizeBytes }) {
  const ext = getExtension(fileName);
  if (!ext || !Object.prototype.hasOwnProperty.call(ALLOWED_FILE_TYPES, ext)) {
    throw new Error(`Unsupported file type. Allowed: ${ALLOWED_EXTENSIONS_LABEL}.`);
  }

  const size = Number(sizeBytes);
  if (Number.isFinite(size) && size > MAX_FILE_BYTES) {
    throw new Error("File is too large. The limit is 50 MB.");
  }

  return { ext, contentType: ALLOWED_FILE_TYPES[ext] };
}

function mapFileRow(row) {
  return {
    id: row.id,
    sessionId: row.session_id,
    title: row.title || row.file_name || "File",
    fileName: row.file_name || "",
    contentType: row.content_type || "",
    sizeBytes: row.size_bytes ?? null,
    sortOrder: row.sort_order ?? 0,
    uploadedBy: row.uploaded_by || "",
    createdAt: row.created_at || "",
  };
}

/**
 * Mint a signed upload URL for a new session file. The object key is
 * session-scoped and randomised so file names never collide or leak.
 */
export async function createFileUploadTarget(supabase, { sessionId, fileName, sizeBytes }) {
  if (!sessionId) {
    throw new Error("A session is required before uploading files.");
  }

  const { ext, contentType } = validateUpload({ fileName, sizeBytes });

  // Confirm the session exists so we never strand objects under a bogus id.
  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .select("id")
    .eq("id", sessionId)
    .maybeSingle();

  if (sessionError) {
    throw new Error(sessionError.message);
  }
  if (!session) {
    throw new Error("Session not found.");
  }

  const storagePath = `${sessionId}/${crypto.randomUUID()}.${ext}`;

  const { data, error } = await supabase.storage
    .from(FILES_BUCKET)
    .createSignedUploadUrl(storagePath);

  if (error) {
    throw new Error(error.message);
  }

  return {
    storagePath,
    token: data.token,
    contentType,
  };
}

/**
 * Record the metadata row after the browser has uploaded the object.
 */
export async function commitSessionFile(supabase, payload) {
  const sessionId = payload.sessionId;
  const storagePath = String(payload.storagePath || "").trim();
  const fileName = String(payload.fileName || "").trim();
  const title = String(payload.title || "").trim() || fileName;

  if (!sessionId || !storagePath || !fileName) {
    throw new Error("Missing file details.");
  }

  // Re-validate so a tampered commit cannot bypass the allowlist.
  const { contentType } = validateUpload({ fileName, sizeBytes: payload.sizeBytes });

  // Object key must sit under the claimed session to prevent cross-session writes.
  if (!storagePath.startsWith(`${sessionId}/`)) {
    throw new Error("File path does not match the session.");
  }

  const { data: maxRow } = await supabase
    .from("session_files")
    .select("sort_order")
    .eq("session_id", sessionId)
    .is("deleted_at", null)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextSortOrder = Number(maxRow?.sort_order ?? -1) + 1;

  const { data, error } = await supabase
    .from("session_files")
    .insert({
      session_id: sessionId,
      title,
      file_name: fileName,
      content_type: payload.contentType || contentType,
      size_bytes: Number.isFinite(Number(payload.sizeBytes)) ? Number(payload.sizeBytes) : null,
      storage_path: storagePath,
      sort_order: nextSortOrder,
      uploaded_by: String(payload.uploadedBy || "").trim() || null,
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return mapFileRow(data);
}

export async function listSessionFilesForSession(supabase, sessionId) {
  if (!sessionId) return [];

  const { data, error } = await supabase
    .from("session_files")
    .select("*")
    .eq("session_id", sessionId)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data || []).map(mapFileRow);
}

/**
 * Active files for many sessions at once (used by listSessionDetails).
 */
export async function fetchFilesBySession(supabase, sessionIds) {
  if (!sessionIds.length) return [];

  const { data, error } = await supabase
    .from("session_files")
    .select("*")
    .in("session_id", sessionIds)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data || []).map(mapFileRow);
}

/**
 * Soft delete - keeps the stored object (retention: persist by default)
 * but hides the file from admin and attendee views.
 */
export async function softDeleteSessionFile(supabase, fileId) {
  if (!fileId) {
    throw new Error("A file id is required.");
  }

  const { error } = await supabase
    .from("session_files")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", fileId)
    .is("deleted_at", null);

  if (error) {
    throw new Error(error.message);
  }

  return { id: fileId };
}

/**
 * Short-lived signed URL so DT staff can open an uploaded file from the
 * CRM to confirm it. 5 minute window, same as the attendee endpoint.
 */
export async function createFileViewUrl(supabase, fileId) {
  if (!fileId) {
    throw new Error("A file id is required.");
  }

  const { data: file, error } = await supabase
    .from("session_files")
    .select("storage_path, file_name, deleted_at")
    .eq("id", fileId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!file || file.deleted_at) {
    throw new Error("File not found.");
  }

  const { data: signed, error: signError } = await supabase.storage
    .from(FILES_BUCKET)
    .createSignedUrl(file.storage_path, 300, { download: file.file_name });

  if (signError) {
    throw new Error(signError.message);
  }

  return { url: signed.signedUrl };
}
