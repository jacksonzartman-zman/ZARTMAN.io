-- Finalize canonical award RPC signature and keep a legacy shim.
--
-- Goal:
-- - Ensure PostgREST always exposes the canonical 4-arg RPC.
-- - Keep the legacy 2-arg RPC for backwards compatibility.
-- - Prevent award integrity drift (bid must belong to quote; supplier must match).
-- - Idempotent for re-awarding the same bid.

-- Ensure the award attribution column allows a system default.
do $$
begin
  if to_regclass('public.quotes') is null then
    raise notice '[award rpc] public.quotes missing; skipping awarded_by_role constraint update';
    return;
  end if;

  -- Recreate the constraint so it supports a system default role.
  alter table public.quotes
    drop constraint if exists quotes_awarded_by_role_check;

  alter table public.quotes
    add constraint quotes_awarded_by_role_check
      check (
        awarded_by_role is null
        or awarded_by_role in ('admin', 'customer', 'system')
      );
end
$$;

-- Canonical RPC (source of truth).
create or replace function public.award_bid_for_quote(
  p_quote_id uuid,
  p_bid_id uuid,
  p_actor_user_id uuid,
  p_actor_role text
)
returns void
language plpgsql
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_supplier_id uuid;
  v_existing_awarded_bid_id uuid;
  v_existing_awarded_supplier_id uuid;
begin
  -- Lock quote row and inspect existing award state.
  select awarded_bid_id, awarded_supplier_id
  into v_existing_awarded_bid_id, v_existing_awarded_supplier_id
  from public.quotes
  where id = p_quote_id
  for update;

  if not found then
    raise exception 'quote_not_found';
  end if;

  -- Validate bid exists and belongs to the quote. Lock the bid row.
  select supplier_id
  into v_supplier_id
  from public.supplier_bids
  where id = p_bid_id
    and quote_id = p_quote_id
  for update;

  if not found then
    raise exception 'bid_mismatch';
  end if;

  if v_supplier_id is null then
    raise exception 'missing_supplier';
  end if;

  -- If already awarded, allow only idempotent re-award of the same bid.
  if v_existing_awarded_bid_id is not null then
    if v_existing_awarded_bid_id = p_bid_id then
      -- Integrity check: awarded supplier must match the bid's supplier.
      if v_existing_awarded_supplier_id is not null
        and v_existing_awarded_supplier_id is distinct from v_supplier_id
      then
        raise exception 'supplier_mismatch';
      end if;

      -- No-op success, but best-effort fill any missing award/audit fields.
      update public.quotes
      set
        status = 'won',
        awarded_bid_id = p_bid_id,
        awarded_supplier_id = coalesce(awarded_supplier_id, v_supplier_id),
        awarded_at = coalesce(awarded_at, v_now),
        awarded_by_user_id = coalesce(awarded_by_user_id, p_actor_user_id),
        awarded_by_role = coalesce(awarded_by_role, p_actor_role),
        updated_at = coalesce(updated_at, v_now)
      where id = p_quote_id;

      -- Keep bid statuses consistent (idempotent).
      update public.supplier_bids
      set
        status = 'won',
        updated_at = v_now
      where id = p_bid_id
        and coalesce(status, '') <> 'won';

      update public.supplier_bids
      set
        status = 'lost',
        updated_at = v_now
      where quote_id = p_quote_id
        and id <> p_bid_id
        and coalesce(status, '') <> 'lost';

      return;
    end if;

    raise exception 'quote_already_awarded';
  end if;

  -- Mark the winning bid + losers.
  update public.supplier_bids
  set
    status = 'won',
    updated_at = v_now
  where id = p_bid_id;

  update public.supplier_bids
  set
    status = 'lost',
    updated_at = v_now
  where quote_id = p_quote_id
    and id <> p_bid_id
    and coalesce(status, '') <> 'lost';

  -- Persist award on quote (single canonical record).
  update public.quotes
  set
    status = 'won',
    awarded_bid_id = p_bid_id,
    awarded_supplier_id = v_supplier_id,
    awarded_at = v_now,
    awarded_by_user_id = p_actor_user_id,
    awarded_by_role = p_actor_role,
    updated_at = v_now
  where id = p_quote_id;
end;
$$;

-- Legacy 2-arg shim (backwards compatible) that delegates into canonical RPC.
create or replace function public.award_bid_for_quote(
  p_bid_id uuid,
  p_quote_id uuid
)
returns void
language plpgsql
as $$
begin
  perform public.award_bid_for_quote(
    p_quote_id,
    p_bid_id,
    null,
    'system'
  );
end;
$$;

-- Ensure PostgREST picks up the function signature changes.
select pg_notify('pgrst', 'reload schema');
