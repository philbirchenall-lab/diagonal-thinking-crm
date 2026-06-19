-- Morada course idempotency: stripe_session_id column + unique index.
-- The fulfilment atomic claim (fulfillCoursePayment) and the course-book pending
-- row key exactly-once delivery on contact_activities.stripe_session_id. The
-- column exists on the live DB but was never captured in a migration (schema
-- drift found 19 Jun 2026), so a rebuilt environment would break the paid-course
-- flow. Both statements are idempotent, so applying this against the live DB is a
-- safe no-op where the column/index already exist.
alter table public.contact_activities
  add column if not exists stripe_session_id text;

-- Partial unique index gives the atomic exactly-once claim (one fulfilment per
-- Stripe session, even under concurrent thank-you + poll calls).
create unique index if not exists contact_activities_stripe_session_id_uidx
  on public.contact_activities (stripe_session_id)
  where stripe_session_id is not null;
