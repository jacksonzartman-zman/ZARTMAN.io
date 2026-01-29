-- Phase 101: Supplier/provider notifications for newly routed RFQ destinations.
--
-- - Adds an idempotency table to ensure we only notify once per (rfq_id, provider_id, channel).
-- - Extends rfq_events.event_type to include "supplier_notified" for in-app timeline logging.

-- Allow the new RFQ event type.
alter table public.rfq_events
  drop constraint if exists rfq_events_event_type_check;

alter table public.rfq_events
  add constraint rfq_events_event_type_check
    check (
      event_type in (
        'rfq_created',
        'quick_specs_updated',
        'offer_created',
        'offer_revised',
        'offer_withdrawn',
        'awarded',
        'order_details_confirmed',
        'kickoff_task_completed',
        'supplier_notified'
      )
    );

create table if not exists public.rfq_destination_notifications (
  id uuid primary key default gen_random_uuid(),
  rfq_id uuid not null references public.quotes(id) on delete cascade,
  provider_id uuid not null references public.providers(id),
  channel text not null check (channel in ('email', 'activity')),
  sent_at timestamptz not null default now(),
  unique (rfq_id, provider_id, channel)
);

create index if not exists rfq_destination_notifications_rfq_id_provider_id_idx
  on public.rfq_destination_notifications (rfq_id, provider_id);

comment on table public.rfq_destination_notifications is
  'Idempotency ledger for provider notification channels (email/activity) per RFQ destination.';

alter table if exists public.rfq_destination_notifications enable row level security;

drop policy if exists "rfq_destination_notifications_service_role_manage"
  on public.rfq_destination_notifications;
create policy "rfq_destination_notifications_service_role_manage"
  on public.rfq_destination_notifications
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

notify pgrst, 'reload schema';

