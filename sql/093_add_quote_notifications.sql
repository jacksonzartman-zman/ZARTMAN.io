-- Phase 93: Quote offer-arrival notifications (server-only; public RFQ page opt-in).
--
-- Goals:
-- - Let a user provide an email to be notified when offers arrive for a quote.
-- - Keep server-only (service_role) access; the public RFQ page calls a server route.
-- - Provide idempotency so repeated submits don't spam rows (unique quote_id + email_lower).

create table if not exists public.quote_notifications (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  email text not null,
  email_lower text not null,
  created_at timestamptz not null default now(),
  last_requested_at timestamptz not null default now(),

  constraint quote_notifications_email_lower_chk check (email_lower = lower(email))
);

comment on table public.quote_notifications is 'Opt-in email notifications for when offers arrive on a quote (server-only).';
comment on column public.quote_notifications.last_requested_at is 'Most recent time this email requested notifications (used for lightweight rate limiting).';

create index if not exists quote_notifications_quote_id_idx
  on public.quote_notifications (quote_id, created_at desc);

create unique index if not exists quote_notifications_unique_quote_email
  on public.quote_notifications (quote_id, email_lower);

alter table if exists public.quote_notifications enable row level security;

-- Lock down reads/writes by default; server/service_role manages.
drop policy if exists "quote_notifications_service_role_manage" on public.quote_notifications;
create policy "quote_notifications_service_role_manage"
  on public.quote_notifications
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

notify pgrst, 'reload schema';

