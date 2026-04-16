-- =============================================================
-- SEC-003: Fix mutable search_path on append_proposal_read
-- Sprint: P1 Security — 2026-04-10
-- =============================================================
-- Context: Hex flagged append_proposal_read as having a mutable search_path.
-- Without SET search_path = public, a malicious (or compromised) authenticated
-- user could CREATE a schema earlier in the search path and place shadow
-- objects (e.g. a contacts table with a trigger) that would be resolved
-- instead of the real public.contacts, enabling SQL injection via schema
-- manipulation.
--
-- Fix: add SET search_path = public to the function definition. The body
-- is otherwise unchanged from the existing production function.
-- =============================================================

CREATE OR REPLACE FUNCTION public.append_proposal_read(
  contact_email text,
  proposal_slug text
)
  RETURNS void
  LANGUAGE plpgsql
  SET search_path = public
AS $function$
BEGIN
  UPDATE contacts
  SET proposals_read = array_append(
    COALESCE(proposals_read, '{}'),
    proposal_slug
  )
  WHERE email = contact_email
    AND NOT (proposal_slug = ANY(COALESCE(proposals_read, '{}')));
END;
$function$;
