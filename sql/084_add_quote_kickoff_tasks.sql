-- 18.2.1 — Kickoff Tasks foundation (quote-level)
--
-- Goal:
-- - Introduce a quote-level kickoff task system that can be seeded immediately after award.
-- - Preserve legacy supplier-scoped kickoff checklist rows by renaming them out of the way.
--
-- Notes:
-- - This migration is written to be re-runnable and safe across partially-migrated environments.
-- - We avoid adding foreign keys to non-core relations (ex: users) to keep deploys durable.
-- - Application code is schema-gated and will degrade gracefully when tables/columns are missing.

do $$
begin
  -- If a legacy supplier-scoped table exists at `public.quote_kickoff_tasks`, rename it.
  -- Legacy shape is detected by the presence of the `supplier_id` column.
  if to_regclass('public.quote_kickoff_tasks') is not null then
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'quote_kickoff_tasks'
        and column_name = 'supplier_id'
    ) then
      if to_regclass('public.quote_supplier_kickoff_tasks') is null then
        alter table public.quote_kickoff_tasks rename to quote_supplier_kickoff_tasks;
      end if;
    end if;
  end if;
end $$;

-- New quote-level kickoff tasks table.
create table if not exists public.quote_kickoff_tasks (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  task_key text not null check (char_length(trim(task_key)) > 0),
  title text not null,
  description text null,
  sort_order int not null default 1,
  status text not null default 'pending',
  completed_at timestamptz null,
  completed_by_user_id uuid null,
  blocked_reason text null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

do $$
begin
  -- Enum-ish guard for status.
  if not exists (
    select 1
    from pg_constraint
    where conname = 'quote_kickoff_tasks_status_allowed'
  ) then
    alter table public.quote_kickoff_tasks
      add constraint quote_kickoff_tasks_status_allowed
        check (lower(trim(status)) in ('pending', 'complete', 'blocked'));
  end if;

  -- Ensure blocked_reason is only set when blocked.
  if not exists (
    select 1
    from pg_constraint
    where conname = 'quote_kickoff_tasks_blocked_reason_only_when_blocked'
  ) then
    alter table public.quote_kickoff_tasks
      add constraint quote_kickoff_tasks_blocked_reason_only_when_blocked
        check (
          (lower(trim(status)) = 'blocked' and blocked_reason is not null and char_length(trim(blocked_reason)) > 0)
          or (lower(trim(status)) <> 'blocked' and blocked_reason is null)
        ) not valid;
    alter table public.quote_kickoff_tasks
      validate constraint quote_kickoff_tasks_blocked_reason_only_when_blocked;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'quote_kickoff_tasks_unique_quote_task_key'
  ) then
    alter table public.quote_kickoff_tasks
      add constraint quote_kickoff_tasks_unique_quote_task_key unique (quote_id, task_key);
  end if;
end $$;

create index if not exists quote_kickoff_tasks_quote_id_idx
  on public.quote_kickoff_tasks (quote_id);

-- Shared updated_at trigger helper (safe to re-run).
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists quote_kickoff_tasks_set_updated_at on public.quote_kickoff_tasks;
create trigger quote_kickoff_tasks_set_updated_at
  before update on public.quote_kickoff_tasks
  for each row
  execute function public.set_updated_at();

alter table if exists public.quote_kickoff_tasks enable row level security;

drop policy if exists "quote_kickoff_tasks_service_role_manage" on public.quote_kickoff_tasks;
create policy "quote_kickoff_tasks_service_role_manage"
  on public.quote_kickoff_tasks
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

select pg_notify('pgrst', 'reload schema');

