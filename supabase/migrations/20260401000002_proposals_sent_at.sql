-- ============================================================
-- Migration: add sent_at and reply_received to proposals
-- Run manually in Supabase SQL Editor
-- Created: 2026-04-01
-- ============================================================

ALTER TABLE proposals
  ADD COLUMN IF NOT EXISTS sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS reply_received boolean NOT NULL DEFAULT false;

-- Backfill: use created_at as proxy for proposals with no sent_at
-- (PROP-005 will set sent_at = now() when proposal email is actually sent)
UPDATE proposals SET sent_at = created_at WHERE sent_at IS NULL;
