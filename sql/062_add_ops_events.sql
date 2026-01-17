-- Phase 22: Lightweight operational event logging.

create table if not exists public.ops_events (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  destination_id uuid null references public.rfq_destinations(id) on delete set null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint ops_events_event_type_check
    check (
      event_type in (
        'destination_added',
        'destination_status_updated',
        'outbound_email_generated',
        'offer_upserted',
        'offer_selected'
      )
    )
);

create index if not exists ops_events_quote_id_idx
  on public.ops_events (quote_id);

create index if not exists ops_events_destination_id_idx
  on public.ops_events (destination_id);

create index if not exists ops_events_event_type_idx
  on public.ops_events (event_type);

create index if not exists ops_events_created_at_desc_idx
  on public.ops_events (created_at desc);

notify pgrst, 'reload schema';
