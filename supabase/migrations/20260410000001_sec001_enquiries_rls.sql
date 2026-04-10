-- =============================================================
-- SEC-001: Add missing RLS policies for enquiries table
-- Sprint: P1 Security — 2026-04-10
-- =============================================================
-- Context: Hex security sweep (2026-04-08) flagged enquiries as having
-- RLS disabled. A 9 Apr sprint enabled RLS on enquiries but did NOT add
-- any policies, leaving the table fully locked (zero access for all roles).
-- proposals, proposal_access, and contact_activities already have working
-- policies from the 9 Apr sprint and are not modified here.
--
-- Policy design:
--   anon    → INSERT only (Squarespace contact form → /contact-form Edge Fn
--             calls Supabase directly; the fn uses service_role, but we also
--             allow anon INSERT as a defence-in-depth fallback)
--   authenticated → SELECT (DT staff review enquiries in the CRM dashboard)
--   service_role  → bypasses RLS automatically; no explicit policy needed
-- =============================================================

-- Anon users can submit contact form enquiries
CREATE POLICY "anon_insert_enquiries"
  ON public.enquiries
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- Authenticated staff (DT team) can read all enquiries in the CRM
CREATE POLICY "authenticated_select_enquiries"
  ON public.enquiries
  FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);
