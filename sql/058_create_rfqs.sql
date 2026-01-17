-- Phase 20: Marketplace RFQs core table.

create table if not exists public.rfqs (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid null references public.customers(id) on delete set null,
  status text not null default 'draft',
  title text null,
  description text null,
  quantity int null,
  process_requirements text[] null,
  material_requirements text[] null,
  certification_requirements text[] null,
  target_date timestamptz null,
  priority numeric null,
  files text[] null,
  upload_id uuid null references public.uploads(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rfqs_status_check
    check (status in ('draft', 'open', 'in_review', 'pending_award', 'awarded', 'closed', 'cancelled'))
);

create index if not exists rfqs_customer_id_idx
  on public.rfqs (customer_id);

create index if not exists rfqs_status_idx
  on public.rfqs (status);

create index if not exists rfqs_created_at_idx
  on public.rfqs (created_at desc);

notify pgrst, 'reload schema';
