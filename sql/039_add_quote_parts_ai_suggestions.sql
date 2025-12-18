create table if not exists public.quote_parts_ai_suggestions (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  suggestions jsonb not null,
  model_version text not null,
  created_at timestamptz not null default now()
);

create index if not exists quote_parts_ai_suggestions_quote_id_idx
  on public.quote_parts_ai_suggestions (quote_id);

-- No RLS for now (admin/service only).

select pg_notify('pgrst','reload schema');

