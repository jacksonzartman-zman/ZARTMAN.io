-- Adds customer/supplier auth links plus backfills portal metadata.

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  email text unique not null,
  company_name text,
  phone text,
  website text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists customers_email_lower_idx
  on public.customers (lower(email));

alter table if exists public.quotes
  add column if not exists customer_id uuid references public.customers(id);

create index if not exists quotes_customer_id_idx
  on public.quotes (customer_id);

alter table if exists public.suppliers
  add column if not exists user_id uuid unique references auth.users(id) on delete set null;

alter table if exists public.quote_suppliers
  add column if not exists supplier_id uuid references public.suppliers(id);

create index if not exists quote_suppliers_supplier_id_idx
  on public.quote_suppliers (supplier_id);

-- Backfill customer and supplier references using existing email columns.
insert into public.customers (email, company_name)
select distinct lower(email) as email, coalesce(company, 'Customer') as company_name
from public.quotes
where email is not null
  and trim(email) <> ''
on conflict (email) do update
set company_name = coalesce(excluded.company_name, public.customers.company_name);

update public.quotes q
set customer_id = c.id
from public.customers c
where q.customer_id is null
  and c.email = lower(q.email);

update public.quote_suppliers qs
set supplier_id = s.id
from public.suppliers s
where qs.supplier_id is null
  and s.primary_email is not null
  and qs.supplier_email is not null
  and lower(s.primary_email) = lower(qs.supplier_email);

comment on table public.customers is 'Zartman customer accounts linked to Supabase auth users.';
comment on column public.quotes.customer_id is 'References public.customers for portal permissions.';
comment on column public.suppliers.user_id is 'Supabase auth user that manages this supplier profile.';
