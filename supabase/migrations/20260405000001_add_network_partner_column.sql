-- Add network_partner column to contacts table.
-- This column was referenced in code (CRM-004) but never tracked in a migration.
-- IF NOT EXISTS makes this safe to run even if it was already added manually in the dashboard.

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS network_partner BOOLEAN DEFAULT FALSE;
