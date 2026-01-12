-- Phase 16.3 — Backend MVP: Change Requests

create table if not exists public.quote_change_requests (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  created_by_user_id uuid,
  created_by_role text not null default 'customer' check (char_length(trim(created_by_role)) > 0),
  change_type text not null check (char_length(trim(change_type)) > 0),
  notes text not null check (char_length(trim(notes)) > 0),
  status text not null default 'open' check (char_length(trim(status)) > 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists quote_change_requests_quote_id_created_at_idx
  on public.quote_change_requests (quote_id, created_at desc);

drop trigger if exists quote_change_requests_set_updated_at on public.quote_change_requests;
create trigger quote_change_requests_set_updated_at
  before update on public.quote_change_requests
  for each row
  execute function public.set_updated_at();

alter table if exists public.quote_change_requests enable row level security;

drop policy if exists "quote_change_requests_service_role_manage" on public.quote_change_requests;
create policy "quote_change_requests_service_role_manage"
  on public.quote_change_requests
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

