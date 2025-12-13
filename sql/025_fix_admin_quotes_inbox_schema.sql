-- Fix admin quotes inbox view schema to match UI loader.
--
-- The /admin/quotes loader selects an explicit column list from public.admin_quotes_inbox.
-- Ensure this view exposes those columns deterministically (no SELECT *), so PostgREST
-- schema cache + future table/view edits won't break the UI.
--
-- Defense-in-depth:
-- - Revoke anon/authenticated access
-- - Grant select only to service_role

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

revoke all on public.admin_quotes_inbox from anon;
revoke all on public.admin_quotes_inbox from authenticated;
revoke all on public.admin_quotes_inbox from public;

grant select on public.admin_quotes_inbox to service_role;

-- Ensure PostgREST picks up the recreated view schema.
select pg_notify('pgrst', 'reload schema');
