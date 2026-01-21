-- Phase 14.3: Track dispatch-started timestamps for RFQ destinations.

alter table public.rfq_destinations
  add column if not exists dispatch_started_at timestamptz null;

notify pgrst, 'reload schema';
