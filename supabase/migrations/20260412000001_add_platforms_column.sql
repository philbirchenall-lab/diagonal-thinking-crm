-- Add platforms field to contacts table
-- Tracks which AI platforms/tools each client uses.
-- Valid values (enforced in UI only): ChatGPT, Anthropic Claude, Microsoft Copilot, Google Gemini, Other

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS platforms text[];

-- ── Pre-populate known values ────────────────────────────────────────────────
-- All UPDATEs use targeted WHERE conditions on company name.
-- No upsert — avoids triggering the contacts_email_unique constraint.

-- Named contacts with specific known platforms
UPDATE contacts
SET platforms = ARRAY['Microsoft Copilot']
WHERE company ILIKE '%Rochdale Development Agency%';

UPDATE contacts
SET platforms = ARRAY['Microsoft Copilot']
WHERE company ILIKE 'Livin%';

UPDATE contacts
SET platforms = ARRAY['ChatGPT', 'Anthropic Claude']
WHERE company ILIKE '%TACE%';

UPDATE contacts
SET platforms = ARRAY['Microsoft Copilot']
WHERE company ILIKE '%Clancy%';

-- All other Clients who have 'AI Advantage Course' in their services
-- (i.e. attended The AI Advantage) — default assumption: ChatGPT
-- Only applies where platforms is still NULL (doesn't overwrite the named contacts above)
UPDATE contacts
SET platforms = ARRAY['ChatGPT']
WHERE type = 'Client'
  AND services @> ARRAY['AI Advantage Course']::text[]
  AND platforms IS NULL;
