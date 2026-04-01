-- ============================================================
-- Migration: contact_activities table
-- Run manually in Supabase SQL Editor
-- Created: 2026-04-01
-- ============================================================

CREATE TABLE IF NOT EXISTS contact_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid REFERENCES contacts(id) ON DELETE CASCADE,
  proposal_id uuid REFERENCES proposals(id) ON DELETE SET NULL,
  activity_type text NOT NULL, -- 'email_sent' | 'linkedin_draft' | 'email_received' | 'note'
  activity_subtype text,       -- 'nudge_4day' | 'chase_5day' | 'linkedin_7day' (for dedup)
  subject text,
  body text,
  status text NOT NULL DEFAULT 'sent', -- 'sent' | 'pending' | 'received'
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contact_activities_contact_id ON contact_activities(contact_id);
CREATE INDEX IF NOT EXISTS idx_contact_activities_proposal_id ON contact_activities(proposal_id);
