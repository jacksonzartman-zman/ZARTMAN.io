-- Phase 11b: ensure user_notifications snapshot table exists (service-role only).
-- This is a regenerable snapshot cache for in-app notifications.

create table if not exists public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  type text not null,
  entity_type text not null,
  entity_id uuid not null,
  title text not null,
  body text not null,
  href text not null,
  is_read boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Reconcile older schema variants (e.g. prior read_at column).
alter table public.user_notifications
  add column if not exists updated_at timestamptz;

update public.user_notifications
  set updated_at = coalesce(updated_at, created_at, now())
  where updated_at is null;

alter table public.user_notifications
  alter column updated_at set default now(),
  alter column updated_at set not null;

alter table public.user_notifications
  drop column if exists read_at;

-- Idempotent upserts per user+notification identity.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_notifications_user_identity_unique'
  ) then
    alter table public.user_notifications
      add constraint user_notifications_user_identity_unique
      unique (user_id, type, entity_type, entity_id);
  end if;
end $$;

-- List-view index.
create index if not exists user_notifications_user_unread_created_idx
  on public.user_notifications (user_id, is_read, created_at desc);

-- Keep updated_at fresh.
drop trigger if exists user_notifications_set_updated_at on public.user_notifications;
create trigger user_notifications_set_updated_at
  before update on public.user_notifications
  for each row
  execute function public.set_updated_at();

-- RLS: service role only.
alter table public.user_notifications enable row level security;

drop policy if exists "user_notifications_service_role_manage" on public.user_notifications;
drop policy if exists "user_notifications_user_select_own" on public.user_notifications;
drop policy if exists "user_notifications_user_update_own" on public.user_notifications;

create policy "user_notifications_service_role_manage"
  on public.user_notifications
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

select pg_notify('pgrst','reload schema');

