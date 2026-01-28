-- Phase 94: Mark offer-arrival notifications as sent (idempotency).

alter table if exists public.quote_notifications
  add column if not exists sent_at timestamptz null;

comment on column public.quote_notifications.sent_at is 'When the offer-arrival email was sent (used for idempotency on first offer arrival).';

-- Fast lookup for unsent subscribers per quote.
create index if not exists quote_notifications_unsent_quote_id_idx
  on public.quote_notifications (quote_id)
  where sent_at is null;

notify pgrst, 'reload schema';

