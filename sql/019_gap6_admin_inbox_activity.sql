-- Gap 6: Admin RFQ Inbox + Bid Activity Surfacing (Hardening-First)
--
-- Single source of truth for admin inbox rows:
-- - Base: public.quotes_with_uploads (existing file/upload metadata)
-- - Bid aggregates: public.supplier_bids (bid_count, latest_bid_at)
-- - Award metadata: public.quotes (already projected into quotes_with_uploads)
-- - Awarded supplier name: public.suppliers (company_name)
--
-- Defense-in-depth:
-- - Revoke anon/authenticated access (not exposed via PostgREST for end users)
-- - Grant select only to service_role for server-only admin workflows

create or replace view public.admin_quotes_inbox as
select
  qwu.*,
  coalesce(bids.bid_count, 0) as bid_count,
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

