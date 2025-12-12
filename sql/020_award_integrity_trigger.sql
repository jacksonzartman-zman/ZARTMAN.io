-- Gap 6 hardening: prevent mismatched award fields on public.quotes.
--
-- Enforces:
-- - awarded_bid_id must belong to the same quote_id (quotes.id)
-- - awarded_supplier_id must match the bid's supplier_id
-- - if either awarded_* field is set, both must be set (canonical award pair)
--
-- Note: the canonical write path is `public.award_bid_for_quote(...)`, but this
-- trigger guards against future manual updates / scripts.

create or replace function public.enforce_quote_award_integrity()
returns trigger
language plpgsql
as $$
declare
  v_bid_quote_id uuid;
  v_bid_supplier_id uuid;
begin
  -- Guard for partial environments (schema drift): if bids table is missing,
  -- don't block writes. This matches existing "schema-missing" safety patterns.
  if to_regclass('public.supplier_bids') is null then
    return new;
  end if;

  -- Allow un-award (all cleared).
  if new.awarded_bid_id is null and new.awarded_supplier_id is null then
    return new;
  end if;

  -- Enforce the canonical pairing (avoid half-awards).
  if new.awarded_bid_id is null and new.awarded_supplier_id is not null then
    raise exception 'award_bid_required';
  end if;
  if new.awarded_bid_id is not null and new.awarded_supplier_id is null then
    raise exception 'award_supplier_required';
  end if;

  select sb.quote_id, sb.supplier_id
  into v_bid_quote_id, v_bid_supplier_id
  from public.supplier_bids sb
  where sb.id = new.awarded_bid_id;

  if not found then
    raise exception 'award_bid_not_found';
  end if;

  if v_bid_quote_id is distinct from new.id then
    raise exception 'award_bid_quote_mismatch';
  end if;

  if v_bid_supplier_id is null then
    raise exception 'award_bid_missing_supplier';
  end if;

  if v_bid_supplier_id is distinct from new.awarded_supplier_id then
    raise exception 'award_supplier_mismatch';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_quote_award_integrity_trigger on public.quotes;

create trigger enforce_quote_award_integrity_trigger
before insert or update of awarded_bid_id, awarded_supplier_id
on public.quotes
for each row
execute function public.enforce_quote_award_integrity();

