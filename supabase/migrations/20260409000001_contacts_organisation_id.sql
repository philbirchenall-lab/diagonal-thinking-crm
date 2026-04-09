-- CA-BUG-005: Add organisation_id to contacts
-- Links a registered attendee to the host organisation for their session.
-- Nullable — existing contacts are unaffected.

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS organisation_id UUID REFERENCES contacts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS contacts_organisation_id_idx ON contacts (organisation_id);
