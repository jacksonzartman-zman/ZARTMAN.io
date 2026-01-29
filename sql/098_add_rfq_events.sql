-- Adds a lightweight RFQ (quote) event log for admin timeline views.

create extension if not exists pgcrypto;

create table if not exists public.rfq_events (
  id uuid primary key default gen_random_uuid(),
  rfq_id uuid not null references public.quotes(id) on delete cascade,
  event_type text not null check (
    event_type in (
      'rfq_created',
      'quick_specs_updated',
      'offer_created',
      'offer_revised',
      'offer_withdrawn',
      'awarded',
      'order_details_confirmed',
      'kickoff_task_completed'
    )
  ),
  message text null,
  actor_role text not null check (actor_role in ('admin', 'customer', 'supplier', 'system')),
  actor_user_id uuid null,
  created_at timestamptz not null default now()
);

create index if not exists rfq_events_rfq_id_created_at_idx
  on public.rfq_events (rfq_id, created_at desc);

create index if not exists rfq_events_rfq_id_event_type_idx
  on public.rfq_events (rfq_id, event_type);

comment on table public.rfq_events is
  'Durable RFQ lifecycle event log (offers, quick specs updates, awards, order confirmation).';

alter table if exists public.rfq_events enable row level security;

-- Lock down writes: only server/service_role inserts via server actions.
drop policy if exists "rfq_events_service_role_manage" on public.rfq_events;
create policy "rfq_events_service_role_manage"
  on public.rfq_events
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Admins can read all events (email heuristic).
drop policy if exists "rfq_events_admins_select_all" on public.rfq_events;
create policy "rfq_events_admins_select_all"
  on public.rfq_events
  for select
  using (
    lower(coalesce(auth.jwt()->> 'email', '')) like '%@zartman.%'
  );

-- Customers can read events for quotes they own.
drop policy if exists "rfq_events_customers_select" on public.rfq_events;
create policy "rfq_events_customers_select"
  on public.rfq_events
  for select
  using (
    exists (
      select 1
      from public.quotes q
      left join public.customers c on c.id = q.customer_id
      where q.id = rfq_events.rfq_id
        and (
          (c.user_id is not null and c.user_id = auth.uid())
          or (
            q.customer_email is not null
            and trim(q.customer_email) <> ''
            and lower(q.customer_email) = lower(coalesce(auth.jwt()->> 'email', ''))
          )
        )
    )
  );

-- Suppliers can read events for quotes they are invited to / bid on / awarded.
drop policy if exists "rfq_events_suppliers_select" on public.rfq_events;
create policy "rfq_events_suppliers_select"
  on public.rfq_events
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
            where sb.quote_id = rfq_events.rfq_id
              and sb.supplier_id = s.id
          )
          or exists (
            select 1
            from public.quote_suppliers qs
            where qs.quote_id = rfq_events.rfq_id
              and qs.supplier_id = s.id
          )
          or exists (
            select 1
            from public.quotes q
            where q.id = rfq_events.rfq_id
              and q.awarded_supplier_id = s.id
          )
        )
    )
  );

