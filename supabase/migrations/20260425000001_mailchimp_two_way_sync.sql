-- ============================================================
-- Migration: MAIL-SYNC-001 Mailchimp two-way sync
-- Spec: wiki/strategy/specs/mailchimp-crm-two-way-sync-2026-04-25.md
-- Filed by: Tes (validation), built by: Rex (engineering)
-- Created: 2026-04-25
--
-- Adds 13 net-new columns to public.contacts (12 engagement fields
-- per spec section 4.1 plus mailchimp_tags per spec section 6.2)
-- and the new public.email_engagement_log table per spec section 4.2.
--
-- All 12 engagement fields are nullable except email_marketing_opt_in
-- which defaults true so existing 417 contacts are not accidentally
-- opted out at migration time. The 90-day backfill script (filed
-- alongside this migration) corrects them down from Mailchimp truth
-- in the same deploy window.
--
-- Standing rules respected:
--   - Pre-creation duplicate-check rule binds the inbound webhook
--     upemail handler that writes to these columns (handler code,
--     not migration concern).
--   - Client status NEVER downgraded by sync logic (the type column
--     is untouched here; opt-in is independent of type).
--   - Mailchimp opt-out is GROUND TRUTH for marketing opt-in.
--   - Phil verbal confirmations override stale CRM (handled at the
--     manual-override UI layer, source value crm_manual_override).
--
-- Rollback plan: the DOWN block at the bottom of this file drops
-- the 13 columns and the new table. Safe to re-run because every
-- statement uses IF EXISTS / IF NOT EXISTS.
-- ============================================================

-- ─── public.contacts: 13 net-new columns ────────────────────

-- Opt-in state quartet (the four fields that together form the
-- ICO-acceptable opt-in evidence trail per spec section 11).
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS email_marketing_opt_in boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS email_marketing_opt_in_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS email_marketing_opt_in_source text,
  ADD COLUMN IF NOT EXISTS email_marketing_opt_in_reason text;

-- Engagement signal columns populated by the daily polling task and
-- by the inbound webhook for opt-in flips.
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS email_engagement_score smallint,
  ADD COLUMN IF NOT EXISTS email_last_open_at timestamptz,
  ADD COLUMN IF NOT EXISTS email_last_click_at timestamptz,
  ADD COLUMN IF NOT EXISTS email_opens_30d smallint DEFAULT 0,
  ADD COLUMN IF NOT EXISTS email_clicks_30d smallint DEFAULT 0,
  ADD COLUMN IF NOT EXISTS email_bounce_status text,
  ADD COLUMN IF NOT EXISTS email_bounce_last_at timestamptz,
  ADD COLUMN IF NOT EXISTS email_engagement_tier text;

-- Mailchimp tags mirrored into the CRM contact row (spec section 6.2).
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS mailchimp_tags text[] DEFAULT '{}';

-- ─── CHECK constraints ──────────────────────────────────────
-- Each constraint wrapped in DO block so re-runs do not error if
-- the constraint already exists (CREATE CONSTRAINT has no IF NOT EXISTS).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contacts_email_marketing_opt_in_source_chk'
  ) THEN
    ALTER TABLE public.contacts
      ADD CONSTRAINT contacts_email_marketing_opt_in_source_chk
      CHECK (
        email_marketing_opt_in_source IS NULL
        OR email_marketing_opt_in_source IN ('mailchimp_webhook', 'crm_manual_override', 'initial_backfill')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contacts_email_engagement_score_chk'
  ) THEN
    ALTER TABLE public.contacts
      ADD CONSTRAINT contacts_email_engagement_score_chk
      CHECK (
        email_engagement_score IS NULL
        OR (email_engagement_score >= 1 AND email_engagement_score <= 5)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contacts_email_bounce_status_chk'
  ) THEN
    ALTER TABLE public.contacts
      ADD CONSTRAINT contacts_email_bounce_status_chk
      CHECK (
        email_bounce_status IS NULL
        OR email_bounce_status IN ('none', 'soft', 'hard')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contacts_email_engagement_tier_chk'
  ) THEN
    ALTER TABLE public.contacts
      ADD CONSTRAINT contacts_email_engagement_tier_chk
      CHECK (
        email_engagement_tier IS NULL
        OR email_engagement_tier IN ('engaged', 'neutral', 'cooling', 'cold')
      );
  END IF;
END $$;

-- ─── Helpful index for the outbound sync guard ──────────────
-- Outbound mailchimp-sync reads email_marketing_opt_in on every PUT
-- to short-circuit opted-out contacts. Partial index keeps it tight.
CREATE INDEX IF NOT EXISTS idx_contacts_email_marketing_opt_in_false
  ON public.contacts (id)
  WHERE email_marketing_opt_in = false;

-- ─── public.email_engagement_log ────────────────────────────
-- Thin write-only audit table. Computed fields on contacts are
-- derived from this. If the computation ever changes the recompute
-- runs from this table without re-pulling from Mailchimp.

CREATE TABLE IF NOT EXISTS public.email_engagement_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid REFERENCES public.contacts(id) ON DELETE CASCADE,
  mailchimp_campaign_id text NOT NULL,
  mailchimp_campaign_title text,
  event_type text NOT NULL,
  event_url text,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Idempotency key for the backfill and polling tasks. A single
-- (contact, campaign, event_type, occurred_at) tuple should only
-- ever exist once. This makes both the 90-day backfill and every
-- subsequent polling-task run safe to re-run.
CREATE UNIQUE INDEX IF NOT EXISTS uq_email_engagement_log_idempotency
  ON public.email_engagement_log (contact_id, mailchimp_campaign_id, event_type, occurred_at);

-- Read-path indexes per spec section 4.2.
CREATE INDEX IF NOT EXISTS idx_email_engagement_log_contact_time
  ON public.email_engagement_log (contact_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_engagement_log_campaign
  ON public.email_engagement_log (mailchimp_campaign_id);

CREATE INDEX IF NOT EXISTS idx_email_engagement_log_event_time
  ON public.email_engagement_log (event_type, occurred_at DESC);

-- event_type whitelist matches spec section 4.2 enum.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'email_engagement_log_event_type_chk'
  ) THEN
    ALTER TABLE public.email_engagement_log
      ADD CONSTRAINT email_engagement_log_event_type_chk
      CHECK (event_type IN ('sent', 'open', 'click', 'bounce_soft', 'bounce_hard', 'unsubscribe', 'complaint'));
  END IF;
END $$;

-- ─── RLS posture ────────────────────────────────────────────
-- email_engagement_log is server-side write only. No client RLS
-- policies. Service-role writes only (webhook handler, polling
-- task, backfill script). Reads via Supabase SQL editor or the
-- contact-detail panel, which uses the service role on the server.
ALTER TABLE public.email_engagement_log ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'email_engagement_log' AND policyname = 'service_role_all'
  ) THEN
    CREATE POLICY service_role_all ON public.email_engagement_log
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- ─── public.imessage_outbox ─────────────────────────────────
-- Vercel serverless cannot call osascript, so server-side senders
-- queue iMessage requests here. A Mac-side relay (Oz scheduled task
-- on Phil machine) polls pending rows, runs osascript to deliver
-- via Messages.app, marks status=sent (or failed with last_error).
-- Wiring the relay is a follow-up task; until then the api/_lib/imessage.js
-- helper falls back to console.warn so Phil still sees the notification
-- in Vercel logs.

CREATE TABLE IF NOT EXISTS public.imessage_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient text NOT NULL,
  body text NOT NULL,
  event_kind text,
  source text,
  status text NOT NULL DEFAULT 'pending',
  attempts smallint NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_imessage_outbox_status_created
  ON public.imessage_outbox (status, created_at)
  WHERE status = 'pending';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'imessage_outbox_status_chk'
  ) THEN
    ALTER TABLE public.imessage_outbox
      ADD CONSTRAINT imessage_outbox_status_chk
      CHECK (status IN ('pending', 'sent', 'failed', 'skipped'));
  END IF;
END $$;

ALTER TABLE public.imessage_outbox ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'imessage_outbox' AND policyname = 'service_role_all'
  ) THEN
    CREATE POLICY service_role_all ON public.imessage_outbox
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- ─── DOWN (rollback) ────────────────────────────────────────
-- To roll this migration back, run the following block manually
-- in the Supabase SQL editor. Not run automatically.
--
-- BEGIN;
--   DROP TABLE IF EXISTS public.imessage_outbox;
--   DROP TABLE IF EXISTS public.email_engagement_log;
--   DROP INDEX IF EXISTS public.idx_contacts_email_marketing_opt_in_false;
--   ALTER TABLE public.contacts
--     DROP CONSTRAINT IF EXISTS contacts_email_marketing_opt_in_source_chk,
--     DROP CONSTRAINT IF EXISTS contacts_email_engagement_score_chk,
--     DROP CONSTRAINT IF EXISTS contacts_email_bounce_status_chk,
--     DROP CONSTRAINT IF EXISTS contacts_email_engagement_tier_chk,
--     DROP COLUMN IF EXISTS mailchimp_tags,
--     DROP COLUMN IF EXISTS email_engagement_tier,
--     DROP COLUMN IF EXISTS email_bounce_last_at,
--     DROP COLUMN IF EXISTS email_bounce_status,
--     DROP COLUMN IF EXISTS email_clicks_30d,
--     DROP COLUMN IF EXISTS email_opens_30d,
--     DROP COLUMN IF EXISTS email_last_click_at,
--     DROP COLUMN IF EXISTS email_last_open_at,
--     DROP COLUMN IF EXISTS email_engagement_score,
--     DROP COLUMN IF EXISTS email_marketing_opt_in_reason,
--     DROP COLUMN IF EXISTS email_marketing_opt_in_source,
--     DROP COLUMN IF EXISTS email_marketing_opt_in_changed_at,
--     DROP COLUMN IF EXISTS email_marketing_opt_in;
-- COMMIT;
--
-- Note: dropping email_marketing_opt_in last because if a partial
-- rollback ever leaves the column in place, the outbound guard
-- still has a value to read (true by default = no harm done).
