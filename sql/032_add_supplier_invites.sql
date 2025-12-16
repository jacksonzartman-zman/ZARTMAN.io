-- Supplier teammate invites (magic links)

create table if not exists public.supplier_users (
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint supplier_users_pkey primary key (supplier_id, user_id)
);

comment on table public.supplier_users is 'Join table: supplier workspace members (auth user ids).';

alter table if exists public.supplier_users enable row level security;

drop policy if exists "supplier_users_service_role_manage" on public.supplier_users;
create policy "supplier_users_service_role_manage"
  on public.supplier_users
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create table if not exists public.supplier_invites (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  email text not null,
  token text not null unique,
  status text not null default 'pending' check (status in ('pending','accepted','revoked')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz null,
  invited_by_user_id uuid null references auth.users(id) on delete set null
);

create index if not exists supplier_invites_supplier_id_idx
  on public.supplier_invites (supplier_id, created_at desc);

create index if not exists supplier_invites_email_lower_idx
  on public.supplier_invites (lower(email));

create unique index if not exists supplier_invites_unique_pending_email
  on public.supplier_invites (supplier_id, lower(email))
  where status = 'pending';

comment on table public.supplier_invites is 'Supplier workspace teammate invites (server-only; token-based acceptance).';
comment on column public.supplier_invites.token is 'Random 32+ char invite token used in /supplier/invite/[token].';

alter table if exists public.supplier_invites enable row level security;

-- Lock down reads/writes by default; server/service_role manages.
drop policy if exists "supplier_invites_service_role_manage" on public.supplier_invites;
create policy "supplier_invites_service_role_manage"
  on public.supplier_invites
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

select pg_notify('pgrst','reload schema');
