-- Add optional notes to RFQ offers.

alter table public.rfq_offers
  add column if not exists notes text null;

notify pgrst, 'reload schema';
