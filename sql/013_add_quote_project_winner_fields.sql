-- Adds winner metadata columns to quote_projects for project snapshots.

alter table if exists public.quote_projects
  add column if not exists supplier_id uuid references public.suppliers(id) on delete set null;

alter table if exists public.quote_projects
  add column if not exists status text;

alter table if exists public.quote_projects
  alter column status set default 'planning';

update public.quote_projects
set status = coalesce(status, 'planning')
where status is distinct from 'planning' or status is null;

create index if not exists quote_projects_supplier_id_idx
  on public.quote_projects (supplier_id);

create index if not exists quote_projects_status_idx
  on public.quote_projects (status);
