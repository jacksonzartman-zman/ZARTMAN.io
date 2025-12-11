-- Creates the supplier kickoff checklist table that powers quote-level tasks.

create table if not exists public.quote_kickoff_tasks (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  task_key text not null check (char_length(trim(task_key)) > 0),
  title text not null,
  description text,
  completed boolean not null default false,
  sort_order integer,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists quote_kickoff_tasks_quote_supplier_idx
  on public.quote_kickoff_tasks (quote_id, supplier_id);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'quote_kickoff_tasks_unique_task'
  ) then
    alter table public.quote_kickoff_tasks
      add constraint quote_kickoff_tasks_unique_task unique (quote_id, supplier_id, task_key);
  end if;
end
$$;

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

drop policy if exists "quote_kickoff_tasks_suppliers_select" on public.quote_kickoff_tasks;
create policy "quote_kickoff_tasks_suppliers_select"
  on public.quote_kickoff_tasks
  for select
  using (
    exists (
      select 1
      from public.supplier_bids sb
      join public.suppliers s on s.id = sb.supplier_id
      where sb.quote_id = quote_kickoff_tasks.quote_id
        and sb.supplier_id = quote_kickoff_tasks.supplier_id
        and lower(coalesce(sb.status, '')) in ('accepted', 'won', 'winner')
        and s.primary_email is not null
        and trim(s.primary_email) <> ''
        and lower(s.primary_email) = lower(coalesce(auth.jwt()->> 'email', ''))
    )
  );

drop policy if exists "quote_kickoff_tasks_suppliers_insert" on public.quote_kickoff_tasks;
create policy "quote_kickoff_tasks_suppliers_insert"
  on public.quote_kickoff_tasks
  for insert
  with check (
    exists (
      select 1
      from public.supplier_bids sb
      join public.suppliers s on s.id = sb.supplier_id
      where sb.quote_id = quote_kickoff_tasks.quote_id
        and sb.supplier_id = quote_kickoff_tasks.supplier_id
        and lower(coalesce(sb.status, '')) in ('accepted', 'won', 'winner')
        and s.primary_email is not null
        and trim(s.primary_email) <> ''
        and lower(s.primary_email) = lower(coalesce(auth.jwt()->> 'email', ''))
    )
  );

drop policy if exists "quote_kickoff_tasks_suppliers_update" on public.quote_kickoff_tasks;
create policy "quote_kickoff_tasks_suppliers_update"
  on public.quote_kickoff_tasks
  for update
  using (
    exists (
      select 1
      from public.supplier_bids sb
      join public.suppliers s on s.id = sb.supplier_id
      where sb.quote_id = quote_kickoff_tasks.quote_id
        and sb.supplier_id = quote_kickoff_tasks.supplier_id
        and lower(coalesce(sb.status, '')) in ('accepted', 'won', 'winner')
        and s.primary_email is not null
        and trim(s.primary_email) <> ''
        and lower(s.primary_email) = lower(coalesce(auth.jwt()->> 'email', ''))
    )
  )
  with check (
    exists (
      select 1
      from public.supplier_bids sb
      join public.suppliers s on s.id = sb.supplier_id
      where sb.quote_id = quote_kickoff_tasks.quote_id
        and sb.supplier_id = quote_kickoff_tasks.supplier_id
        and lower(coalesce(sb.status, '')) in ('accepted', 'won', 'winner')
        and s.primary_email is not null
        and trim(s.primary_email) <> ''
        and lower(s.primary_email) = lower(coalesce(auth.jwt()->> 'email', ''))
    )
  );
