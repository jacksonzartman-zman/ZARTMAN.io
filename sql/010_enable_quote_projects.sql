-- Ensures quote_projects exists with the schema the app expects plus RLS.

create table if not exists public.quote_projects (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  po_number text,
  target_ship_date date,
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table if exists public.quote_projects
  alter column created_at set default timezone('utc', now()),
  alter column updated_at set default timezone('utc', now());

alter table if exists public.quote_projects
  add column if not exists notes text;

alter table if exists public.quote_projects
  alter column target_ship_date type date using target_ship_date::date;

do $$
begin
  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'quote_projects_quote_id_idx'
  ) then
    create index quote_projects_quote_id_idx
      on public.quote_projects (quote_id);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'quote_projects_quote_unique'
  ) then
    alter table public.quote_projects
      add constraint quote_projects_quote_unique unique (quote_id);
  end if;
end
$$;

alter table if exists public.quote_projects enable row level security;

drop policy if exists "quote_projects_service_role_manage" on public.quote_projects;
create policy "quote_projects_service_role_manage"
  on public.quote_projects
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "quote_projects_customers_select" on public.quote_projects;
create policy "quote_projects_customers_select"
  on public.quote_projects
  for select
  using (
    exists (
      select 1
      from public.quotes q
      where q.id = quote_projects.quote_id
        and q.email is not null
        and trim(q.email) <> ''
        and lower(q.email) = lower(coalesce(auth.jwt()->> 'email', ''))
    )
  );

drop policy if exists "quote_projects_customers_insert" on public.quote_projects;
create policy "quote_projects_customers_insert"
  on public.quote_projects
  for insert
  with check (
    exists (
      select 1
      from public.quotes q
      where q.id = quote_projects.quote_id
        and q.email is not null
        and trim(q.email) <> ''
        and lower(q.email) = lower(coalesce(auth.jwt()->> 'email', ''))
    )
  );

drop policy if exists "quote_projects_customers_update" on public.quote_projects;
create policy "quote_projects_customers_update"
  on public.quote_projects
  for update
  using (
    exists (
      select 1
      from public.quotes q
      where q.id = quote_projects.quote_id
        and q.email is not null
        and trim(q.email) <> ''
        and lower(q.email) = lower(coalesce(auth.jwt()->> 'email', ''))
    )
  )
  with check (
    exists (
      select 1
      from public.quotes q
      where q.id = quote_projects.quote_id
        and q.email is not null
        and trim(q.email) <> ''
        and lower(q.email) = lower(coalesce(auth.jwt()->> 'email', ''))
    )
  );

drop policy if exists "quote_projects_suppliers_select" on public.quote_projects;
create policy "quote_projects_suppliers_select"
  on public.quote_projects
  for select
  using (
    exists (
      select 1
      from public.quotes q
      where q.id = quote_projects.quote_id
        and q.assigned_supplier_email is not null
        and trim(q.assigned_supplier_email) <> ''
        and lower(q.assigned_supplier_email) = lower(coalesce(auth.jwt()->> 'email', ''))
    )
    or exists (
      select 1
      from public.supplier_bids sb
      join public.suppliers s on s.id = sb.supplier_id
      where sb.quote_id = quote_projects.quote_id
        and lower(coalesce(sb.status, '')) in ('accepted', 'won', 'winner')
        and s.primary_email is not null
        and trim(s.primary_email) <> ''
        and lower(s.primary_email) = lower(coalesce(auth.jwt()->> 'email', ''))
    )
  );
