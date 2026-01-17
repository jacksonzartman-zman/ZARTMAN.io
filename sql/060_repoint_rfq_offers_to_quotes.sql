-- Phase 21.1: Keep RFQ offers anchored to canonical public.quotes.

do $$
begin
  if to_regclass('public.rfq_offers') is null then
    raise notice '[rfq offers] public.rfq_offers missing; skipping FK updates';
    return;
  end if;

  alter table public.rfq_offers
    drop constraint if exists rfq_offers_rfq_id_fkey;

  if to_regclass('public.quotes') is null then
    raise notice '[rfq offers] public.quotes missing; skipping FK add';
  else
    alter table public.rfq_offers
      add constraint rfq_offers_rfq_id_fkey
      foreign key (rfq_id) references public.quotes(id) on delete cascade;
  end if;
end
$$;

-- Optional cleanup: drop public.rfqs if no longer referenced.
do $$
begin
  if to_regclass('public.rfqs') is null then
    return;
  end if;

  if exists (
    select 1
    from pg_constraint
    where confrelid = 'public.rfqs'::regclass
  ) then
    raise notice '[rfqs cleanup] foreign keys still reference public.rfqs; skipping drop';
    return;
  end if;

  begin
    drop table public.rfqs;
    raise notice '[rfqs cleanup] dropped unused public.rfqs table';
  exception
    when dependent_objects_still_exist then
      raise notice '[rfqs cleanup] dependencies detected; skipping drop';
  end;
end
$$;

notify pgrst, 'reload schema';
