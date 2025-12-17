-- Customer teammate invites (magic links)

create table if not exists public.customer_users (
  customer_id uuid not null references public.customers(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint customer_users_pkey primary key (customer_id, user_id)
);

comment on table public.customer_users is 'Join table: customer workspace members (auth user ids).';

alter table if exists public.customer_users enable row level security;

drop policy if exists "customer_users_service_role_manage" on public.customer_users;
create policy "customer_users_service_role_manage"
  on public.customer_users
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create table if not exists public.customer_invites (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  email text not null,
  token text not null unique,
  status text not null default 'pending' check (status in ('pending','accepted','revoked')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz null,
  invited_by_user_id uuid null references auth.users(id) on delete set null
);

create index if not exists customer_invites_customer_id_idx
  on public.customer_invites (customer_id, created_at desc);

create index if not exists customer_invites_email_lower_idx
  on public.customer_invites (lower(email));

create unique index if not exists customer_invites_unique_pending_email
  on public.customer_invites (customer_id, lower(email))
  where status = 'pending';

comment on table public.customer_invites is 'Customer workspace teammate invites (server-only; token-based acceptance).';
comment on column public.customer_invites.token is 'Random 32+ char invite token used in /customer/invite/[token].';

alter table if exists public.customer_invites enable row level security;

-- Lock down reads/writes by default; server/service_role manages.
drop policy if exists "customer_invites_service_role_manage" on public.customer_invites;
create policy "customer_invites_service_role_manage"
  on public.customer_invites
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

select pg_notify('pgrst','reload schema');

