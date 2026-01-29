-- Phase 96: Customer-specific offer exclusions.
--
-- Certain customers should never see/receive offers from certain sources
-- (internal providers or external marketplace/source labels).

create table if not exists public.customer_exclusions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  excluded_provider_id uuid null references public.providers(id) on delete set null,
  excluded_source_name text null,
  reason text null,
  created_at timestamptz not null default now(),
  constraint customer_exclusions_target_check
    check (excluded_provider_id is not null or excluded_source_name is not null)
);

-- Fast lookup per-customer
create index if not exists customer_exclusions_customer_id_idx
  on public.customer_exclusions (customer_id);

-- Prevent duplicates (provider-based)
create unique index if not exists customer_exclusions_unique_provider
  on public.customer_exclusions (customer_id, excluded_provider_id)
  where excluded_provider_id is not null;

-- Prevent duplicates (source-based, case-insensitive)
create unique index if not exists customer_exclusions_unique_source
  on public.customer_exclusions (customer_id, lower(excluded_source_name))
  where excluded_source_name is not null;

-- Defense-in-depth: block anon/authenticated by default (service role bypasses RLS).
alter table public.customer_exclusions enable row level security;

notify pgrst, 'reload schema';

