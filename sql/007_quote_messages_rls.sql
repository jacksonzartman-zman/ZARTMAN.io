-- Adds row level security for quote message threads shared between customers and admins.

create table if not exists public.quote_messages (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  author_type text not null check (author_type in ('admin', 'customer', 'supplier')),
  author_email text,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists quote_messages_quote_id_created_idx
  on public.quote_messages (quote_id, created_at desc);

alter table if exists public.quote_messages enable row level security;

drop policy if exists "quote_messages_customers_select" on public.quote_messages;
create policy "quote_messages_customers_select"
  on public.quote_messages
  for select
  using (
    exists (
      select 1
      from public.quotes q
      where q.id = quote_messages.quote_id
        and q.email is not null
        and trim(q.email) <> ''
        and lower(q.email) = lower(coalesce(auth.jwt()->> 'email', ''))
    )
  );

drop policy if exists "quote_messages_customers_insert" on public.quote_messages;
create policy "quote_messages_customers_insert"
  on public.quote_messages
  for insert
  with check (
    lower(author_type) = 'customer'
    and exists (
      select 1
      from public.quotes q
      where q.id = quote_messages.quote_id
        and q.email is not null
        and trim(q.email) <> ''
        and lower(q.email) = lower(coalesce(auth.jwt()->> 'email', ''))
    )
  );

drop policy if exists "quote_messages_admins_manage" on public.quote_messages;
create policy "quote_messages_admins_manage"
  on public.quote_messages
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
