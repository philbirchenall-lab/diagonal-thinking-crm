-- Diagonal Thinking CRM — Supabase Schema
-- Run this in the Supabase SQL Editor (supabase.com → your project → SQL Editor)

-- ─── Contacts table ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS contacts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company       TEXT,
  contact_name  TEXT,
  email         TEXT,
  phone         TEXT,
  type          TEXT DEFAULT 'Warm Lead',
  services      TEXT[] DEFAULT '{}',
  projected_value NUMERIC DEFAULT 0,
  notes         TEXT,
  source        TEXT,
  date_added    TEXT,   -- stored as YYYY-MM-DD string to match existing JSON format
  last_updated  TEXT,   -- stored as YYYY-MM-DD string
  linkedin_url  TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Row Level Security ───────────────────────────────────────────────────────
-- Only authenticated users can read or write contacts.
-- Since this is a single-user CRM, all authenticated users have full access.

ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users have full access"
  ON contacts
  FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- ─── Indexes ──────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS contacts_company_idx ON contacts (company);
CREATE INDEX IF NOT EXISTS contacts_type_idx ON contacts (type);
CREATE INDEX IF NOT EXISTS contacts_email_idx ON contacts (email);
