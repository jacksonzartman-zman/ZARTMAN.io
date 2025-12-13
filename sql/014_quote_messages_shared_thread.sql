-- Strengthen quote_messages so every quote shares a single realtime-safe thread.

-- Rename legacy author_type column to sender_role if needed.
do
$$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'quote_messages'
      and column_name = 'author_type'
  )
  and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'quote_messages'
      and column_name = 'sender_role'
  ) then
    execute 'alter table public.quote_messages rename column author_type to sender_role';
  end if;
end
$$;

-- Rename author_name -> sender_name if needed.
do
$$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'quote_messages'
      and column_name = 'author_name'
  )
  and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'quote_messages'
      and column_name = 'sender_name'
  ) then
    execute 'alter table public.quote_messages rename column author_name to sender_name';
  end if;
end
$$;

-- Rename author_email -> sender_email if needed.
do
$$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'quote_messages'
      and column_name = 'author_email'
  )
  and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'quote_messages'
      and column_name = 'sender_email'
  ) then
    execute 'alter table public.quote_messages rename column author_email to sender_email';
  end if;
end
$$;

alter table if exists public.quote_messages
  add column if not exists sender_role text;

update public.quote_messages
set sender_role = lower(coalesce(sender_role, 'admin'))
where sender_role is null;

alter table if exists public.quote_messages
  alter column sender_role set not null;

alter table if exists public.quote_messages
  drop constraint if exists quote_messages_sender_role_check;

alter table if exists public.quote_messages
  add constraint quote_messages_sender_role_check
    check (char_length(trim(sender_role)) > 0);

alter table if exists public.quote_messages
  add column if not exists sender_id uuid default gen_random_uuid();

update public.quote_messages
set sender_id = gen_random_uuid()
where sender_id is null;

alter table if exists public.quote_messages
  alter column sender_id set not null;

alter table if exists public.quote_messages
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

alter table if exists public.quote_messages
  add column if not exists sender_name text;

alter table if exists public.quote_messages
  add column if not exists sender_email text;

alter table if exists public.quote_messages
  alter column created_at set default timezone('utc', now());

alter table if exists public.quote_messages
  drop constraint if exists quote_messages_body_not_empty;

alter table if exists public.quote_messages
  add constraint quote_messages_body_not_empty
    check (char_length(trim(body)) > 0);

do
$$
begin
  if to_regclass('public.quote_messages_quote_id_created_idx') is not null
     and to_regclass('public.quote_messages_quote_id_created_at_idx') is null then
    execute 'alter index public.quote_messages_quote_id_created_idx rename to quote_messages_quote_id_created_at_idx';
  end if;
end
$$;

create index if not exists quote_messages_quote_id_created_at_idx
  on public.quote_messages (quote_id, created_at desc);

create index if not exists quote_messages_sender_idx
  on public.quote_messages (sender_id, sender_role);

comment on table public.quote_messages is
  'Single shared message thread for each quote across customer/supplier/admin portals.';

alter table if exists public.quote_messages enable row level security;

drop policy if exists "quote_messages_customers_select" on public.quote_messages;
drop policy if exists "quote_messages_customers_insert" on public.quote_messages;
drop policy if exists "quote_messages_suppliers_select" on public.quote_messages;
drop policy if exists "quote_messages_suppliers_insert" on public.quote_messages;
drop policy if exists "quote_messages_admins_manage" on public.quote_messages;
drop policy if exists "quote_messages_service_role_manage" on public.quote_messages;
drop policy if exists "quote_messages_admins_all" on public.quote_messages;

create policy "quote_messages_service_role_manage"
  on public.quote_messages
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "quote_messages_admins_all"
  on public.quote_messages
  for all
  using (
    lower(coalesce(auth.jwt()->> 'email', '')) like '%@zartman.%'
  )
  with check (
    lower(coalesce(auth.jwt()->> 'email', '')) like '%@zartman.%'
  );

create policy "quote_messages_customers_select"
  on public.quote_messages
  for select
  using (
    exists (
      select 1
      from public.quotes q
      left join public.customers c on c.id = q.customer_id
      where q.id = quote_messages.quote_id
        and (
          (c.user_id is not null and c.user_id = auth.uid())
          or (
            q.customer_email is not null
            and trim(q.customer_email) <> ''
            and lower(q.customer_email) = lower(coalesce(auth.jwt()->> 'email', ''))
          )
        )
    )
  );

create policy "quote_messages_customers_insert"
  on public.quote_messages
  for insert
  with check (
    lower(sender_role) = 'customer'
    and sender_id = auth.uid()
    and exists (
      select 1
      from public.quotes q
      left join public.customers c on c.id = q.customer_id
      where q.id = quote_messages.quote_id
        and (
          (c.user_id is not null and c.user_id = auth.uid())
          or (
            q.customer_email is not null
            and trim(q.customer_email) <> ''
            and lower(q.customer_email) = lower(coalesce(auth.jwt()->> 'email', ''))
          )
        )
    )
  );

create policy "quote_messages_suppliers_select"
  on public.quote_messages
  for select
  using (
    exists (
      select 1
      from public.supplier_bids sb
      join public.suppliers s on s.id = sb.supplier_id
      where sb.quote_id = quote_messages.quote_id
        and (
          (s.user_id is not null and s.user_id = auth.uid())
          or (
            s.primary_email is not null
            and trim(s.primary_email) <> ''
            and lower(s.primary_email) = lower(coalesce(auth.jwt()->> 'email', ''))
          )
        )
    )
  );

create policy "quote_messages_suppliers_insert"
  on public.quote_messages
  for insert
  with check (
    lower(sender_role) = 'supplier'
    and sender_id = auth.uid()
    and exists (
      select 1
      from public.supplier_bids sb
      join public.suppliers s on s.id = sb.supplier_id
      where sb.quote_id = quote_messages.quote_id
        and (
          (s.user_id is not null and s.user_id = auth.uid())
          or (
            s.primary_email is not null
            and trim(s.primary_email) <> ''
            and lower(s.primary_email) = lower(coalesce(auth.jwt()->> 'email', ''))
          )
        )
    )
  );
