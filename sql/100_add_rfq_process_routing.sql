-- Phase 100: Basic RFQ routing based on manufacturing process.
--
-- When a quote (RFQ) is created or the associated upload's `manufacturing_process`
-- is updated, automatically create `rfq_destinations` rows for providers whose
-- `providers.processes` overlap the requested processes.
--
-- Respects `customer_exclusions` (provider-based) when present.

-- Ensure new routing status is allowed.
alter table public.rfq_destinations
  drop constraint if exists rfq_destinations_status_check;

alter table public.rfq_destinations
  add constraint rfq_destinations_status_check
    check (
      status in (
        'draft',
        'pending',
        'queued',
        'sent',
        'submitted',
        'viewed',
        'quoted',
        'declined',
        'error'
      )
    );

create or replace function public.route_rfq_destinations_for_quote(quote_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_upload_id uuid;
  v_customer_id uuid;
  v_process_csv text;
  v_processes text[];
  v_inserted int := 0;
  v_has_customer_exclusions boolean := false;
begin
  select q.upload_id, q.customer_id
    into v_upload_id, v_customer_id
  from public.quotes q
  where q.id = quote_id;

  if v_upload_id is null then
    return 0;
  end if;

  select u.manufacturing_process
    into v_process_csv
  from public.uploads u
  where u.id = v_upload_id;

  if v_process_csv is null or btrim(v_process_csv) = '' then
    return 0;
  end if;

  -- Normalize to a de-duped lowercase text[] from comma-separated input.
  -- Handles both "cnc,3dp" and single values like "CNC".
  v_processes := array_remove(
    array(
      select distinct nullif(btrim(lower(x)), '')
      from unnest(regexp_split_to_array(v_process_csv, '\s*,\s*')) as x
    ),
    null
  );

  if v_processes is null or array_length(v_processes, 1) is null then
    return 0;
  end if;

  -- Optional table guard (some deployments may not include exclusions).
  v_has_customer_exclusions := to_regclass('public.customer_exclusions') is not null;

  insert into public.rfq_destinations (rfq_id, provider_id, status, last_status_at)
  select quote_id, p.id, 'pending', now()
  from public.providers p
  where p.is_active is true
    and p.processes is not null
    and p.processes && v_processes
    and (
      v_has_customer_exclusions is false
      or v_customer_id is null
      or not exists (
        select 1
        from public.customer_exclusions ce
        where ce.customer_id = v_customer_id
          and ce.excluded_provider_id = p.id
      )
    )
  on conflict (rfq_id, provider_id) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

create or replace function public.trigger_route_rfq_destinations_on_quote_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.route_rfq_destinations_for_quote(new.id);
  return new;
end;
$$;

drop trigger if exists route_rfq_destinations_on_quote_insert on public.quotes;
create trigger route_rfq_destinations_on_quote_insert
after insert on public.quotes
for each row execute function public.trigger_route_rfq_destinations_on_quote_insert();

create or replace function public.trigger_route_rfq_destinations_on_upload_process_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  if new.manufacturing_process is distinct from old.manufacturing_process then
    for r in
      select q.id
      from public.quotes q
      where q.upload_id = new.id
    loop
      perform public.route_rfq_destinations_for_quote(r.id);
    end loop;
  end if;

  return new;
end;
$$;

drop trigger if exists route_rfq_destinations_on_upload_process_update on public.uploads;
create trigger route_rfq_destinations_on_upload_process_update
after update of manufacturing_process on public.uploads
for each row execute function public.trigger_route_rfq_destinations_on_upload_process_update();

notify pgrst, 'reload schema';

