-- Phase 18.2 — Kickoff tasks: RLS-safe reads/writes + completion columns
--
-- Notes:
-- - This repo historically used `quote_kickoff_tasks` as a supplier-scoped checklist.
-- - Phase 18.2.1 introduced a quote-level table (status-based) under the same name.
-- - This migration is defensive: it only applies to the quote-level shape (has `status`
--   and does NOT have `supplier_id`).
-- - All changes are written to be re-runnable.
--
-- Goal:
-- - Ensure the quote-level kickoff tasks table supports completion metadata:
--   completed, completed_at, completed_by_user_id, completed_by_role
-- - Add minimal RLS policies so customers + winning suppliers can read/update tasks.
--
do $$
begin
  if to_regclass('public.quote_kickoff_tasks') is null then
    -- Nothing to do.
    return;
  end if;

  -- Only apply to the quote-level table variant (Phase 18.2.1+):
  -- - Has `status` column
  -- - Does NOT have `supplier_id` column
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'quote_kickoff_tasks'
      and column_name = 'status'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'quote_kickoff_tasks'
      and column_name = 'supplier_id'
  ) then
    -- Completion metadata columns (idempotent).
    alter table public.quote_kickoff_tasks
      add column if not exists completed_at timestamptz,
      add column if not exists completed_by_user_id uuid,
      add column if not exists completed_by_role text;

    -- Ensure a simple `completed` boolean exists for callers that prefer it.
    -- Keep it derived from status/completed_at to avoid drift.
    alter table public.quote_kickoff_tasks
      add column if not exists completed boolean
        generated always as (
          (completed_at is not null) or (lower(trim(status)) = 'complete')
        ) stored;

    -- Allow customer in completed_by_role (and keep legacy values).
    alter table public.quote_kickoff_tasks
      drop constraint if exists quote_kickoff_tasks_completed_by_role_check;
    alter table public.quote_kickoff_tasks
      add constraint quote_kickoff_tasks_completed_by_role_check
        check (
          completed_by_role is null
          or lower(trim(completed_by_role)) in ('admin', 'supplier', 'customer', 'system')
        );

    -- Ensure unique constraint exists (quote_id, task_key) for easy upserts.
    if not exists (
      select 1
      from pg_constraint
      where conname = 'quote_kickoff_tasks_unique_quote_task_key'
    ) then
      alter table public.quote_kickoff_tasks
        add constraint quote_kickoff_tasks_unique_quote_task_key unique (quote_id, task_key);
    end if;

    -- RLS policies (minimal, readable, and consistent with existing quote_messages policies).
    alter table public.quote_kickoff_tasks enable row level security;

    drop policy if exists "quote_kickoff_tasks_service_role_manage" on public.quote_kickoff_tasks;
    create policy "quote_kickoff_tasks_service_role_manage"
      on public.quote_kickoff_tasks
      for all
      using (auth.role() = 'service_role')
      with check (auth.role() = 'service_role');

    -- Customers: only the owning customer (quotes.customer_id -> customers.user_id).
    drop policy if exists "quote_kickoff_tasks_customers_select" on public.quote_kickoff_tasks;
    create policy "quote_kickoff_tasks_customers_select"
      on public.quote_kickoff_tasks
      for select
      using (
        exists (
          select 1
          from public.quotes q
          join public.customers c on c.id = q.customer_id
          where q.id = quote_kickoff_tasks.quote_id
            and c.user_id = auth.uid()
        )
      );

    drop policy if exists "quote_kickoff_tasks_customers_insert" on public.quote_kickoff_tasks;
    create policy "quote_kickoff_tasks_customers_insert"
      on public.quote_kickoff_tasks
      for insert
      with check (
        exists (
          select 1
          from public.quotes q
          join public.customers c on c.id = q.customer_id
          where q.id = quote_kickoff_tasks.quote_id
            and c.user_id = auth.uid()
        )
        and (completed_by_user_id is null or completed_by_user_id = auth.uid())
        and (completed_by_role is null or lower(trim(completed_by_role)) = 'customer')
      );

    drop policy if exists "quote_kickoff_tasks_customers_update" on public.quote_kickoff_tasks;
    create policy "quote_kickoff_tasks_customers_update"
      on public.quote_kickoff_tasks
      for update
      using (
        exists (
          select 1
          from public.quotes q
          join public.customers c on c.id = q.customer_id
          where q.id = quote_kickoff_tasks.quote_id
            and c.user_id = auth.uid()
        )
      )
      with check (
        exists (
          select 1
          from public.quotes q
          join public.customers c on c.id = q.customer_id
          where q.id = quote_kickoff_tasks.quote_id
            and c.user_id = auth.uid()
        )
        and (completed_by_user_id is null or completed_by_user_id = auth.uid())
        and (completed_by_role is null or lower(trim(completed_by_role)) = 'customer')
      );

    -- Suppliers: winner-only (quotes.awarded_supplier_id -> suppliers.user_id).
    drop policy if exists "quote_kickoff_tasks_suppliers_select" on public.quote_kickoff_tasks;
    create policy "quote_kickoff_tasks_suppliers_select"
      on public.quote_kickoff_tasks
      for select
      using (
        exists (
          select 1
          from public.suppliers s
          join public.quotes q on q.awarded_supplier_id = s.id
          where q.id = quote_kickoff_tasks.quote_id
            and s.user_id = auth.uid()
        )
      );

    drop policy if exists "quote_kickoff_tasks_suppliers_insert" on public.quote_kickoff_tasks;
    create policy "quote_kickoff_tasks_suppliers_insert"
      on public.quote_kickoff_tasks
      for insert
      with check (
        exists (
          select 1
          from public.suppliers s
          join public.quotes q on q.awarded_supplier_id = s.id
          where q.id = quote_kickoff_tasks.quote_id
            and s.user_id = auth.uid()
        )
        and (completed_by_user_id is null or completed_by_user_id = auth.uid())
        and (completed_by_role is null or lower(trim(completed_by_role)) = 'supplier')
      );

    drop policy if exists "quote_kickoff_tasks_suppliers_update" on public.quote_kickoff_tasks;
    create policy "quote_kickoff_tasks_suppliers_update"
      on public.quote_kickoff_tasks
      for update
      using (
        exists (
          select 1
          from public.suppliers s
          join public.quotes q on q.awarded_supplier_id = s.id
          where q.id = quote_kickoff_tasks.quote_id
            and s.user_id = auth.uid()
        )
      )
      with check (
        exists (
          select 1
          from public.suppliers s
          join public.quotes q on q.awarded_supplier_id = s.id
          where q.id = quote_kickoff_tasks.quote_id
            and s.user_id = auth.uid()
        )
        and (completed_by_user_id is null or completed_by_user_id = auth.uid())
        and (completed_by_role is null or lower(trim(completed_by_role)) = 'supplier')
      );
  end if;
end $$;

select pg_notify('pgrst', 'reload schema');

