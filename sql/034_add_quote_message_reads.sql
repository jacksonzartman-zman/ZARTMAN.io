-- Track per-user quote message read positions (MVP).

create table if not exists public.quote_message_reads (
  quote_id uuid not null references public.quotes(id) on delete cascade,
  user_id uuid not null,
  last_read_at timestamptz not null default timezone('utc', now()),
  primary key (quote_id, user_id)
);

create index if not exists quote_message_reads_user_id_idx
  on public.quote_message_reads (user_id, last_read_at desc);

alter table if exists public.quote_message_reads enable row level security;

drop policy if exists "quote_message_reads_service_role_manage" on public.quote_message_reads;
create policy "quote_message_reads_service_role_manage"
  on public.quote_message_reads
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "quote_message_reads_user_manage" on public.quote_message_reads;
create policy "quote_message_reads_user_manage"
  on public.quote_message_reads
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

