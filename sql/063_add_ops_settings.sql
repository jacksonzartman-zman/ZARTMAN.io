-- Phase 23: Ops SLA settings (single-row config).

create table if not exists public.ops_settings (
  id uuid primary key default gen_random_uuid(),
  queued_max_hours int not null default 4,
  sent_no_reply_max_hours int not null default 48,
  updated_at timestamptz not null default now()
);

create index if not exists ops_settings_updated_at_desc_idx
  on public.ops_settings (updated_at desc);

notify pgrst, 'reload schema';
