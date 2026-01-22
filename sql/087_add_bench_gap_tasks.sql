-- Phase 87: Bench health gap tasks (turn insights into durable ops work).

create table if not exists public.bench_gap_tasks (
  id uuid primary key default gen_random_uuid(),
  dimension text not null,
  gap_key text not null,
  window text not null,
  status text not null default 'open',
  owner text null,
  notes text null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (dimension, gap_key, window)
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
      and t.relname = 'bench_gap_tasks'
      and c.conname = 'bench_gap_tasks_status_check'
  ) then
    execute $sql$
      alter table public.bench_gap_tasks
        add constraint bench_gap_tasks_status_check
        check (status in ('open', 'in_progress', 'closed'))
    $sql$;
  end if;
end
$$;

create index if not exists bench_gap_tasks_status_updated_at_idx
  on public.bench_gap_tasks (status, updated_at desc);

create index if not exists bench_gap_tasks_dimension_status_updated_at_idx
  on public.bench_gap_tasks (dimension, status, updated_at desc);

create index if not exists bench_gap_tasks_dimension_key_window_idx
  on public.bench_gap_tasks (dimension, gap_key, window);

drop trigger if exists bench_gap_tasks_set_updated_at on public.bench_gap_tasks;
create trigger bench_gap_tasks_set_updated_at
  before update on public.bench_gap_tasks
  for each row
  execute function public.set_updated_at();

alter table if exists public.bench_gap_tasks enable row level security;

drop policy if exists "bench_gap_tasks_service_role_manage" on public.bench_gap_tasks;
create policy "bench_gap_tasks_service_role_manage"
  on public.bench_gap_tasks
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

notify pgrst, 'reload schema';

