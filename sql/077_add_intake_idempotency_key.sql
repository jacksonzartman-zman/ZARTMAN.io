-- Add idempotency key for intake finalize retries (homepage uploads).

alter table if exists public.uploads
  add column if not exists intake_idempotency_key text;

create unique index if not exists uploads_intake_idempotency_key_idx
  on public.uploads (intake_idempotency_key)
  where intake_idempotency_key is not null;
