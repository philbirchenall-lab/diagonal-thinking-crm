-- Add an explicit session_type column to the Client Area sessions table.
--
-- Background: session type (in_house vs open_event) was previously NOT persisted.
-- It only round-tripped because saving an Open Event forced organisation_id = NULL
-- and inferSessionType() derived the type from organisation_id presence. That is
-- fragile: setting an org on an Open Event (or clearing it on an in-house session)
-- silently flips the type, which mis-categorises Client Area registrants between
-- Client and Mailing List (see PR #81). This makes the type a first-class field.
--
-- Apply manually via the Supabase SQL Editor (this project has no migration runner;
-- see TECHNICAL-SPEC.md F-10). Idempotent — safe to re-run.

-- 1. Add the column (nullable for now so the backfill can populate it).
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS session_type TEXT;

-- 2. Backfill existing rows using the same rule inferSessionType() used before:
--    no organisation_id => open_event, otherwise in_house.
UPDATE sessions
SET session_type = CASE WHEN organisation_id IS NULL THEN 'open_event' ELSE 'in_house' END
WHERE session_type IS NULL;

-- 3. Default for any future insert that omits it.
ALTER TABLE sessions ALTER COLUMN session_type SET DEFAULT 'in_house';

-- 4. Constrain to the two valid values (drop-then-add for idempotency).
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_session_type_check;
ALTER TABLE sessions
  ADD CONSTRAINT sessions_session_type_check
  CHECK (session_type IN ('in_house', 'open_event'));

-- 5. Now that every row has a value, enforce NOT NULL.
ALTER TABLE sessions ALTER COLUMN session_type SET NOT NULL;
