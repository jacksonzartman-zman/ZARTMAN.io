-- Enforce award invariants for quotes:
-- 1) Award fields are all-or-nothing (bid, supplier, timestamp).
-- 2) If quote status is a win state ('won' canonical; optionally legacy 'win'), award fields must be present.
-- 3) Best-effort backfill for existing violating rows (do not overwrite awards when present).
-- 4) Harden award RPC(s) so awarding cannot produce invalid states.
--
-- Notes:
-- - Avoids DROP VIEW / CASCADE.
-- - Does not introduce SECURITY DEFINER.
-- - Uses a TEMP table to log any rows we couldn't fix reliably.

-- Temp log table for inspection during migration execution.
create temporary table if not exists violated_quotes (
  quote_id uuid primary key,
  reason text not null,
  details jsonb null
) on commit drop;

-- Best-effort remediation for existing data. Keep this block safe and idempotent.
do $$
declare
  v_now timestamptz := timezone('utc', now());
begin
  if to_regclass('public.quotes') is null then
    raise notice '[award invariants] public.quotes missing; skipping';
    return;
  end if;

  -- Step 1: fix partial awards when we can derive missing fields from awarded_bid_id.
  if to_regclass('public.supplier_bids') is not null then
    update public.quotes q
    set
      awarded_supplier_id = coalesce(q.awarded_supplier_id, sb.supplier_id),
      awarded_at = coalesce(q.awarded_at, q.updated_at, sb.updated_at, sb.created_at, v_now)
    from public.supplier_bids sb
    where q.awarded_bid_id is not null
      and sb.id = q.awarded_bid_id
      and sb.quote_id = q.id
      and sb.supplier_id is not null
      and (
        q.awarded_supplier_id is null
        or q.awarded_at is null
      );

    -- Step 2: if awarded_supplier_id is set but awarded_bid_id is missing, only fill if unambiguous.
    with supplier_bid_candidates as (
      select
        q.id as quote_id,
        sb.id as bid_id,
        sb.supplier_id,
        coalesce(sb.updated_at, sb.created_at, v_now) as source_at
      from public.quotes q
      join public.supplier_bids sb
        on sb.quote_id = q.id
       and sb.supplier_id = q.awarded_supplier_id
      where q.awarded_supplier_id is not null
        and q.awarded_bid_id is null
    ),
    unambiguous as (
      select quote_id
      from supplier_bid_candidates
      group by quote_id
      having count(*) = 1
    ),
    chosen as (
      select c.*
      from supplier_bid_candidates c
      join unambiguous u on u.quote_id = c.quote_id
    )
    update public.quotes q
    set
      awarded_bid_id = coalesce(q.awarded_bid_id, chosen.bid_id),
      awarded_at = coalesce(q.awarded_at, q.updated_at, chosen.source_at, v_now)
    from chosen
    where q.id = chosen.quote_id
      and q.awarded_bid_id is null;
  end if;

  -- Step 1b: if bid + supplier are present but awarded_at is missing, fill it without guessing.
  update public.quotes q
  set
    awarded_at = coalesce(q.awarded_at, q.updated_at, v_now)
  where q.awarded_bid_id is not null
    and q.awarded_supplier_id is not null
    and q.awarded_at is null;

  -- Step 3: backfill missing awards for won quotes with awarded_bid_id missing.
  if to_regclass('public.supplier_bids') is not null then
    with target_quotes as (
      select q.id, q.status, q.updated_at
      from public.quotes q
      where lower(coalesce(q.status, '')) in ('won', 'win')
        and (q.awarded_bid_id is null or q.awarded_supplier_id is null or q.awarded_at is null)
    ),
    -- Prefer bids whose status indicates a winner.
    winner_status_candidates as (
      select
        tq.id as quote_id,
        sb.id as bid_id,
        sb.supplier_id,
        coalesce(sb.updated_at, sb.created_at, tq.updated_at, v_now) as source_at
      from target_quotes tq
      join public.supplier_bids sb on sb.quote_id = tq.id
      where sb.supplier_id is not null
        and lower(coalesce(sb.status, '')) in ('won', 'winner', 'accepted', 'approved')
    ),
    unique_winner_quotes as (
      select quote_id
      from winner_status_candidates
      group by quote_id
      having count(*) = 1
    ),
    chosen_winner_status as (
      select c.*
      from winner_status_candidates c
      join unique_winner_quotes u on u.quote_id = c.quote_id
    ),
    -- Fallback: pick most recently updated bid for the quote (deterministic).
    latest_bid_candidates as (
      select
        tq.id as quote_id,
        sb.id as bid_id,
        sb.supplier_id,
        coalesce(sb.updated_at, sb.created_at, tq.updated_at, v_now) as source_at,
        row_number() over (
          partition by tq.id
          order by coalesce(sb.updated_at, sb.created_at) desc nulls last, sb.id desc
        ) as rn
      from target_quotes tq
      join public.supplier_bids sb on sb.quote_id = tq.id
      where sb.supplier_id is not null
        and not exists (select 1 from chosen_winner_status w where w.quote_id = tq.id)
    ),
    chosen_latest as (
      select * from latest_bid_candidates where rn = 1
    ),
    chosen as (
      select * from chosen_winner_status
      union all
      select quote_id, bid_id, supplier_id, source_at from chosen_latest
    )
    update public.quotes q
    set
      awarded_bid_id = coalesce(q.awarded_bid_id, chosen.bid_id),
      awarded_supplier_id = coalesce(q.awarded_supplier_id, chosen.supplier_id),
      awarded_at = coalesce(q.awarded_at, chosen.source_at, v_now)
    from chosen
    where q.id = chosen.quote_id
      and lower(coalesce(q.status, '')) in ('won', 'win')
      and (q.awarded_bid_id is null or q.awarded_supplier_id is null or q.awarded_at is null);
  end if;

  -- Step 4: anything still violating (won but missing award) -> downgrade to in_review and log.
  insert into violated_quotes (quote_id, reason, details)
  select
    q.id,
    'won_missing_award_fields',
    jsonb_build_object(
      'status', q.status,
      'awarded_bid_id', q.awarded_bid_id,
      'awarded_supplier_id', q.awarded_supplier_id,
      'awarded_at', q.awarded_at
    )
  from public.quotes q
  where lower(coalesce(q.status, '')) in ('won', 'win')
    and (
      q.awarded_bid_id is null
      or q.awarded_supplier_id is null
      or q.awarded_at is null
    )
  on conflict (quote_id) do nothing;

  update public.quotes q
  set
    status = 'in_review',
    updated_at = coalesce(q.updated_at, v_now)
  where lower(coalesce(q.status, '')) in ('won', 'win')
    and (
      q.awarded_bid_id is null
      or q.awarded_supplier_id is null
      or q.awarded_at is null
    );

  -- Step 5: partial awards (all-or-nothing violation) that we couldn't fix -> clear awards and log.
  insert into violated_quotes (quote_id, reason, details)
  select
    q.id,
    'partial_award_cleared',
    jsonb_build_object(
      'status', q.status,
      'awarded_bid_id', q.awarded_bid_id,
      'awarded_supplier_id', q.awarded_supplier_id,
      'awarded_at', q.awarded_at
    )
  from public.quotes q
  where (
      (q.awarded_bid_id is null and q.awarded_supplier_id is not null)
   or (q.awarded_bid_id is not null and q.awarded_supplier_id is null)
   or (q.awarded_at is null and (q.awarded_bid_id is not null or q.awarded_supplier_id is not null))
  )
  on conflict (quote_id) do nothing;

  update public.quotes q
  set
    awarded_bid_id = null,
    awarded_supplier_id = null,
    awarded_at = null,
    status = case
      when lower(coalesce(q.status, '')) in ('won', 'win') then 'in_review'
      else q.status
    end,
    updated_at = coalesce(q.updated_at, v_now)
  where (
      (q.awarded_bid_id is null and q.awarded_supplier_id is not null)
   or (q.awarded_bid_id is not null and q.awarded_supplier_id is null)
   or (q.awarded_at is null and (q.awarded_bid_id is not null or q.awarded_supplier_id is not null))
  );
end
$$;

-- Harden award RPCs so they always write award fields + status together (compatible with the new CHECK).
create or replace function public.award_bid_for_quote(
  p_quote_id uuid,
  p_bid_id uuid,
  p_actor_user_id uuid default null,
  p_actor_role text default null
)
returns void
language plpgsql
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_supplier_id uuid;
  v_existing_award uuid;
begin
  -- Lock and check quote.
  select awarded_bid_id
  into v_existing_award
  from public.quotes
  where id = p_quote_id
  for update;

  if not found then
    raise exception 'quote_not_found';
  end if;

  if v_existing_award is not null then
    raise exception 'quote_already_awarded';
  end if;

  -- Validate bid belongs to quote and has supplier.
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
    awarded_by_user_id = coalesce(awarded_by_user_id, p_actor_user_id),
    awarded_by_role = coalesce(awarded_by_role, p_actor_role),
    updated_at = v_now
  where id = p_quote_id;
end;
$$;

-- Keep legacy 2-arg signature compatible: delegate into canonical function.
create or replace function public.award_bid_for_quote(
  p_quote_id uuid,
  p_bid_id uuid
)
returns void
language plpgsql
as $$
begin
  perform public.award_bid_for_quote(p_quote_id, p_bid_id, null, null);
end;
$$;

-- Add CHECK constraint (idempotent). Use NOT VALID then validate after backfill.
do $$
begin
  if to_regclass('public.quotes') is null then
    raise notice '[award invariants] public.quotes missing; skipping constraint';
    return;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'quotes_award_invariants_check'
      and conrelid = 'public.quotes'::regclass
  ) then
    alter table public.quotes
      add constraint quotes_award_invariants_check
      check (
        (
          (awarded_bid_id is null and awarded_supplier_id is null and awarded_at is null)
          or
          (awarded_bid_id is not null and awarded_supplier_id is not null and awarded_at is not null)
        )
        and
        (
          lower(coalesce(status, '')) not in ('won', 'win')
          or
          (awarded_bid_id is not null and awarded_supplier_id is not null and awarded_at is not null)
        )
      ) not valid;
  end if;

  -- Validate to ensure existing rows comply after remediation.
  alter table public.quotes validate constraint quotes_award_invariants_check;
end
$$;

-- Ensure PostgREST picks up the constraint/function changes.
select pg_notify('pgrst', 'reload schema');

