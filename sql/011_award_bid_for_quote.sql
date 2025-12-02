create or replace function public.award_bid_for_quote(
  p_quote_id uuid,
  p_bid_id uuid
)
returns void
language plpgsql
as $$
begin
  -- Ensure the winning bid belongs to the given quote
  if not exists (
    select 1
    from public.supplier_bids
    where id = p_bid_id
      and quote_id = p_quote_id
  ) then
    raise exception 'Bid % does not belong to quote %', p_bid_id, p_quote_id;
  end if;

  -- Mark the winning bid
  update public.supplier_bids
  set status = 'won'
  where id = p_bid_id;

  -- Mark all other bids on this quote as lost / not selected
  update public.supplier_bids
  set status = 'lost'
  where quote_id = p_quote_id
    and id <> p_bid_id
    and coalesce(status, '') <> 'lost';

  -- Mark the quote itself as won
  update public.quotes
  set status = 'won'
  where id = p_quote_id;
end;
$$;
