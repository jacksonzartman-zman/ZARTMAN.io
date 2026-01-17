-- Phase 21: Normalized RFQ offers for comparison.

create table if not exists public.rfq_offers (
  id uuid primary key default gen_random_uuid(),
  rfq_id uuid not null references public.rfqs(id) on delete cascade,
  provider_id uuid not null references public.providers(id),
  destination_id uuid null references public.rfq_destinations(id) on delete set null,
  currency text not null default 'USD',
  total_price numeric null,
  unit_price numeric null,
  tooling_price numeric null,
  shipping_price numeric null,
  lead_time_days_min int null,
  lead_time_days_max int null,
  assumptions text null,
  confidence_score int null,
  quality_risk_flags text[] not null default '{}'::text[],
  status text not null,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint rfq_offers_status_check
    check (status in ('received', 'revised', 'withdrawn')),
  constraint rfq_offers_confidence_check
    check (confidence_score is null or (confidence_score >= 0 and confidence_score <= 100)),
  unique (rfq_id, provider_id)
);

create index if not exists rfq_offers_rfq_id_idx
  on public.rfq_offers (rfq_id);

notify pgrst, 'reload schema';
