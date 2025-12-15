-- Adds the newer award_bid_for_quote signature (with actor params) to match app RPC calls.
-- Delegates to the legacy function award_bid_for_quote(p_bid_id, p_quote_id).
-- Backfills award audit fields on quotes when missing.
--
-- Safe: does not drop/replace the legacy signature.

create or replace function public.award_bid_for_quote(
  p_quote_id uuid,
  p_bid_id uuid,
  p_actor_user_id uuid default null,
  p_actor_role text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Call the legacy implementation (already exists in this DB).
  perform public.award_bid_for_quote(p_bid_id, p_quote_id);

  -- Best-effort audit attribution: only fill missing fields.
  if p_actor_user_id is not null or p_actor_role is not null then
    update public.quotes
    set
      awarded_by_user_id = coalesce(awarded_by_user_id, p_actor_user_id),
      awarded_by_role    = coalesce(awarded_by_role, p_actor_role)
    where id = p_quote_id;
  end if;
end;
$$;

-- Lock down execution privileges.
revoke all on function public.award_bid_for_quote(uuid, uuid, uuid, text) from public;
revoke all on function public.award_bid_for_quote(uuid, uuid, uuid, text) from anon;

grant execute on function public.award_bid_for_quote(uuid, uuid, uuid, text) to authenticated;
grant execute on function public.award_bid_for_quote(uuid, uuid, uuid, text) to service_role;

-- Ensure PostgREST picks up the new function signature.
select pg_notify('pgrst', 'reload schema');
