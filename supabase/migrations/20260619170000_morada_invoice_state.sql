-- Morada course: durable invoice state for set-and-forget FreeAgent invoicing
-- (19 Jun 2026). Decouples "payment captured" (status='paid', always true) from
-- "invoice recorded" (invoice_status) so a failed/owed invoice becomes a
-- queryable, retryable state instead of a silent terminal loss. The scheduled
-- poll re-runs the FreeAgent leg for paid bookings that still owe an invoice,
-- with bounded attempts + backoff, and alerts once attempts are exhausted.
-- All statements idempotent (IF NOT EXISTS) so this is a safe no-op where the
-- columns/index already exist.

alter table public.contact_activities add column if not exists invoice_status text;            -- null=n/a | 'recorded' | 'failed' | 'skipped' (alert is tracked by invoice_alerted_at, not a status)
alter table public.contact_activities add column if not exists invoice_attempts integer not null default 0;
alter table public.contact_activities add column if not exists invoice_last_error text;
alter table public.contact_activities add column if not exists invoice_last_attempt_at timestamptz;
alter table public.contact_activities add column if not exists invoice_alerted_at timestamptz; -- set once when the alert email fires, guards repeat alerts

-- Self-heal scan index: paid course bookings whose invoice still failed.
create index if not exists contact_activities_invoice_retry_idx
  on public.contact_activities (invoice_last_attempt_at)
  where status = 'paid' and activity_type = 'course_booking_paid' and invoice_status = 'failed';

-- Backfill any pre-existing paid course bookings. Test sessions (cs_test_) and
-- null-session rows -> 'skipped' so the self-heal poll never invoices fake
-- bookings on the live books. Any REAL (cs_live_) paid booking that owes an
-- invoice -> 'failed' so the poll retries it and alerts (never silently hidden).
-- Tightly scoped to paid course bookings with no invoice state yet; safe no-op
-- where there are none.
update public.contact_activities
   set invoice_status = case
         when stripe_session_id is null or left(stripe_session_id, 8) = 'cs_test_' then 'skipped'
         else 'failed'
       end
 where activity_type = 'course_booking_paid'
   and status = 'paid'
   and invoice_status is null;
