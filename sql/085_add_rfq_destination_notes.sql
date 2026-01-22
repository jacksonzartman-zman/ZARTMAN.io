-- Phase 85: Add general-purpose notes to RFQ destinations (admin-only audit trail).

alter table public.rfq_destinations
  add column if not exists notes text null;

notify pgrst, 'reload schema';

