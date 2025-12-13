-- Adds awarded_* audit columns and indexes to sync Supabase schema.

alter table public.quotes
  add column if not exists awarded_bid_id uuid
    references public.supplier_bids(id)
    on delete set null;

alter table public.quotes
  add column if not exists awarded_supplier_id uuid
    references public.suppliers(id)
    on delete set null;

alter table public.quotes
  add column if not exists awarded_at timestamptz;

alter table public.quotes
  add column if not exists awarded_by_user_id uuid;

alter table public.quotes
  add column if not exists awarded_by_role text;

alter table public.quotes
  drop constraint if exists quotes_awarded_by_role_check;

alter table public.quotes
  add constraint quotes_awarded_by_role_check
    check (
      awarded_by_role is null
      or awarded_by_role in ('admin', 'customer')
    );

create index if not exists quotes_awarded_bid_id_idx
  on public.quotes (awarded_bid_id);

create index if not exists quotes_awarded_supplier_id_idx
  on public.quotes (awarded_supplier_id);

create index if not exists quotes_awarded_at_idx
  on public.quotes (awarded_at);

create or replace view public.quotes_with_uploads as
select
  q.id,
  q.upload_id,
  q.customer_id,
  q.customer_name,
  q.customer_email,
  q.company,
  q.status,
  q.price,
  q.currency,
  q.target_date,
  q.internal_notes,
  q.dfm_notes,
  q.created_at,
  q.updated_at,
  coalesce(q.file_name, u.file_name) as file_name,
  coalesce(q.file_names, upload_files.upload_file_names) as file_names,
  coalesce(q.file_count, upload_files.upload_file_count) as file_count,
  q.assigned_supplier_email,
  q.assigned_supplier_name,
  q.awarded_bid_id,
  q.awarded_supplier_id,
  q.awarded_at,
  q.awarded_by_user_id,
  q.awarded_by_role,
  u.name as upload_name,
  upload_files.upload_file_names,
  upload_files.upload_file_count
from public.quotes q
left join public.uploads u on u.id = q.upload_id
left join lateral (
  select
    array_agg(f.filename order by f.created_at) as upload_file_names,
    count(*)::int as upload_file_count
  from public.files f
  where f.quote_id = q.id
) upload_files on true;
