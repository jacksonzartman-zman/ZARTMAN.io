-- Phase 94: Admin-only metadata for externally captured offers.
--
-- Stores internal provenance for offers that were entered manually by admins
-- (e.g. marketplace screenshots, supplier network quotes, etc.).
-- These fields are intended to be hidden from customer-facing UIs.

alter table public.rfq_offers
  add column if not exists admin_source_type text null,
  add column if not exists admin_source_name text null,
  add column if not exists process text null;

alter table public.rfq_offers
  drop constraint if exists rfq_offers_admin_source_type_check,
  add constraint rfq_offers_admin_source_type_check
    check (admin_source_type is null or admin_source_type in ('manual', 'marketplace', 'network'));

alter table public.rfq_offers
  drop constraint if exists rfq_offers_process_check,
  add constraint rfq_offers_process_check
    check (process is null or process in ('CNC', '3DP', 'Sheet Metal', 'Injection Molding'));

notify pgrst, 'reload schema';

