-- Phase 20.1.4: Ops events for customer team invites.

alter table if exists public.ops_events
  drop constraint if exists ops_events_event_type_check;

alter table if exists public.ops_events
  add constraint ops_events_event_type_check
    check (
      event_type in (
        'destination_added',
        'destination_added_with_mismatch',
        'destinations_added',
        'destination_status_updated',
        'destination_submitted',
        'destination_dispatch_started',
        'kickoff_update_requested',
        'kickoff_task_status_changed',
        'customer_saved_search_interest',
        'customer_intro_requested',
        'customer_intro_handled',
        'message_nudge_requested',
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
        'supplier_discovered',
        'supplier_discovery_updated',
        'provider_contacted',
        'provider_responded',
        'provider_verified',
        'provider_unverified',
        'provider_activated',
        'provider_deactivated',
        'provider_directory_visibility_changed',
        'customer_teammate_invited',
        'customer_team_invite_created',
        'customer_team_invite_accepted',
        'estimate_shown',
        'bench_gap_task_event'
      )
    );

notify pgrst, 'reload schema';

