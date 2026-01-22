-- Phase 19.2.5: structured supplier response capture (provider_responses).

create table if not exists public.provider_responses (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers (id) on delete cascade,
  response_at timestamptz not null default now(),
  channel text not null,
  summary text not null,
  raw_notes text null,
  responder_user_id uuid null references auth.users (id),
  created_at timestamptz not null default now(),
  constraint provider_responses_channel_check
    check (channel in ('email', 'call', 'form'))
);

create index if not exists provider_responses_provider_id_idx
  on public.provider_responses (provider_id);

create index if not exists provider_responses_provider_id_response_at_desc_idx
  on public.provider_responses (provider_id, response_at desc);

notify pgrst, 'reload schema';

