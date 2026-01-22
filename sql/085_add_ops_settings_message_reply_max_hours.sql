-- Phase 18.3.1: Message needs-reply SLA (customer<->supplier) settings.

alter table if exists public.ops_settings
  add column if not exists message_reply_max_hours int not null default 24;

-- PostgREST schema cache refresh
notify pgrst, 'reload schema';

