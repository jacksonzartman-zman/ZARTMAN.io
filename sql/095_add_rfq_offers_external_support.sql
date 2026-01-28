-- Phase 95: Support externally-added RFQ offers (broker/marketplace/manual).
--
-- External offers are not tied to an internal supplier record, so `provider_id`
-- must allow NULL. Provenance fields are captured on the offer row.

alter table public.rfq_offers
  add column if not exists source_type text null,
  add column if not exists source_name text null;

alter table public.rfq_offers
  drop constraint if exists rfq_offers_source_type_check,
  add constraint rfq_offers_source_type_check
    check (source_type is null or source_type in ('manual', 'marketplace', 'network'));

-- Some environments originally required provider_id. Allow NULL for broker offers.
alter table public.rfq_offers
  alter column provider_id drop not null;

-- Ensure status variants used by loaders/UI are accepted at the DB layer.
alter table public.rfq_offers
  drop constraint if exists rfq_offers_status_check,
  add constraint rfq_offers_status_check
    check (status in ('received', 'revised', 'quoted', 'withdrawn'));

notify pgrst, 'reload schema';

