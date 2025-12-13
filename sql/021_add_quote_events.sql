-- Adds a durable quote_events audit trail shared across portals.

create table if not exists public.quote_events (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  event_type text not null check (char_length(trim(event_type)) > 0),
  actor_role text not null check (actor_role in ('admin', 'customer', 'supplier', 'system')),
  actor_user_id uuid null,
  actor_supplier_id uuid null references public.suppliers(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists quote_events_quote_id_created_at_idx
  on public.quote_events (quote_id, created_at desc);

create index if not exists quote_events_quote_id_event_type_idx
  on public.quote_events (quote_id, event_type);

comment on table public.quote_events is
  'Durable workflow audit trail for quotes (bids, awards, messages, kickoff updates, lifecycle changes).';

alter table if exists public.quote_events enable row level security;

-- Lock down writes: only server/service_role inserts via server actions.
drop policy if exists "quote_events_service_role_manage" on public.quote_events;
create policy "quote_events_service_role_manage"
  on public.quote_events
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Admins can read all events (email heuristic).
drop policy if exists "quote_events_admins_select_all" on public.quote_events;
create policy "quote_events_admins_select_all"
  on public.quote_events
  for select
  using (
    lower(coalesce(auth.jwt()->> 'email', '')) like '%@zartman.%'
  );

-- Customers can read events for quotes they own.
drop policy if exists "quote_events_customers_select" on public.quote_events;
create policy "quote_events_customers_select"
  on public.quote_events
  for select
  using (
    exists (
      select 1
      from public.quotes q
      left join public.customers c on c.id = q.customer_id
      where q.id = quote_events.quote_id
        and (
          (c.user_id is not null and c.user_id = auth.uid())
          or (
            q.email is not null
            and trim(q.email) <> ''
            and lower(q.email) = lower(coalesce(auth.jwt()->> 'email', ''))
          )
        )
    )
  );

-- Suppliers can read events for quotes they are invited to / bid on / awarded.
drop policy if exists "quote_events_suppliers_select" on public.quote_events;
create policy "quote_events_suppliers_select"
  on public.quote_events
  for select
  using (
    exists (
      select 1
      from public.suppliers s
      where s.user_id = auth.uid()
        and (
          exists (
            select 1
            from public.supplier_bids sb
            where sb.quote_id = quote_events.quote_id
              and sb.supplier_id = s.id
          )
          or exists (
            select 1
            from public.quote_suppliers qs
            where qs.quote_id = quote_events.quote_id
              and qs.supplier_id = s.id
          )
          or exists (
            select 1
            from public.quotes q
            where q.id = quote_events.quote_id
              and q.awarded_supplier_id = s.id
          )
        )
    )
  );

