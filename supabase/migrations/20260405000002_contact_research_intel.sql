-- Add Research & Intel fields to contacts table
-- Allows Sol's call prep briefs and prospect research to be stored directly on a contact record.

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS research_notes      text,
  ADD COLUMN IF NOT EXISTS research_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS research_source     text,
  ADD COLUMN IF NOT EXISTS research_updated_by text;
