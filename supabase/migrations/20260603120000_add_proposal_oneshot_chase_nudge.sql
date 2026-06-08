-- =============================================================
-- PROP-011 / PROP-013 one-shot follow-up bookkeeping
-- =============================================================
-- Context: the proposal follow-up cron (api/proposal-followup-cron.js) is
-- being rebuilt so that each proposal gets AT MOST one nudge and AT MOST one
-- chase, total, and never re-fires. This migration adds the two one-shot
-- marker columns the rebuilt cron writes after a successful send.
--
--   nudged_at  : timestamp of the single allowed PROP-011 nudge. NULL = never nudged.
--   chased_at  : timestamp of the single allowed PROP-013 chase. NULL = never chased.
--
-- Both are set once by the cron and never cleared by automation.
--
-- Backfill: the chase has already fired historically (logged in
-- contact_activities as activity_subtype = 'chase_5day'). We backfill chased_at
-- from the EARLIEST such activity per proposal so the five already-chased
-- proposals can never be chased again by the rebuilt cron. nudged_at is
-- backfilled the same way from 'nudge_4day' for completeness (none exist yet).
-- =============================================================

ALTER TABLE public.proposals ADD COLUMN IF NOT EXISTS nudged_at timestamptz;
ALTER TABLE public.proposals ADD COLUMN IF NOT EXISTS chased_at timestamptz;

COMMENT ON COLUMN public.proposals.nudged_at IS
  'Timestamp of the single allowed PROP-011 nudge. NULL means never nudged. Set once, never cleared by automation.';
COMMENT ON COLUMN public.proposals.chased_at IS
  'Timestamp of the single allowed PROP-013 chase. NULL means never chased. Set once, never cleared by automation.';

-- Backfill chased_at from the earliest historical chase activity per proposal.
UPDATE public.proposals p
SET chased_at = ca.first_event
FROM (
  SELECT proposal_id, MIN(created_at) AS first_event
  FROM public.contact_activities
  WHERE activity_subtype = 'chase_5day'
    AND proposal_id IS NOT NULL
  GROUP BY proposal_id
) ca
WHERE p.id = ca.proposal_id
  AND p.chased_at IS NULL;

-- Backfill nudged_at from the earliest historical nudge activity per proposal.
UPDATE public.proposals p
SET nudged_at = ca.first_event
FROM (
  SELECT proposal_id, MIN(created_at) AS first_event
  FROM public.contact_activities
  WHERE activity_subtype = 'nudge_4day'
    AND proposal_id IS NOT NULL
  GROUP BY proposal_id
) ca
WHERE p.id = ca.proposal_id
  AND p.nudged_at IS NULL;
