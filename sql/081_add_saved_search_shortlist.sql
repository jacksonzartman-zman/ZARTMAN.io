-- Phase 81: store customer shortlist selections for offers.

alter table if exists public.saved_searches
  add column if not exists shortlisted_offer_ids uuid[] not null default '{}'::uuid[];

notify pgrst, 'reload schema';
