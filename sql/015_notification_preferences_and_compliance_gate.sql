-- Introduces notification preferences plus a quote-level compliance gate.

create table if not exists public.notification_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  role text not null check (role in ('customer', 'supplier', 'admin')),
  event_type text not null check (char_length(trim(event_type)) > 0),
  channel text not null check (channel in ('email')),
  enabled boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'notification_preferences_unique_pref'
  ) then
    alter table public.notification_preferences
      add constraint notification_preferences_unique_pref
        unique (user_id, role, event_type, channel);
  end if;
end
$$;

create index if not exists notification_preferences_user_role_idx
  on public.notification_preferences (user_id, role);

drop trigger if exists notification_preferences_set_updated_at on public.notification_preferences;
create trigger notification_preferences_set_updated_at
  before update on public.notification_preferences
  for each row
  execute function public.set_updated_at();

alter table if exists public.notification_preferences enable row level security;

drop policy if exists "notification_preferences_service_role_manage" on public.notification_preferences;
create policy "notification_preferences_service_role_manage"
  on public.notification_preferences
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "notification_preferences_user_manage" on public.notification_preferences;
create policy "notification_preferences_user_manage"
  on public.notification_preferences
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

alter table if exists public.quotes
  add column if not exists compliance_mode text not null default 'standard';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'quotes_compliance_mode_check'
  ) then
    alter table public.quotes
      add constraint quotes_compliance_mode_check
        check (compliance_mode in ('standard', 'no_email'));
  end if;
end
$$;
