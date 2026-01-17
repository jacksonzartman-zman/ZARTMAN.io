-- Phase 18: provider registry for RFQ routing destinations.

create table if not exists public.providers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  provider_type text not null,
  quoting_mode text not null,
  is_active boolean not null default true,
  website text null,
  notes text null,
  created_at timestamptz not null default now(),
  constraint providers_provider_type_check
    check (provider_type in ('marketplace', 'direct_supplier', 'factory', 'broker')),
  constraint providers_quoting_mode_check
    check (quoting_mode in ('manual', 'email', 'api'))
);

create index if not exists providers_is_active_idx
  on public.providers (is_active);

create index if not exists providers_provider_type_idx
  on public.providers (provider_type);

notify pgrst, 'reload schema';
