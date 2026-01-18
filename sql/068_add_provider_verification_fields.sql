-- Phase 68: provider verification workflow fields.

alter table public.providers
  add column if not exists verification_status text not null default 'unverified',
  add column if not exists source text not null default 'manual',
  add column if not exists verified_at timestamptz null;

alter table public.providers
  drop constraint if exists providers_verification_status_check,
  add constraint providers_verification_status_check
    check (verification_status in ('unverified', 'verified'));

alter table public.providers
  drop constraint if exists providers_source_check,
  add constraint providers_source_check
    check (source in ('manual', 'csv_import', 'discovered'));

create index if not exists providers_verification_status_idx
  on public.providers (verification_status);

create index if not exists providers_source_idx
  on public.providers (source);

notify pgrst, 'reload schema';
