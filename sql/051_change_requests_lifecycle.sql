-- Phase 16.6 — Admin "Change Requests Inbox": lifecycle tracking

-- Add lifecycle columns (safe / idempotent).
alter table if exists public.quote_change_requests
  add column if not exists resolved_at timestamptz null;

alter table if exists public.quote_change_requests
  add column if not exists resolved_by_user_id uuid null;

alter table if exists public.quote_change_requests
  add column if not exists admin_notes text null;

-- Ensure status is present + normalized.
alter table if exists public.quote_change_requests
  add column if not exists status text not null default 'open';

alter table if exists public.quote_change_requests
  alter column status set default 'open';

-- Backfill / normalize unexpected historical values before tightening the constraint.
update public.quote_change_requests
set status = 'open'
where status is null
   or lower(btrim(status)) not in ('open', 'resolved');

alter table if exists public.quote_change_requests
  alter column status set not null;

-- Tighten status values to the lifecycle enum.
do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'quote_change_requests'
      and c.conname = 'quote_change_requests_status_lifecycle_check'
  ) then
    execute $sql$
      alter table public.quote_change_requests
        add constraint quote_change_requests_status_lifecycle_check
        check (status in ('open', 'resolved'))
    $sql$;
  end if;
end
$$;

-- Indexes for admin inbox queries.
create index if not exists quote_change_requests_status_created_at_idx
  on public.quote_change_requests (status, created_at desc);

create index if not exists quote_change_requests_quote_id_created_at_idx
  on public.quote_change_requests (quote_id, created_at desc);

