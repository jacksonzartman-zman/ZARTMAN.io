-- Phase 11: unified notifications snapshot cache
-- Read-only, regenerable snapshot table fed from existing signals.

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
  read_at timestamptz null
);

create index if not exists user_notifications_user_unread_created_idx
  on public.user_notifications (user_id, is_read, created_at desc);

create index if not exists user_notifications_entity_idx
  on public.user_notifications (entity_type, entity_id);

-- RLS
alter table public.user_notifications enable row level security;

drop policy if exists "user_notifications_service_role_manage" on public.user_notifications;
create policy "user_notifications_service_role_manage"
  on public.user_notifications
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "user_notifications_user_select_own" on public.user_notifications;
create policy "user_notifications_user_select_own"
  on public.user_notifications
  for select
  using (auth.uid() = user_id);

drop policy if exists "user_notifications_user_update_own" on public.user_notifications;
create policy "user_notifications_user_update_own"
  on public.user_notifications
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

select pg_notify('pgrst','reload schema');
