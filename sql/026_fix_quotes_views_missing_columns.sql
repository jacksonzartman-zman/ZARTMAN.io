-- Fix portal/admin quote list view schema mismatches.
--
-- Symptoms observed at runtime:
-- - column quotes_with_uploads.file_names does not exist
-- - column quotes_with_uploads.assigned_supplier_name does not exist
-- - column admin_quotes_inbox.file_names does not exist
--
-- Constraints:
-- - Do NOT reference quotes.email (removed in some envs)
-- - Do NOT DROP VIEW / DROP VIEW CASCADE (avoid dependency failures)
-- - Keep RLS posture (no SECURITY DEFINER)
-- - Keep array types stable (text[])

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
  -- Legacy single-file field (kept for backwards compatibility)
  q.file_name as file_name,

  -- Required by portals/admin list UI (stable types)
  names.file_names,
  coalesce(cardinality(names.file_names), 0)::int as file_count,
  names.upload_file_names,
  coalesce(cardinality(names.upload_file_names), 0)::int as upload_file_count,

  -- Supplier assignment (best-effort)
  q.assigned_supplier_email,
  awarded_supplier.company_name as assigned_supplier_name,

  -- Award audit fields
  q.awarded_bid_id,
  q.awarded_supplier_id,
  q.awarded_at,
  q.awarded_by_user_id,
  q.awarded_by_role,

  -- Optional upload label
  u.name as upload_name
from public.quotes q
left join public.uploads u on u.id = q.upload_id
left join public.suppliers awarded_supplier on awarded_supplier.id = q.awarded_supplier_id
left join lateral (
  select
    coalesce(
      array_agg(f.filename::text order by f.created_at)
        filter (where f.filename is not null and length(btrim(f.filename::text)) > 0),
      '{}'::text[]
    ) as upload_file_names
  from public.files f
  where f.quote_id = q.id
) upload_files on true
left join lateral (
  select
    upload_files.upload_file_names as upload_file_names,
    case
      -- Prefer the richer per-file metadata if present.
      when cardinality(upload_files.upload_file_names) > 0 then upload_files.upload_file_names
      -- Fall back to the legacy single file name.
      when q.file_name is not null and length(btrim(q.file_name)) > 0 then array[q.file_name]::text[]
      -- Stable empty array.
      else '{}'::text[]
    end as file_names
) names on true;

comment on view public.quotes_with_uploads is
  'Quote rows enriched with safe file arrays/counts and optional upload label. Invoker security; no quotes.email.';


create or replace view public.admin_quotes_inbox as
select
  -- Base quote fields (from public.quotes_with_uploads)
  qwu.id,
  qwu.upload_id,
  qwu.created_at,
  qwu.status,
  qwu.customer_name,
  qwu.customer_email,
  qwu.company,
  qwu.file_name,
  -- Explicitly project file_names from quotes_with_uploads to satisfy PostgREST schema.
  qwu.file_names,
  qwu.upload_file_names,
  qwu.file_count,
  qwu.upload_file_count,
  qwu.upload_name,
  qwu.awarded_at,

  -- Admin activity fields
  coalesce(bids.bid_count, 0)::int as bid_count,
  bids.latest_bid_at as latest_bid_at,
  (qwu.awarded_supplier_id is not null or qwu.awarded_bid_id is not null) as has_awarded_bid,
  s.company_name as awarded_supplier_name
from public.quotes_with_uploads qwu
left join lateral (
  select
    count(*)::int as bid_count,
    max(coalesce(sb.updated_at, sb.created_at)) as latest_bid_at
  from public.supplier_bids sb
  where sb.quote_id = qwu.id
) bids on true
left join public.suppliers s
  on s.id = qwu.awarded_supplier_id;

comment on view public.admin_quotes_inbox is
  'Admin-only RFQ inbox rows with bid/award activity surfaced. Service-role only.';

-- Helpful index for the bid activity subquery; guard for schema drift / partial envs.
do $$
begin
  if to_regclass('public.supplier_bids') is not null then
    execute 'create index if not exists supplier_bids_quote_id_created_at_idx on public.supplier_bids (quote_id, created_at desc)';
    execute 'create index if not exists supplier_bids_quote_id_updated_at_idx on public.supplier_bids (quote_id, updated_at desc)';
  end if;
end
$$;

-- Defense-in-depth: keep admin inbox view service-role only.
revoke all on public.admin_quotes_inbox from anon;
revoke all on public.admin_quotes_inbox from authenticated;
revoke all on public.admin_quotes_inbox from public;

grant select on public.admin_quotes_inbox to service_role;

-- Ensure PostgREST picks up the recreated view schema.
select pg_notify('pgrst', 'reload schema');
