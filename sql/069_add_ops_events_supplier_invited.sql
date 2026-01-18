-- Phase 69: add supplier_invited ops events.

alter table if exists public.ops_events
  drop constraint if exists ops_events_event_type_check;

alter table if exists public.ops_events
  add constraint ops_events_event_type_check
    check (
      event_type in (
        'destination_added',
        'destination_status_updated',
        'customer_saved_search_interest',
        'outbound_email_generated',
        'offer_upserted',
        'offer_revised',
        'offer_selected',
        'message_posted',
        'supplier_join_requested',
        'supplier_invited'
      )
    );

notify pgrst, 'reload schema';
