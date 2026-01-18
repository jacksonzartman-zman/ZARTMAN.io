-- Phase 69: Saved searches for customer portal.

create table if not exists public.saved_searches (
  quote_id uuid not null references public.quotes(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  label text not null,
  created_at timestamptz not null default now(),
  last_viewed_at timestamptz null,
  primary key (customer_id, quote_id)
);

create index if not exists saved_searches_quote_id_idx
  on public.saved_searches (quote_id);

notify pgrst, 'reload schema';
