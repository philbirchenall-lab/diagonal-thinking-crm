-- Add organisation_id to contacts (applied earlier today, pulled from remote)
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS organisation_id UUID REFERENCES contacts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS contacts_organisation_id_idx ON contacts (organisation_id);
