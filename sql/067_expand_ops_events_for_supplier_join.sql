-- Allow ops events without quote context (supplier join requests).

alter table if exists public.ops_events
  alter column quote_id drop not null;

alter table if exists public.ops_events
  drop constraint if exists ops_events_event_type_check;

alter table if exists public.ops_events
  add constraint ops_events_event_type_check
    check (
      event_type in (
        'destination_added',
        'destination_status_updated',
        'outbound_email_generated',
        'offer_upserted',
        'offer_revised',
        'offer_selected',
        'message_posted',
        'supplier_join_requested'
      )
    );

notify pgrst, 'reload schema';
