-- Phase 20.x: Pricing priors (schema-gated; server-only).
--
-- Goals:
-- - Store compact distribution priors for pricing (p10/p50/p90) keyed by technology + material + parts bucket.
-- - Keep server-only (service_role) access; application code must tolerate missing schema.
-- - Do NOT store raw deal rows yet (prod DB stays aggregated only).

create table if not exists public.pricing_priors (
  id uuid primary key default gen_random_uuid(),

  technology text not null,
  material_canon text null,
  parts_bucket text null,

  n int not null,
  p10 numeric not null,
  p50 numeric not null,
  p90 numeric not null,

  updated_at timestamptz not null default now()
);

comment on table public.pricing_priors is 'Aggregated pricing priors (p10/p50/p90) keyed by technology/material/parts bucket.';
comment on column public.pricing_priors.parts_bucket is 'One of: 1, 2-3, 4-10, 11+ (nullable for global priors).';
comment on column public.pricing_priors.n is 'Sample size used to compute priors.';

create unique index if not exists pricing_priors_unique_key
  on public.pricing_priors (technology, material_canon, parts_bucket);

alter table if exists public.pricing_priors enable row level security;

-- Lock down reads/writes by default; server/service_role manages.
drop policy if exists "pricing_priors_service_role_manage" on public.pricing_priors;
create policy "pricing_priors_service_role_manage"
  on public.pricing_priors
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

notify pgrst, 'reload schema';

