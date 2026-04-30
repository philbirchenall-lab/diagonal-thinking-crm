-- =============================================================
-- SEC-002 / Layer C: Tighten RLS on sessions + resources
-- =============================================================
-- sessions: full session record contains organisation_id, resource list,
-- session_type — sensitive enough to lock to authenticated only.
-- The pre-auth client-area entry page reads via the public_session_meta
-- view (PR 3), not direct table SELECT.
-- =============================================================

ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on sessions" ON public.sessions;
DROP POLICY IF EXISTS "Service role full access on resources" ON public.resources;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.sessions;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.resources;

-- sessions: authenticated DT staff (CRM)
CREATE POLICY "authenticated_select_sessions"
  ON public.sessions
  FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

-- resources: authenticated DT staff (CRM)
CREATE POLICY "authenticated_select_resources"
  ON public.resources
  FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

-- No anon policies. Pre-auth reads go through public_session_meta view.
