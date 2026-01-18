-- Phase 72: provider capability fields for routing eligibility.

alter table if exists public.providers
  add column if not exists processes text[] null,
  add column if not exists materials text[] null,
  add column if not exists country text null,
  add column if not exists states text[] null;

create index if not exists providers_processes_idx
  on public.providers using gin (processes);

create index if not exists providers_materials_idx
  on public.providers using gin (materials);

create index if not exists providers_country_idx
  on public.providers (country);

create index if not exists providers_states_idx
  on public.providers using gin (states);

notify pgrst, 'reload schema';
