-- Adds award audit fields, indexes, backfill, and guardrails for winner selection.

alter table if exists public.quotes
  add column if not exists awarded_bid_id uuid
    references public.supplier_bids(id)
    on delete set null;

alter table if exists public.quotes
  add column if not exists awarded_supplier_id uuid
    references public.suppliers(id)
    on delete set null;

alter table if exists public.quotes
  add column if not exists awarded_at timestamptz;

alter table if exists public.quotes
  add column if not exists awarded_by_user_id uuid;

alter table if exists public.quotes
  add column if not exists awarded_by_role text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'quotes_awarded_by_role_check'
  ) then
    alter table public.quotes
      add constraint quotes_awarded_by_role_check
        check (awarded_by_role in ('customer', 'admin'));
  end if;
end
$$;

create index if not exists quotes_awarded_at_idx
  on public.quotes (awarded_at);

create index if not exists quotes_awarded_supplier_id_idx
  on public.quotes (awarded_supplier_id);

create index if not exists quotes_awarded_bid_id_idx
  on public.quotes (awarded_bid_id);

-- Backfill quotes that already have an unambiguous winning bid state.
with winner_candidates as (
  select
    id as bid_id,
    quote_id,
    supplier_id,
    coalesce(updated_at, created_at, timezone('utc', now())) as award_source_at
  from public.supplier_bids
  where status in ('won', 'winner', 'accepted', 'approved')
),
unique_winners as (
  select quote_id
  from winner_candidates
  group by quote_id
  having count(*) = 1
),
winner_rows as (
  select wc.*
  from winner_candidates wc
  inner join unique_winners uw on uw.quote_id = wc.quote_id
)
update public.quotes as q
set
  awarded_bid_id = coalesce(q.awarded_bid_id, wr.bid_id),
  awarded_supplier_id = coalesce(q.awarded_supplier_id, wr.supplier_id),
  awarded_at = coalesce(q.awarded_at, wr.award_source_at)
from winner_rows wr
where q.id = wr.quote_id
  and q.awarded_bid_id is null
  and wr.supplier_id is not null;

-- Replace the award function with a version that also writes audit fields
-- and guards against duplicate winners.
drop function if exists public.award_bid_for_quote(uuid, uuid);

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
  v_existing_award uuid;
begin
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
