-- Adds quote_invites table for supplier RFQ invitations (supplier_id-based).

create table if not exists public.quote_invites (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'quote_invites_quote_supplier_unique'
  ) then
    alter table public.quote_invites
      add constraint quote_invites_quote_supplier_unique unique (quote_id, supplier_id);
  end if;
end
$$;

create index if not exists quote_invites_quote_id_idx
  on public.quote_invites (quote_id);

create index if not exists quote_invites_supplier_id_idx
  on public.quote_invites (supplier_id);

alter table if exists public.quote_invites enable row level security;

drop policy if exists "quote_invites_service_role_manage" on public.quote_invites;
create policy "quote_invites_service_role_manage"
  on public.quote_invites
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "quote_invites_suppliers_select_own" on public.quote_invites;
create policy "quote_invites_suppliers_select_own"
  on public.quote_invites
  for select
  using (
    exists (
      select 1
      from public.suppliers s
      where s.id = quote_invites.supplier_id
        and s.user_id = auth.uid()
    )
  );

