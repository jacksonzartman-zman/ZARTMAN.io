-- Phase 21: Destination-scoped offer tokens for provider submissions.

alter table if exists public.rfq_destinations
  add column if not exists offer_token text not null default gen_random_uuid();

create unique index if not exists rfq_destinations_offer_token_idx
  on public.rfq_destinations (offer_token);

comment on column public.rfq_destinations.offer_token is
  'Random destination-scoped token for provider offer submissions.';

select pg_notify('pgrst', 'reload schema');
