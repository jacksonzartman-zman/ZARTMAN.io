-- Phase 70: support customer-invited providers and contact tracking.

alter table public.providers
  add column if not exists contacted_at timestamptz null;

alter table public.providers
  drop constraint if exists providers_source_check,
  add constraint providers_source_check
    check (source in ('manual', 'csv_import', 'discovered', 'customer_invite'));

create index if not exists providers_contacted_at_idx
  on public.providers (contacted_at);

notify pgrst, 'reload schema';
