-- Phase 19: RFQ multi-destination dispatch tracking.

create table if not exists public.rfq_destinations (
  id uuid primary key default gen_random_uuid(),
  rfq_id uuid not null references public.quotes(id) on delete cascade,
  provider_id uuid not null references public.providers(id),
  status text not null,
  sent_at timestamptz null,
  last_status_at timestamptz not null default now(),
  external_reference text null,
  error_message text null,
  created_at timestamptz not null default now(),
  constraint rfq_destinations_status_check
    check (status in ('draft', 'queued', 'sent', 'viewed', 'quoted', 'declined', 'error')),
  unique (rfq_id, provider_id)
);

create index if not exists rfq_destinations_rfq_id_idx
  on public.rfq_destinations (rfq_id);

create index if not exists rfq_destinations_status_idx
  on public.rfq_destinations (status);

notify pgrst, 'reload schema';
