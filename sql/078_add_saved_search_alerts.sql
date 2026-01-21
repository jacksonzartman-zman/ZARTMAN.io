-- Phase 78: add search alert opt-in flag for saved searches.

alter table if exists public.saved_searches
  add column if not exists search_alerts_enabled boolean not null default false;

notify pgrst, 'reload schema';
