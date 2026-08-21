-- Morada forms P0 security hardening (Phil 19:02 BST 2026-06-15).
-- Supports: persistent rate limit (item 2) and submit idempotency (item 5).

-- 1. Persistent sliding-window rate limit, survives Edge Function cold start.
--    One row per accepted submit; the limiter counts rows in the window per
--    bucket (ip + email). Only the service role touches it.
create table if not exists public.morada_rate_limit (
  id bigint generated always as identity primary key,
  bucket text not null,
  created_at timestamptz not null default now()
);
create index if not exists morada_rate_limit_bucket_created_idx
  on public.morada_rate_limit (bucket, created_at);
alter table public.morada_rate_limit enable row level security;
-- No policies: locked to the service role (which bypasses RLS), as intended.

-- 2. Idempotency: a UUID per Form 2 submit. A replayed key returns the same
--    booking instead of creating a new Stripe session / FreeAgent invoice.
--    A client UUID is globally unique, so a single partial unique index on the
--    key is sufficient (function scoping unnecessary for collision safety).
alter table public.contact_activities
  add column if not exists idempotency_key text;
create unique index if not exists contact_activities_idempotency_key_uidx
  on public.contact_activities (idempotency_key)
  where idempotency_key is not null;
