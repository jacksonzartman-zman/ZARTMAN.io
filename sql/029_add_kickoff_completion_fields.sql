-- Track kickoff completion on the quote itself.
--
-- Adds:
-- - kickoff_completed_at timestamptz
-- - kickoff_completed_by_user_id uuid
-- - kickoff_completed_by_role text
--
-- Enforces:
-- - kickoff completion fields are all-or-nothing
-- - kickoff_completed_by_role is one of: supplier/admin/customer/system (when set)

alter table if exists public.quotes
  add column if not exists kickoff_completed_at timestamptz null;

alter table if exists public.quotes
  add column if not exists kickoff_completed_by_user_id uuid null;

alter table if exists public.quotes
  add column if not exists kickoff_completed_by_role text null;

-- All-or-nothing invariant (safe to rerun).
do $$
begin
  if to_regclass('public.quotes') is null then
    raise notice '[kickoff completion] public.quotes missing; skipping constraints';
    return;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'quotes_kickoff_completion_all_or_nothing'
  ) then
    alter table public.quotes
      add constraint quotes_kickoff_completion_all_or_nothing
      check (
        num_nonnulls(kickoff_completed_at, kickoff_completed_by_user_id, kickoff_completed_by_role) in (0, 3)
      ) not valid;

    alter table public.quotes
      validate constraint quotes_kickoff_completion_all_or_nothing;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'quotes_kickoff_completed_by_role_allowed'
  ) then
    alter table public.quotes
      add constraint quotes_kickoff_completed_by_role_allowed
      check (
        kickoff_completed_by_role is null
        or kickoff_completed_by_role in ('supplier', 'admin', 'customer', 'system')
      ) not valid;

    alter table public.quotes
      validate constraint quotes_kickoff_completed_by_role_allowed;
  end if;
end $$;

create index if not exists quotes_kickoff_completed_at_idx
  on public.quotes (kickoff_completed_at);

select pg_notify('pgrst', 'reload schema');
