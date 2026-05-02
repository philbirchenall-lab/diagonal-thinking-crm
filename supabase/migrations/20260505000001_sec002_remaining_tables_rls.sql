-- =============================================================
-- SEC-002 / Layer C PR 5: Remaining tables — contacts,
-- opportunities (SEC-005 closure), contact_activities
-- =============================================================
-- Final pass to ensure every table touched by either app has explicit
-- RLS that returns zero rows for anon. SEC-005 (opportunities USING(true))
-- is closed in this same PR per Hex's standing rule that USING(true) is
-- nearly as bad as no RLS.
--
-- This migration also supersedes the interim PR #54 policy
-- ("service_role_full_access_opportunities") that was the immediate
-- stop-gap on opportunities while the API routes had no auth path.
-- After Phase A's API-004 PR #50 lands the admin_session cookie check,
-- "authenticated" is the right scope for the CRM dashboard, matching
-- the rest of the public schema.
-- =============================================================

-- ── contacts ──────────────────────────────────────────────────
-- Already may have policies; ensure authenticated SELECT is the only
-- path, anon gets nothing direct.
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access on contacts" ON public.contacts;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.contacts;

CREATE POLICY "authenticated_select_contacts"
  ON public.contacts
  FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

-- ── opportunities ─────────────────────────────────────────────
-- SEC-005 fix — drop USING(true), tighten to authenticated.
-- Also supersedes PR #54's service-role-only stop-gap.
ALTER TABLE public.opportunities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access on opportunities" ON public.opportunities;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.opportunities;
-- Drop any USING(true) variant (Hex 16 Apr finding)
DROP POLICY IF EXISTS "opportunities_select_all" ON public.opportunities;
-- Drop the original 10 Apr USING(true) policy by its exact name
DROP POLICY IF EXISTS "Authenticated users have full access to opportunities" ON public.opportunities;
-- Drop PR #54's service-role-only stop-gap policy (this PR supersedes it)
DROP POLICY IF EXISTS "service_role_full_access_opportunities" ON public.opportunities;

CREATE POLICY "authenticated_select_opportunities"
  ON public.opportunities
  FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

-- ── contact_activities ────────────────────────────────────────
-- Same pattern.
ALTER TABLE public.contact_activities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access on contact_activities" ON public.contact_activities;

CREATE POLICY "authenticated_select_contact_activities"
  ON public.contact_activities
  FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

-- Verify (informational, no migration effect): list every public table
-- and confirm RLS is enabled. If any unexpected table shows
-- rls_enabled = false, file a finding for the next sweep.
-- SELECT schemaname, tablename, rowsecurity
-- FROM pg_tables
-- WHERE schemaname = 'public'
-- ORDER BY tablename;
