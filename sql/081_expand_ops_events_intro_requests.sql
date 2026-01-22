-- Phase 81: intro request ops events (requested + handled).

alter table if exists public.ops_events
  drop constraint if exists ops_events_event_type_check;

alter table if exists public.ops_events
  add constraint ops_events_event_type_check
    check (
      event_type in (
        'destination_added',
        'destinations_added',
        'destination_status_updated',
        'destination_submitted',
        'destination_dispatch_started',
        'customer_saved_search_interest',
        'customer_intro_requested',
        'customer_intro_handled',
        'search_alert_enabled',
        'search_alert_disabled',
        'search_alert_notified',
        'outbound_email_generated',
        'offer_upserted',
        'offer_revised',
        'offer_selected',
        'offer_shortlisted',
        'offer_unshortlisted',
        'message_posted',
        'supplier_join_requested',
        'supplier_invited',
        'provider_contacted',
        'provider_verified',
        'provider_unverified',
        'provider_activated',
        'provider_deactivated',
        'provider_directory_visibility_changed',
        'estimate_shown'
      )
    );

notify pgrst, 'reload schema';

