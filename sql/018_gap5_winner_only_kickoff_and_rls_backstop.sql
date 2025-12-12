-- Gap 5 Hardening: Winner-only kickoff mutations + RLS backstop policies.

-- -----------------------------------------------------------------------------
-- quote_kickoff_tasks
--
-- Invariants:
-- - Suppliers may SELECT only their own tasks for quotes where they are invited,
--   have a bid, or are the awarded supplier.
-- - Suppliers may INSERT/UPDATE only when they are the awarded supplier AND the
--   row's supplier_id matches their supplier profile.
-- - Service role remains allowed for admin/server workflows.
-- -----------------------------------------------------------------------------

alter table if exists public.quote_kickoff_tasks enable row level security;

drop policy if exists "quote_kickoff_tasks_suppliers_select" on public.quote_kickoff_tasks;
drop policy if exists "quote_kickoff_tasks_suppliers_insert" on public.quote_kickoff_tasks;
drop policy if exists "quote_kickoff_tasks_suppliers_update" on public.quote_kickoff_tasks;

-- Keep (or re-create) a service role escape hatch for admin/server tasks.
drop policy if exists "quote_kickoff_tasks_service_role_manage" on public.quote_kickoff_tasks;
create policy "quote_kickoff_tasks_service_role_manage"
  on public.quote_kickoff_tasks
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "quote_kickoff_tasks_suppliers_select"
  on public.quote_kickoff_tasks
  for select
  using (
    exists (
      select 1
      from public.suppliers s
      where s.id = quote_kickoff_tasks.supplier_id
        and s.user_id = auth.uid()
    )
    and (
      exists (
        select 1
        from public.quote_suppliers qs
        where qs.quote_id = quote_kickoff_tasks.quote_id
          and qs.supplier_id = quote_kickoff_tasks.supplier_id
      )
      or exists (
        select 1
        from public.supplier_bids sb
        where sb.quote_id = quote_kickoff_tasks.quote_id
          and sb.supplier_id = quote_kickoff_tasks.supplier_id
      )
      or exists (
        select 1
        from public.quotes q
        where q.id = quote_kickoff_tasks.quote_id
          and q.awarded_supplier_id = quote_kickoff_tasks.supplier_id
      )
    )
  );

create policy "quote_kickoff_tasks_suppliers_insert"
  on public.quote_kickoff_tasks
  for insert
  with check (
    exists (
      select 1
      from public.suppliers s
      where s.id = quote_kickoff_tasks.supplier_id
        and s.user_id = auth.uid()
    )
    and exists (
      select 1
      from public.quotes q
      where q.id = quote_kickoff_tasks.quote_id
        and q.awarded_supplier_id = quote_kickoff_tasks.supplier_id
    )
  );

create policy "quote_kickoff_tasks_suppliers_update"
  on public.quote_kickoff_tasks
  for update
  using (
    exists (
      select 1
      from public.suppliers s
      where s.id = quote_kickoff_tasks.supplier_id
        and s.user_id = auth.uid()
    )
    and exists (
      select 1
      from public.quotes q
      where q.id = quote_kickoff_tasks.quote_id
        and q.awarded_supplier_id = quote_kickoff_tasks.supplier_id
    )
  )
  with check (
    exists (
      select 1
      from public.suppliers s
      where s.id = quote_kickoff_tasks.supplier_id
        and s.user_id = auth.uid()
    )
    and exists (
      select 1
      from public.quotes q
      where q.id = quote_kickoff_tasks.quote_id
        and q.awarded_supplier_id = quote_kickoff_tasks.supplier_id
    )
  );

-- -----------------------------------------------------------------------------
-- quote_messages
--
-- Invariants:
-- - Customer may SELECT/INSERT only if they own the quote via customers.user_id.
-- - Supplier may SELECT/INSERT only if they are invited, have a bid, or are awarded.
-- - INSERT requires sender_id = auth.uid() and sender_role matches the resolved role.
-- - Admin access is via service_role (no email heuristics).
-- -----------------------------------------------------------------------------

alter table if exists public.quote_messages enable row level security;

drop policy if exists "quote_messages_customers_select" on public.quote_messages;
drop policy if exists "quote_messages_customers_insert" on public.quote_messages;
drop policy if exists "quote_messages_suppliers_select" on public.quote_messages;
drop policy if exists "quote_messages_suppliers_insert" on public.quote_messages;
drop policy if exists "quote_messages_admins_manage" on public.quote_messages;
drop policy if exists "quote_messages_service_role_manage" on public.quote_messages;
drop policy if exists "quote_messages_admins_all" on public.quote_messages;

create policy "quote_messages_service_role_manage"
  on public.quote_messages
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "quote_messages_customers_select"
  on public.quote_messages
  for select
  using (
    exists (
      select 1
      from public.quotes q
      join public.customers c on c.id = q.customer_id
      where q.id = quote_messages.quote_id
        and c.user_id = auth.uid()
    )
  );

create policy "quote_messages_customers_insert"
  on public.quote_messages
  for insert
  with check (
    lower(sender_role) = 'customer'
    and sender_id = auth.uid()
    and exists (
      select 1
      from public.quotes q
      join public.customers c on c.id = q.customer_id
      where q.id = quote_messages.quote_id
        and c.user_id = auth.uid()
    )
  );

create policy "quote_messages_suppliers_select"
  on public.quote_messages
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
            where sb.quote_id = quote_messages.quote_id
              and sb.supplier_id = s.id
          )
          or exists (
            select 1
            from public.quote_suppliers qs
            where qs.quote_id = quote_messages.quote_id
              and qs.supplier_id = s.id
          )
          or exists (
            select 1
            from public.quotes q
            where q.id = quote_messages.quote_id
              and q.awarded_supplier_id = s.id
          )
        )
    )
  );

create policy "quote_messages_suppliers_insert"
  on public.quote_messages
  for insert
  with check (
    lower(sender_role) = 'supplier'
    and sender_id = auth.uid()
    and exists (
      select 1
      from public.suppliers s
      where s.user_id = auth.uid()
        and (
          exists (
            select 1
            from public.supplier_bids sb
            where sb.quote_id = quote_messages.quote_id
              and sb.supplier_id = s.id
          )
          or exists (
            select 1
            from public.quote_suppliers qs
            where qs.quote_id = quote_messages.quote_id
              and qs.supplier_id = s.id
          )
          or exists (
            select 1
            from public.quotes q
            where q.id = quote_messages.quote_id
              and q.awarded_supplier_id = s.id
          )
        )
    )
  );
