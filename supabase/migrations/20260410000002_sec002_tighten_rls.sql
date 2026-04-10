-- =============================================================
-- SEC-002: Tighten overly permissive RLS policies
-- Sprint: P1 Security — 2026-04-10
-- =============================================================
-- Context: Hex found "USING (true)" policies on two tables. The "Service role
-- full access" ALL policies with USING (true) grant unrestricted read/write
-- access to ANY authenticated user, not just service_role. In Postgres,
-- service_role bypasses RLS automatically — an explicit USING (true) policy
-- is not only unnecessary but actively dangerous because it also opens the
-- table to every other authenticated role.
--
-- engagement_log — Fix:
--   Drop the ALL/true policy.
--   Keep the anon INSERT (proposal viewer page logs events client-side).
--   Add authenticated SELECT so DT staff can see engagement analytics in CRM.
--   service_role (Edge Functions) continues to work via RLS bypass.
--
-- magic_links — Fix:
--   Drop the ALL/true policy.
--   Drop the anon INSERT policy — magic link tokens must be minted by the
--   backend (service_role) only; allowing anon INSERT would let anyone create
--   valid-looking tokens.
--   Add authenticated SELECT so DT staff can view magic link status in CRM.
--   service_role (Edge Functions) handles all writes via RLS bypass.
-- =============================================================

-- ── engagement_log ────────────────────────────────────────────
-- Remove unrestricted ALL policy
DROP POLICY IF EXISTS "Service role full access on engagement_log" ON public.engagement_log;

-- Authenticated DT staff can read all engagement events
CREATE POLICY "authenticated_select_engagement_log"
  ON public.engagement_log
  FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

-- anon INSERT kept: proposal viewer page logs tracking events directly
-- (existing policy "Anon insert engagement" is retained)

-- ── magic_links ───────────────────────────────────────────────
-- Remove unrestricted ALL policy
DROP POLICY IF EXISTS "Service role full access on magic_links" ON public.magic_links;

-- Remove anon INSERT: tokens must only be created by service_role backend
DROP POLICY IF EXISTS "Anon insert magic_links" ON public.magic_links;

-- Authenticated DT staff can view magic link status (sent, used, expired)
CREATE POLICY "authenticated_select_magic_links"
  ON public.magic_links
  FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);
