-- Adds quote_projects metadata table for project kickoff details captured post-award.

create table if not exists public.quote_projects (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  po_number text,
  target_ship_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.quote_projects
  add constraint quote_projects_quote_unique unique (quote_id);

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
        and q.customer_email is not null
        and trim(q.customer_email) <> ''
        and lower(q.customer_email) = lower(coalesce(auth.jwt()->> 'email', ''))
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
        and q.customer_email is not null
        and trim(q.customer_email) <> ''
        and lower(q.customer_email) = lower(coalesce(auth.jwt()->> 'email', ''))
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
        and q.customer_email is not null
        and trim(q.customer_email) <> ''
        and lower(q.customer_email) = lower(coalesce(auth.jwt()->> 'email', ''))
    )
  )
  with check (
    exists (
      select 1
      from public.quotes q
      where q.id = quote_projects.quote_id
        and q.customer_email is not null
        and trim(q.customer_email) <> ''
        and lower(q.customer_email) = lower(coalesce(auth.jwt()->> 'email', ''))
    )
  );
