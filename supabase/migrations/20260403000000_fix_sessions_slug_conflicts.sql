-- MAIL-BUG-001: Fix sessions_slug_key duplicate constraint violation
--
-- Root cause: The client_area_schema migration (applied directly to Supabase from an
-- unmerged worktree) created a `sessions` table with slug UNIQUE NOT NULL. A database
-- trigger on `contacts` fires on INSERT/UPDATE and generates session slugs derived from
-- contact data (e.g. company name). When multiple contacts share the same company, or
-- when a bulk operation (Mailchimp sync's last_synced_at update, saveAllContacts upsert)
-- touches many contacts at once, the trigger fires for each row and tries to insert
-- duplicate session slugs — causing the constraint violation.
--
-- This migration:
--   1. Removes duplicate session slug rows (keeps the oldest per slug)
--   2. Drops the contacts→sessions trigger under all plausible names
--   3. Drops the associated trigger function(s)
--
-- Run in Supabase SQL Editor:
--   supabase.com → your project → SQL Editor → paste and run

-- ─── Step 1: Deduplicate existing session slugs ──────────────────────────────
-- Keep the oldest record per slug, delete the rest.

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (PARTITION BY slug ORDER BY created_at ASC NULLS LAST) AS rn
  FROM sessions
)
DELETE FROM sessions
WHERE id IN (
  SELECT id FROM ranked WHERE rn > 1
);

-- ─── Step 2: Drop contacts→sessions triggers (all plausible names) ───────────
-- These were never part of the deployed schema and must be removed so that
-- contact saves no longer attempt to insert into sessions.

DROP TRIGGER IF EXISTS create_session_for_contact       ON contacts;
DROP TRIGGER IF EXISTS after_contact_insert_session      ON contacts;
DROP TRIGGER IF EXISTS contact_session_trigger           ON contacts;
DROP TRIGGER IF EXISTS on_contact_change                 ON contacts;
DROP TRIGGER IF EXISTS contact_to_session                ON contacts;
DROP TRIGGER IF EXISTS auto_session_on_contact           ON contacts;
DROP TRIGGER IF EXISTS trg_contact_session               ON contacts;
DROP TRIGGER IF EXISTS trg_contacts_session              ON contacts;

-- ─── Step 3: Drop trigger functions (IF EXISTS, CASCADE to any remaining refs) ─

DROP FUNCTION IF EXISTS create_contact_session()         CASCADE;
DROP FUNCTION IF EXISTS auto_create_session()            CASCADE;
DROP FUNCTION IF EXISTS contact_session_handler()        CASCADE;
DROP FUNCTION IF EXISTS on_contact_create_session()      CASCADE;
DROP FUNCTION IF EXISTS generate_session_for_contact()   CASCADE;

-- ─── Verification ─────────────────────────────────────────────────────────────
-- After running, confirm no duplicate slugs remain:
--   SELECT slug, COUNT(*) FROM sessions GROUP BY slug HAVING COUNT(*) > 1;
-- Should return zero rows.
--
-- Confirm no contacts triggers writing to sessions remain:
--   SELECT trigger_name FROM information_schema.triggers
--   WHERE event_object_table = 'contacts';
