-- =============================================================
-- SEC-002 / Layer C: Tighten RLS on proposals + proposal_access
-- =============================================================
-- Context: dt-proposals admin reads via service_role, which bypasses RLS.
-- A tight RLS policy is defence-in-depth: any future call path that
-- accidentally uses anon-key gets zero rows.
--
-- Pattern matches SEC-001 (enquiries) and SEC-002 10-Apr (engagement_log,
-- magic_links): drop any USING(true) ALL policies, add explicit
-- authenticated SELECT for DT staff, anon gets nothing for proposals.
-- =============================================================

ALTER TABLE public.proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proposal_access ENABLE ROW LEVEL SECURITY;

-- Drop any pre-existing permissive policies (idempotent)
DROP POLICY IF EXISTS "Service role full access on proposals" ON public.proposals;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.proposals;
DROP POLICY IF EXISTS "Service role full access on proposal_access" ON public.proposal_access;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.proposal_access;

-- proposals: authenticated DT staff can read all (CRM dashboard use case)
CREATE POLICY "authenticated_select_proposals"
  ON public.proposals
  FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

-- proposals: NO anon SELECT, NO anon INSERT/UPDATE/DELETE
-- service_role bypasses RLS for admin writes; no explicit policy needed.

-- proposal_access: authenticated DT staff can read access events (analytics)
CREATE POLICY "authenticated_select_proposal_access"
  ON public.proposal_access
  FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

-- proposal_access: NO anon access. The /api/proposals/access POST that
-- inserts a row uses service_role, which bypasses RLS.
