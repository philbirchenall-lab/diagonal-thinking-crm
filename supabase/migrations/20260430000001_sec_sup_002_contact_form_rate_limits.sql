-- =============================================================
-- SEC-SUP-002: Persistent rate-limit store for contact-form
-- Sprint: P2 Security — 2026-04-30 (risk register SUP-002)
-- =============================================================
-- Context: The contact-form Edge Function previously rate-limited via an
-- in-memory Map. Edge functions cold-start frequently, which silently reset
-- the limiter and made it bypassable by any persistent bot. Hex flagged this
-- on 2026-04-30 (risk register SUP-002).
--
-- Fix shape: persist rate-limit state per IP+window in Postgres so it
-- survives cold starts. Service-role on the Edge Function reads/writes this
-- table. anon/authenticated roles have no access — RLS denies by default
-- once enabled, and we add no policies for them.
--
-- Schema:
--   ip          → client IP (or "unknown" fallback) — composite PK with
--                 window_started_at to give us one row per (IP, window).
--   window_started_at → start of the current count window (UTC).
--   count       → number of submissions counted in this window.
--   last_seen_at → updated on every increment for diagnostics.
--
-- Cleanup: rows older than 24h can be safely pruned. A scheduled Postgres
-- task (or pg_cron) can DELETE FROM contact_form_rate_limits
--   WHERE window_started_at < now() - interval '24 hours';
-- For now, expired rows are harmless — the function only inspects rows
-- inside its window. Add the cron pruner under follow-up if table size
-- grows beyond a few thousand rows (very unlikely at current traffic).
-- =============================================================

CREATE TABLE IF NOT EXISTS public.contact_form_rate_limits (
  ip text NOT NULL,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  count integer NOT NULL DEFAULT 1,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ip, window_started_at)
);

-- Index for the "find current window for this IP" lookup pattern.
CREATE INDEX IF NOT EXISTS contact_form_rate_limits_ip_recent_idx
  ON public.contact_form_rate_limits (ip, window_started_at DESC);

-- Lock the table down. The Edge Function uses service_role which bypasses
-- RLS automatically. Anon/authenticated have no business reading or
-- writing this table.
ALTER TABLE public.contact_form_rate_limits ENABLE ROW LEVEL SECURITY;

-- No anon/authenticated policies are created intentionally — table is
-- service_role only.

COMMENT ON TABLE public.contact_form_rate_limits IS
  'Per-IP rate-limit state for the contact-form edge function. Persists across cold starts. Service-role only.';
