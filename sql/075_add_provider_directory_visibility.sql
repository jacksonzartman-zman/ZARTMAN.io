-- Phase 75: provider directory visibility flag.

alter table if exists public.providers
  add column if not exists show_in_directory boolean null;

create index if not exists providers_show_in_directory_idx
  on public.providers (show_in_directory);

notify pgrst, 'reload schema';
