-- Phase 24: Track customer-selected RFQ offers.

alter table if exists public.quotes
  add column if not exists selected_provider_id uuid null references public.providers(id),
  add column if not exists selected_offer_id uuid null references public.rfq_offers(id),
  add column if not exists selected_at timestamptz null;

notify pgrst, 'reload schema';
