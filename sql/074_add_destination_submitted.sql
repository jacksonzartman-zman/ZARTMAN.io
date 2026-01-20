-- Phase 14.2: Track web-form submissions for RFQ destinations.

alter table public.rfq_destinations
  add column if not exists submitted_at timestamptz null,
  add column if not exists submitted_notes text null,
  add column if not exists submitted_by uuid null;

alter table public.rfq_destinations
  drop constraint if exists rfq_destinations_status_check;

alter table public.rfq_destinations
  add constraint rfq_destinations_status_check
    check (
      status in (
        'draft',
        'queued',
        'sent',
        'submitted',
        'viewed',
        'quoted',
        'declined',
        'error'
      )
    );

notify pgrst, 'reload schema';
