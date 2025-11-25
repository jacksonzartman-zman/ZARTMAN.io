-- Marketplace core schema: RFQs, files, bids, and event log.

create table if not exists public.rfqs (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete set null,
  upload_id uuid references public.uploads(id) on delete set null,
  title text not null,
  description text not null,
  status text not null default 'draft' check (
    status in ('draft', 'open', 'closed', 'awarded', 'cancelled')
  ),
  target_processes jsonb,
  target_materials jsonb,
  budget_currency text default 'USD',
  budget_amount numeric,
  lead_time_days integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists rfqs_customer_status_idx
  on public.rfqs (customer_id, status);

create table if not exists public.rfq_files (
  id uuid primary key default gen_random_uuid(),
  rfq_id uuid not null references public.rfqs(id) on delete cascade,
  storage_key text not null,
  bucket_id text,
  file_name text,
  file_type text not null default 'other' check (
    file_type in ('cad', 'drawing', 'spec', 'other')
  ),
  created_at timestamptz not null default now()
);

create index if not exists rfq_files_rfq_id_idx
  on public.rfq_files (rfq_id);

create table if not exists public.rfq_bids (
  id uuid primary key default gen_random_uuid(),
  rfq_id uuid not null references public.rfqs(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  price_total numeric,
  currency text not null default 'USD',
  lead_time_days integer,
  notes text,
  status text not null default 'pending' check (
    status in ('pending', 'accepted', 'rejected', 'withdrawn')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (rfq_id, supplier_id)
);

create index if not exists rfq_bids_rfq_id_idx
  on public.rfq_bids (rfq_id);

create index if not exists rfq_bids_supplier_id_idx
  on public.rfq_bids (supplier_id);

create table if not exists public.rfq_events (
  id uuid primary key default gen_random_uuid(),
  rfq_id uuid not null references public.rfqs(id) on delete cascade,
  actor_type text not null check (
    actor_type in ('customer', 'supplier', 'system')
  ),
  actor_id uuid,
  event_type text not null,
  payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists rfq_events_rfq_id_idx
  on public.rfq_events (rfq_id);
