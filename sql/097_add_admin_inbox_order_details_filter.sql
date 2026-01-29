-- Expose post-award order confirmation fields in the admin inbox view.
--
-- Used by /admin/quotes filters such as "Needs order details" (awarded but missing
-- PO number or ship-to details).
--
-- We intentionally use DROP VIEW IF EXISTS + CREATE VIEW (not create-or-replace)
-- so PostgREST reliably picks up the new schema.

DROP VIEW IF EXISTS public.admin_quotes_inbox;

CREATE VIEW public.admin_quotes_inbox AS
SELECT
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

  -- Award fields
  qwu.awarded_at,
  qwu.awarded_supplier_id,
  qwu.awarded_bid_id,

  -- Order confirmation fields (from public.quotes)
  q.po_number,
  q.ship_to,
  q.selection_confirmed_at,

  -- Admin activity fields
  coalesce(bids.bid_count, 0)::int as bid_count,
  bids.latest_bid_at as latest_bid_at,
  (qwu.awarded_supplier_id is not null or qwu.awarded_bid_id is not null) as has_awarded_bid,
  s.company_name as awarded_supplier_name
FROM public.quotes_with_uploads qwu
LEFT JOIN public.quotes q
  ON q.id = qwu.id
LEFT JOIN LATERAL (
  SELECT
    count(*)::int as bid_count,
    max(coalesce(sb.updated_at, sb.created_at)) as latest_bid_at
  FROM public.supplier_bids sb
  WHERE sb.quote_id = qwu.id
) bids ON true
LEFT JOIN public.suppliers s
  ON s.id = qwu.awarded_supplier_id;

COMMENT ON VIEW public.admin_quotes_inbox IS
  'Admin-only RFQ inbox rows with bid/award activity and order confirmation details.';

-- Helpful index for the bid activity subquery; guard for schema drift / partial envs.
DO $$
BEGIN
  IF to_regclass('public.supplier_bids') IS NOT NULL THEN
    EXECUTE 'create index if not exists supplier_bids_quote_id_created_at_idx on public.supplier_bids (quote_id, created_at desc)';
    EXECUTE 'create index if not exists supplier_bids_quote_id_updated_at_idx on public.supplier_bids (quote_id, updated_at desc)';
  END IF;
END
$$;

REVOKE ALL ON public.admin_quotes_inbox FROM anon;
REVOKE ALL ON public.admin_quotes_inbox FROM authenticated;
REVOKE ALL ON public.admin_quotes_inbox FROM public;

-- Admin routes are gated, but allow authenticated reads for server-side loaders
-- that use user-scoped JWT clients; service_role keeps working too.
GRANT SELECT ON public.admin_quotes_inbox TO anon, authenticated, service_role;

-- Ensure PostgREST picks up the recreated view schema.
SELECT pg_notify('pgrst', 'reload schema');

