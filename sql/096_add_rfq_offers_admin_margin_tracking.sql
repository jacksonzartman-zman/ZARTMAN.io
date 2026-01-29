-- Phase 96: Admin-only margin tracking for broker/external offers.
--
-- These columns are intended to be used by admin UIs only. Customer-facing
-- portals must not display (or serialize) these fields.

alter table public.rfq_offers
  add column if not exists internal_cost numeric null,
  add column if not exists internal_shipping_cost numeric null,
  add column if not exists internal_notes text null,
  add column if not exists source_url text null;

notify pgrst, 'reload schema';

