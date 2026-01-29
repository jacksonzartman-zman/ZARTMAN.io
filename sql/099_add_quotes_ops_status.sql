-- Add an admin-only ops status field for quotes.
--
-- ops_status is a nullable text enum implemented via a CHECK constraint.
-- This field is intended for internal ops workflow tracking and should not be shown
-- to customers.
--
-- Also projects ops_status into the admin-only inbox view so /admin/quotes can filter by it.
--
-- We intentionally use DROP VIEW IF EXISTS + CREATE VIEW (not create-or-replace)
-- so PostgREST reliably picks up the new schema.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'quotes'
      AND column_name = 'ops_status'
  ) THEN
    ALTER TABLE public.quotes
      ADD COLUMN ops_status text;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'quotes_ops_status_check'
  ) THEN
    ALTER TABLE public.quotes
      ADD CONSTRAINT quotes_ops_status_check
      CHECK (
        ops_status IS NULL OR ops_status IN (
          'needs_sourcing',
          'waiting_on_quotes',
          'ready_for_review',
          'awaiting_award',
          'awaiting_order_details',
          'placed',
          'in_production',
          'shipped',
          'delivered'
        )
      );
  END IF;
END
$$;

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

  -- Order confirmation + ops workflow fields (from public.quotes)
  q.po_number,
  q.ship_to,
  q.selection_confirmed_at,
  q.ops_status,

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
  'Admin-only RFQ inbox rows with bid/award activity, order confirmation, and ops workflow fields.';

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

