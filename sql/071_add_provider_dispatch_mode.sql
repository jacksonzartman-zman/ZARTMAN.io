-- Phase 71: provider dispatch mode + RFQ web form URL.

alter table public.providers
  add column if not exists dispatch_mode text not null default 'email',
  add column if not exists rfq_url text null;

alter table public.providers
  drop constraint if exists providers_dispatch_mode_check,
  add constraint providers_dispatch_mode_check
    check (dispatch_mode in ('email', 'web_form', 'api'));

create index if not exists providers_dispatch_mode_idx
  on public.providers (dispatch_mode);

notify pgrst, 'reload schema';
