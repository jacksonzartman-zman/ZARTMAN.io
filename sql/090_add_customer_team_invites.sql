-- Phase 20.1.4: Product-native customer team invites (schema-gated).
--
-- Goals:
-- - Persist invites scoped to a customer team (public.customer_teams).
-- - Token-based acceptance flow at /customer/team/invite/[token].
-- - Keep server-only (service_role) access; application code must tolerate missing schema.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'customer_team_invite_status') then
    create type public.customer_team_invite_status as enum ('pending', 'accepted', 'expired');
  end if;
end
$$;

create table if not exists public.customer_team_invites (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.customer_teams(id) on delete cascade,
  email text not null,
  token text not null unique,
  invited_by_user_id uuid null references auth.users(id) on delete set null,
  status public.customer_team_invite_status not null default 'pending',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '14 days')
);

create index if not exists customer_team_invites_team_id_idx
  on public.customer_team_invites (team_id, created_at desc);

create index if not exists customer_team_invites_email_lower_idx
  on public.customer_team_invites (lower(email));

create unique index if not exists customer_team_invites_unique_pending_email
  on public.customer_team_invites (team_id, lower(email))
  where status = 'pending';

comment on table public.customer_team_invites is 'Customer team invites (server-only; token-based acceptance).';
comment on column public.customer_team_invites.token is 'Random 32+ char invite token used in /customer/team/invite/[token].';
comment on column public.customer_team_invites.expires_at is 'When the invite becomes invalid (enforced in app + accept flow).';

alter table if exists public.customer_team_invites enable row level security;

-- Lock down reads/writes by default; server/service_role manages.
drop policy if exists "customer_team_invites_service_role_manage" on public.customer_team_invites;
create policy "customer_team_invites_service_role_manage"
  on public.customer_team_invites
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

notify pgrst, 'reload schema';

