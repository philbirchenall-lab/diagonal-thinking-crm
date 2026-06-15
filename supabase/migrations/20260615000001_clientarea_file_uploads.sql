-- ============================================================
-- Migration: Client Area secure file uploads (session_files)
-- Run manually in Supabase SQL Editor
-- Created: 2026-06-15
-- Spec: Phil request 15 Jun 2026 - upload PDF/MD/PPTX/DOCX in CRM
--       admin, attendees download in the Client Area alongside the
--       existing URL resources.
-- Branch: rex/clientarea-file-upload-download-2026-06-15
-- ============================================================
-- Design notes
--   Files attach to the SAME entity as URL resources: a session.
--   They live in their OWN table (not `resources`) because
--   saveSessionDetails() in api/_lib/client-area.js DELETEs and
--   re-INSERTs every `resources` row on each session save, which
--   would orphan stored objects and wipe upload attribution.
--
--   Security model. The Client Area authenticates attendees with a
--   custom `dt_client_session` JWT cookie (jose) bound to a single
--   session, and reads via the Supabase service-role key (RLS
--   bypassed). So per-attendee access is enforced at the Vercel
--   endpoint layer (client-area/src/app/api/client/files/[id]),
--   not by RLS. RLS + a private bucket are defense-in-depth:
--     - session_files: authenticated (DT staff in CRM) may SELECT;
--       service_role does every write and the Client Area read.
--     - storage bucket `session-files`: PRIVATE, no anon/authenticated
--       object policies, so only service_role (RLS bypass) and
--       short-lived signed URLs can reach objects.
-- ============================================================

-- ── session_files ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.session_files (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  title         text NOT NULL,
  file_name     text NOT NULL,
  content_type  text,
  size_bytes    bigint,
  storage_path  text NOT NULL UNIQUE,
  sort_order    integer NOT NULL DEFAULT 0,
  uploaded_by   text,              -- DT staff email (upload audit: who)
  created_at    timestamptz NOT NULL DEFAULT now(),  -- upload audit: when
  deleted_at    timestamptz        -- soft delete; persist by default
);

CREATE INDEX IF NOT EXISTS idx_session_files_session_id
  ON public.session_files(session_id);

-- Active (non-deleted) files only, in display order.
CREATE INDEX IF NOT EXISTS idx_session_files_active
  ON public.session_files(session_id, sort_order)
  WHERE deleted_at IS NULL;

-- RLS: mirror sessions/resources (SEC-002, 2 May 2026). Authenticated
-- DT staff read in the CRM; service_role bypasses RLS for all writes
-- and for the Client Area download endpoint. No anon access.
ALTER TABLE public.session_files ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_select_session_files" ON public.session_files;
CREATE POLICY "authenticated_select_session_files"
  ON public.session_files
  FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

-- ── engagement_log.file_id ──────────────────────────────────
-- Download audit. engagement_log already records resource clicks
-- (contact_id, session_id, resource_id, event_type, occurred_at).
-- A nullable file_id lets the Client Area log file downloads
-- (event_type = 'file_download') so they show in the existing CRM
-- attendee engagement view alongside resource clicks.
ALTER TABLE public.engagement_log
  ADD COLUMN IF NOT EXISTS file_id uuid
  REFERENCES public.session_files(id) ON DELETE SET NULL;

-- ── storage bucket: session-files (PRIVATE) ─────────────────
-- public = false -> no /object/public/ URLs; objects reachable only
-- via service_role or a short-lived signed URL. 50MB hard cap at the
-- storage layer. allowed_mime_types left NULL on purpose: .md often
-- uploads with an empty or text/plain MIME type, so the file-type
-- allowlist is enforced by extension in the serverless sign-upload
-- step (api/client/files.js) instead of bouncing legit uploads here.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('session-files', 'session-files', false, 52428800)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit;

-- No storage.objects policies are created for this bucket. With RLS
-- enabled on storage.objects (Supabase default) and no matching
-- anon/authenticated policy, direct object access is denied for those
-- roles. service_role bypasses RLS (CRM upload-url minting + Client
-- Area signed-download minting); signed URLs carry their own token and
-- do not depend on RLS. This is the intended lockdown.
