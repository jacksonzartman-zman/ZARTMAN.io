-- Supplier capacity snapshots (advisory-only).
-- v0: record weekly capacity levels per supplier + capability.

create table if not exists public.supplier_capacity_snapshots (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  week_start_date date not null,
  capability text not null check (char_length(trim(capability)) > 0),
  capacity_level text not null check (capacity_level in ('low','medium','high','overloaded')),
  notes text null,
  created_at timestamptz not null default now(),
  constraint supplier_capacity_snapshots_unique unique (supplier_id, week_start_date, capability)
);

create index if not exists supplier_capacity_snapshots_supplier_week_idx
  on public.supplier_capacity_snapshots (supplier_id, week_start_date);

comment on table public.supplier_capacity_snapshots is
  'Advisory-only supplier capacity snapshots by week + capability.';

alter table if exists public.supplier_capacity_snapshots enable row level security;

-- Lock down writes/reads by default; server/service_role manages.
drop policy if exists "supplier_capacity_snapshots_service_role_manage" on public.supplier_capacity_snapshots;
create policy "supplier_capacity_snapshots_service_role_manage"
  on public.supplier_capacity_snapshots
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Customers should not see capacity events.
-- Note: quote_events is shared across portals; enforce exclusion at the policy layer.
drop policy if exists "quote_events_customers_select" on public.quote_events;
create policy "quote_events_customers_select"
  on public.quote_events
  for select
  using (
    quote_events.event_type <> 'capacity_updated'
    and exists (
      select 1
      from public.quotes q
      left join public.customers c on c.id = q.customer_id
      where q.id = quote_events.quote_id
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

select pg_notify('pgrst','reload schema');
