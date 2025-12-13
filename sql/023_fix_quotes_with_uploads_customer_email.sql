-- Fix quotes_with_uploads to stop selecting legacy quotes.email.
--
-- Some environments removed public.quotes.email in favor of public.quotes.customer_email.
-- This migration ensures the view no longer references the removed column.

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
