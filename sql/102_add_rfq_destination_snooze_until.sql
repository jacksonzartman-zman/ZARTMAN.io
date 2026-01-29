-- Add supplier-side snooze support for rfq destinations.
-- This is nullable + optional; code is guarded with schema checks.

alter table if exists public.rfq_destinations
  add column if not exists snooze_until timestamptz;

comment on column public.rfq_destinations.snooze_until is
  'When set in the future, this RFQ destination is hidden from supplier New RFQs until the timestamp.';

