-- Phase 20.1.3: Minimal customer teams (schema-gated).
--
-- Goals:
-- - Introduce first-class teams so "Invite teammate" can grant access (best-effort).
-- - Keep fail-soft: application code must tolerate missing schema.
--
-- Notes:
-- - We keep RLS locked down (service_role only) because the app server uses the service key.
-- - `customer_account_id` maps to `public.customers(id)` (the existing customer "account" record).

do $$
begin
  if not exists (select 1 from pg_type where typname = 'customer_team_role') then
    create type public.customer_team_role as enum ('owner', 'member');
  end if;
end
$$;

create table if not exists public.customer_teams (
  id uuid primary key default gen_random_uuid(),
  customer_account_id uuid not null references public.customers(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create index if not exists customer_teams_customer_account_id_idx
  on public.customer_teams (customer_account_id, created_at desc);

comment on table public.customer_teams is 'Customer team workspaces scoped to a customer account (customers.id).';

alter table if exists public.customer_teams enable row level security;

drop policy if exists "customer_teams_service_role_manage" on public.customer_teams;
create policy "customer_teams_service_role_manage"
  on public.customer_teams
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create table if not exists public.customer_team_members (
  team_id uuid not null references public.customer_teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.customer_team_role not null default 'member',
  created_at timestamptz not null default now(),
  constraint customer_team_members_pkey primary key (team_id, user_id)
);

create index if not exists customer_team_members_user_id_idx
  on public.customer_team_members (user_id, created_at desc);

comment on table public.customer_team_members is 'Join table: customer teams to auth users (role-based).';

alter table if exists public.customer_team_members enable row level security;

drop policy if exists "customer_team_members_service_role_manage" on public.customer_team_members;
create policy "customer_team_members_service_role_manage"
  on public.customer_team_members
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Quote -> team association (preferred simplest model).
alter table if exists public.quotes
  add column if not exists team_id uuid null references public.customer_teams(id) on delete set null;

create index if not exists quotes_team_id_idx
  on public.quotes (team_id);

comment on column public.quotes.team_id is 'Optional team association for customer team access control.';

-- Helper RPC: resolve auth user ids by email (service-role only).
-- This is used to best-effort add existing users to a team when invited by email.
create or replace function public.lookup_auth_user_ids_by_email(emails text[])
returns table(email text, user_id uuid)
language sql
security definer
set search_path = public, auth
as $$
  select lower(u.email)::text as email, u.id as user_id
  from auth.users u
  where lower(u.email) = any (
    select lower(e)::text from unnest(emails) as e
  );
$$;

revoke all on function public.lookup_auth_user_ids_by_email(text[]) from public;
revoke all on function public.lookup_auth_user_ids_by_email(text[]) from anon;
revoke all on function public.lookup_auth_user_ids_by_email(text[]) from authenticated;
grant execute on function public.lookup_auth_user_ids_by_email(text[]) to service_role;

select pg_notify('pgrst','reload schema');

