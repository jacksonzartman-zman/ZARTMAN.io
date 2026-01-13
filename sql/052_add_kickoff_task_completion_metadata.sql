-- Add completion metadata to supplier kickoff checklist tasks.
-- This extends the existing `public.quote_kickoff_tasks` table (seeded on award)
-- so Admin/Supplier can see who completed what, and when.

alter table if exists public.quote_kickoff_tasks
  add column if not exists completed_at timestamptz,
  add column if not exists completed_by_user_id uuid,
  add column if not exists completed_by_role text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'quote_kickoff_tasks_completed_by_role_check'
  ) then
    alter table public.quote_kickoff_tasks
      add constraint quote_kickoff_tasks_completed_by_role_check
        check (
          completed_by_role is null
          or lower(trim(completed_by_role)) in ('admin', 'supplier', 'system')
        );
  end if;
end
$$;

-- Helpful for timeline-ish recency queries (quote scoped).
create index if not exists quote_kickoff_tasks_quote_created_at_desc_idx
  on public.quote_kickoff_tasks (quote_id, created_at desc);

-- Best-effort backfill: if a task is already completed, set completed_at from updated_at.
update public.quote_kickoff_tasks
set
  completed_at = coalesce(completed_at, updated_at),
  completed_by_role = coalesce(completed_by_role, 'supplier')
where completed is true;

-- Best-effort migration: align existing task keys to the new canonical set.
-- This preserves completion state, and avoids key collisions via `not exists` guards.

update public.quote_kickoff_tasks t
set
  task_key = 'confirm_drawing_rev',
  title = 'Confirm drawing revision / redlines',
  description = 'Confirm the correct drawing revision and any redlines before production.',
  sort_order = 3
where t.task_key = 'review-rfq'
  and not exists (
    select 1
    from public.quote_kickoff_tasks x
    where x.quote_id = t.quote_id
      and x.supplier_id = t.supplier_id
      and x.task_key = 'confirm_drawing_rev'
  );

update public.quote_kickoff_tasks t
set
  task_key = 'confirm_material_finish',
  title = 'Confirm material + finish plan',
  description = 'Align on material availability, finishing, and any outside processes.',
  sort_order = 2
where t.task_key = 'confirm-material'
  and not exists (
    select 1
    from public.quote_kickoff_tasks x
    where x.quote_id = t.quote_id
      and x.supplier_id = t.supplier_id
      and x.task_key = 'confirm_material_finish'
  );

update public.quote_kickoff_tasks t
set
  task_key = 'confirm_lead_time',
  title = 'Confirm lead time + ship date',
  description = 'Confirm lead time and target ship date so everyone can plan.',
  sort_order = 1
where t.task_key = 'confirm-start-date'
  and not exists (
    select 1
    from public.quote_kickoff_tasks x
    where x.quote_id = t.quote_id
      and x.supplier_id = t.supplier_id
      and x.task_key = 'confirm_lead_time'
  );

update public.quote_kickoff_tasks t
set
  task_key = 'confirm_shipping',
  title = 'Confirm ship-to, incoterms, packaging',
  description = 'Confirm ship-to address, incoterms, packaging, and carrier details.',
  sort_order = 5
where t.task_key = 'acknowledge-delivery'
  and not exists (
    select 1
    from public.quote_kickoff_tasks x
    where x.quote_id = t.quote_id
      and x.supplier_id = t.supplier_id
      and x.task_key = 'confirm_shipping'
  );

update public.quote_kickoff_tasks t
set
  task_key = 'confirm_qty_pricing',
  title = 'Confirm quantity + final price',
  description = 'Confirm quantities, pricing, and any final commercial details.',
  sort_order = 4
where t.task_key = 'share-dfm-clarifications'
  and not exists (
    select 1
    from public.quote_kickoff_tasks x
    where x.quote_id = t.quote_id
      and x.supplier_id = t.supplier_id
      and x.task_key = 'confirm_qty_pricing'
  );

