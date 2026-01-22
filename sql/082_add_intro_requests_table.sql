-- Phase 82: intro requests queue (durable ops task rows).

create table if not exists public.intro_requests (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  provider_id uuid not null references public.providers(id),
  offer_id uuid not null references public.rfq_offers(id) on delete cascade,
  customer_email text null,
  company_name text null,
  notes text null,
  status text not null default 'open',
  requested_at timestamptz not null default timezone('utc', now()),
  handled_at timestamptz null,
  handled_by_user_id uuid null,
  admin_notes text null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (quote_id, provider_id, offer_id)
);

-- Lifecycle constraint (idempotent).
do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'intro_requests'
      and c.conname = 'intro_requests_status_check'
  ) then
    execute $sql$
      alter table public.intro_requests
        add constraint intro_requests_status_check
        check (status in ('open', 'handled'))
    $sql$;
  end if;
end
$$;

create index if not exists intro_requests_status_requested_at_idx
  on public.intro_requests (status, requested_at desc);

create index if not exists intro_requests_quote_id_status_requested_at_idx
  on public.intro_requests (quote_id, status, requested_at desc);

create index if not exists intro_requests_quote_id_provider_id_status_idx
  on public.intro_requests (quote_id, provider_id, status);

drop trigger if exists intro_requests_set_updated_at on public.intro_requests;
create trigger intro_requests_set_updated_at
  before update on public.intro_requests
  for each row
  execute function public.set_updated_at();

alter table if exists public.intro_requests enable row level security;

drop policy if exists "intro_requests_service_role_manage" on public.intro_requests;
create policy "intro_requests_service_role_manage"
  on public.intro_requests
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

notify pgrst, 'reload schema';

