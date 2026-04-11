-- ============================================================
-- Migration: opportunities table
-- Run manually in Supabase SQL Editor
-- Created: 2026-04-10
-- Spec: tes-scope-opportunities.md
-- ============================================================

CREATE TABLE IF NOT EXISTS opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  value numeric DEFAULT 0,
  stage text NOT NULL DEFAULT 'Identified',
  services text[] DEFAULT '{}',
  close_date date,
  proposal_id uuid REFERENCES proposals(id) ON DELETE SET NULL,
  notes text,
  won_at timestamptz,           -- Set when stage transitions to Won; not overwritten on subsequent edits
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_opportunities_contact_id ON opportunities(contact_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_stage ON opportunities(stage);

-- Auto-update updated_at on row modification.
-- Using CREATE OR REPLACE so re-running this migration is safe.
CREATE OR REPLACE FUNCTION set_opportunities_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Drop trigger first so re-runs are idempotent
DROP TRIGGER IF EXISTS opportunities_updated_at ON opportunities;
CREATE TRIGGER opportunities_updated_at
  BEFORE UPDATE ON opportunities
  FOR EACH ROW EXECUTE PROCEDURE set_opportunities_updated_at();

-- RLS: authenticated users have full access (same pattern as contacts table)
ALTER TABLE opportunities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users have full access to opportunities" ON opportunities;
CREATE POLICY "Authenticated users have full access to opportunities"
  ON opportunities
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Service role (used by API routes) bypasses RLS by default — no additional policy needed.
