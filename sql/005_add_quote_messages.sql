create table if not exists public.quote_messages (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  author_type text not null check (author_type in ('admin', 'customer', 'supplier')),
  author_name text,
  author_email text,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists quote_messages_quote_id_created_idx
  on public.quote_messages (quote_id, created_at desc);
