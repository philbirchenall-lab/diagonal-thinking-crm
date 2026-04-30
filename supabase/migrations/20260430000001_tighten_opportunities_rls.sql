-- ============================================================
-- Migration: SEC-SUP-001 — tighten opportunities RLS
-- Run manually in Supabase SQL Editor
-- Created: 2026-04-30
-- Register: wiki/security/risk-register-2026-04-30.md#sup-001
-- ============================================================
--
-- Context
-- -------
-- The original opportunities migration (20260410000001_opportunities.sql,
-- lines 44-52) shipped with the policy:
--
--   CREATE POLICY "Authenticated users have full access to opportunities"
--     ON opportunities FOR ALL TO authenticated
--     USING (true) WITH CHECK (true);
--
-- USING(true) for any authenticated principal is functionally
-- equivalent to no row-level security: anyone with a valid Supabase
-- session (anon-key plus auth) could read/write the entire revenue
-- pipeline. Hex flagged this as SUP-001 (P1) on the 30 Apr 2026 risk
-- register and as SEC-005 on the standing open list.
--
-- Decision: Option 2 (smallest blast radius)
-- ------------------------------------------
-- The opportunities table has no ownership column today
-- (no owner_id, created_by, user_id, or auth.users FK — see schema
-- in 20260410000001_opportunities.sql lines 8-22). Without an
-- ownership column there is no per-row check available, so we
-- tighten to service-role-only.
--
-- After this migration:
--   * Anon-key + authenticated session       -> RLS denies all access.
--   * Master database key (service_role)     -> bypasses RLS, unchanged.
--
-- The CRM API routes under api/opportunities/* all use the master
-- database key, so they continue to work without modification.
-- The structural Layer C migration (Hex spec, pickup 2026-05-06)
-- will move API routes onto the anon key with proper row-level
-- security and replace this policy with the single-tenant
-- "any authenticated DT staff can read all" pattern. This migration
-- is the immediate hardening on the table itself; Layer C PR 5 is
-- the longer-term fix and will supersede this policy when it ships.
--
-- ============================================================

-- Ensure RLS is enabled (idempotent; the original migration already
-- enabled it, but keep this for safety on re-run)
ALTER TABLE public.opportunities ENABLE ROW LEVEL SECURITY;

-- Drop the over-permissive USING(true) policy from 10 Apr
DROP POLICY IF EXISTS "Authenticated users have full access to opportunities" ON public.opportunities;

-- Drop any other historical names that might exist (idempotent;
-- nothing happens if they don't exist)
DROP POLICY IF EXISTS "opportunities_select_all" ON public.opportunities;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.opportunities;
DROP POLICY IF EXISTS "Service role full access on opportunities" ON public.opportunities;

-- Tightened replacement: service_role only.
-- service_role bypasses RLS by default, so this policy is mostly
-- a defense-in-depth statement of intent. We also explicitly deny
-- all other roles by NOT creating any other policy on this table.
-- With RLS enabled and no permissive policy for anon/authenticated,
-- both roles get zero rows on every operation.
CREATE POLICY "service_role_full_access_opportunities"
  ON public.opportunities
  FOR ALL
  TO service_role
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Note: no policy is created for the anon or authenticated roles.
-- With RLS enabled and no permissive policy, those roles cannot
-- read, insert, update, or delete any row. This is the intended
-- behaviour until Layer C ships.
