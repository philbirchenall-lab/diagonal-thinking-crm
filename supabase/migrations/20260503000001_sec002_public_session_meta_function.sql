-- =============================================================
-- SEC-002 / Layer C PR 3: Public meta function for pre-auth entry page
-- =============================================================
-- The client-area entry page (/?session=<slug>) needs name, date,
-- session_type, and organisation_name for the heading. Nothing else.
-- This SECURITY DEFINER function exposes ONLY those four safe fields
-- (plus slug for callsite confirmation). The underlying sessions
-- table is locked to authenticated-only by Layer C PR 2.
--
-- Hex spec: outputs/hex-fix-spec-layer-c-rls-2026-04-30.md §4.3.1
-- (function variant — Hex's recommendation over the view variant).
--
-- The function runs as the function owner so it bypasses RLS on
-- sessions + contacts, but ONLY for the explicit projection inside
-- the function. organisation_id is JOINED to contacts and the
-- result projects only contacts.company. resources are not joined.
-- tiptap_json / resource URLs / proposal_code etc are not reachable
-- via this surface.
--
-- session_type resolution mirrors the existing client-side
-- inferSessionType() helper in client-area/src/lib/client-data.ts:
--   1. session_type column if 'in_house' or 'open_event'
--   2. else parse SESSION_STATE_SEPARATOR encoding ('active::open_event')
--   3. else fall back to: organisation_id present => 'in_house',
--      else 'open_event'
-- The COALESCE chain ensures the returned value is always one of
-- 'in_house' or 'open_event', never null.
-- =============================================================

CREATE OR REPLACE FUNCTION public.get_public_session_meta(p_slug text)
  RETURNS TABLE (
    slug text,
    name text,
    date text,
    session_type text,
    organisation_name text
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.slug,
    s.name,
    s.date::text,
    COALESCE(
      CASE WHEN s.session_type IN ('in_house', 'open_event') THEN s.session_type END,
      CASE
        WHEN s.status LIKE 'active::%' THEN split_part(s.status, '::', 2)
        WHEN s.status LIKE 'inactive::%' THEN split_part(s.status, '::', 2)
        ELSE NULL
      END,
      CASE WHEN s.organisation_id IS NOT NULL THEN 'in_house' ELSE 'open_event' END
    ) AS session_type,
    c.company AS organisation_name
  FROM public.sessions s
  LEFT JOIN public.contacts c ON c.id = s.organisation_id
  WHERE s.slug = p_slug
    AND (s.status = 'active' OR s.status LIKE 'active::%')
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_session_meta(text) TO anon, authenticated;
