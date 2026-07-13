-- =============================================================
-- SEC-002 / Layer C: SECURITY DEFINER for proposal-by-code lookup
-- =============================================================
-- The /api/proposals/access POST takes email + code, looks up the proposal
-- by code, then sets a cookie. Today this uses service_role for the read.
-- Layer C wraps the read in a SECURITY DEFINER function so the route can
-- migrate to anon-key for the lookup. Writes (proposal_access insert,
-- contacts upsert) stay on service-role.
-- =============================================================

CREATE OR REPLACE FUNCTION public.get_proposal_by_code(p_code text)
  RETURNS TABLE (
    id uuid,
    slug text,
    proposal_code text,
    client_name text,
    program_title text,
    is_active boolean
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.slug,
    p.proposal_code,
    p.client_name,
    p.program_title,
    p.is_active
  FROM public.proposals p
  WHERE p.proposal_code = trim(p_code)
    AND p.is_active = true
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_proposal_by_code(text) TO anon, authenticated;
