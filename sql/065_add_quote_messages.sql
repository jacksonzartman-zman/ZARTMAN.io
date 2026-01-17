-- Phase C3: unified quote messaging schema.

create table if not exists public.quote_messages (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  author_role text not null
    constraint quote_messages_author_role_check
      check (author_role in ('customer', 'admin', 'provider')),
  author_user_id uuid null,
  provider_id uuid null references public.providers(id) on delete set null,
  message text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz null
);

-- Keep legacy columns in sync with the unified schema.
create or replace function public.quote_messages_sync_legacy_fields()
returns trigger
language plpgsql
as $$
declare
  payload jsonb;
  role_value text;
  legacy_role text;
  user_value text;
  message_value text;
begin
  payload := to_jsonb(new);

  role_value := lower(trim(coalesce(
    payload->>'author_role',
    payload->>'sender_role',
    payload->>'author_type'
  )));

  if role_value = '' then
    role_value := null;
  end if;

  if role_value = 'supplier' then
    role_value := 'provider';
  elsif role_value = 'system' then
    role_value := 'admin';
  end if;

  if role_value is not null then
    payload := jsonb_set(payload, '{author_role}', to_jsonb(role_value), true);
    legacy_role := case when role_value = 'provider' then 'supplier' else role_value end;
    payload := jsonb_set(payload, '{sender_role}', to_jsonb(legacy_role), true);
    payload := jsonb_set(payload, '{author_type}', to_jsonb(legacy_role), true);
  end if;

  user_value := nullif(coalesce(payload->>'author_user_id', payload->>'sender_id'), '');
  if user_value is not null then
    payload := jsonb_set(payload, '{author_user_id}', to_jsonb(user_value), true);
    payload := jsonb_set(payload, '{sender_id}', to_jsonb(user_value), true);
  end if;

  message_value := coalesce(payload->>'message', payload->>'body');
  if message_value is not null then
    payload := jsonb_set(payload, '{message}', to_jsonb(message_value), true);
    payload := jsonb_set(payload, '{body}', to_jsonb(message_value), true);
  end if;

  new := jsonb_populate_record(new, payload);
  return new;
end $$;

do $$
begin
  if to_regclass('public.quote_messages') is null then
    return;
  end if;

  execute 'drop trigger if exists quote_messages_sync_legacy_fields on public.quote_messages';
  execute 'drop trigger if exists quote_messages_sync_legacy_fields_trigger on public.quote_messages';
  execute $sql$
    create trigger quote_messages_sync_legacy_fields
      before insert or update on public.quote_messages
      for each row execute function public.quote_messages_sync_legacy_fields();
  $sql$;
end $$;

alter table if exists public.quote_messages
  add column if not exists author_role text,
  add column if not exists author_user_id uuid,
  add column if not exists provider_id uuid,
  add column if not exists message text,
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz;

-- Backfill new columns if legacy columns are still present.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'quote_messages'
      and column_name = 'author_role'
  )
  and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'quote_messages'
      and column_name = 'sender_role'
  ) then
    execute $sql$
      update public.quote_messages
      set author_role = coalesce(
        author_role,
        case
          when lower(sender_role) = 'supplier' then 'provider'
          when lower(sender_role) = 'system' then 'admin'
          else lower(sender_role)
        end
      )
      where author_role is null
        and sender_role is not null;
    $sql$;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'quote_messages'
      and column_name = 'author_role'
  )
  and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'quote_messages'
      and column_name = 'author_type'
  ) then
    execute $sql$
      update public.quote_messages
      set author_role = coalesce(
        author_role,
        case
          when lower(author_type) = 'supplier' then 'provider'
          when lower(author_type) = 'system' then 'admin'
          else lower(author_type)
        end
      )
      where author_role is null
        and author_type is not null;
    $sql$;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'quote_messages'
      and column_name = 'author_user_id'
  )
  and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'quote_messages'
      and column_name = 'sender_id'
  ) then
    execute 'update public.quote_messages set author_user_id = coalesce(author_user_id, sender_id) where author_user_id is null';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'quote_messages'
      and column_name = 'message'
  )
  and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'quote_messages'
      and column_name = 'body'
  ) then
    execute 'update public.quote_messages set message = coalesce(message, body) where message is null';
  end if;
end $$;

alter table if exists public.quote_messages
  drop constraint if exists quote_messages_author_type_check,
  drop constraint if exists quote_messages_sender_role_check,
  drop constraint if exists quote_messages_author_role_check,
  drop constraint if exists quote_messages_provider_required_check;

update public.quote_messages
set author_role = lower(author_role)
where author_role is not null
  and author_role <> lower(author_role);

update public.quote_messages
set author_role = 'provider'
where author_role = 'supplier';

update public.quote_messages
set author_role = 'admin'
where author_role = 'system';

update public.quote_messages
set author_role = 'admin'
where author_role is null;

alter table if exists public.quote_messages
  alter column quote_id set not null,
  alter column author_role set not null,
  alter column message set not null,
  alter column created_at set not null;

alter table if exists public.quote_messages
  alter column created_at set default now();

alter table if exists public.quote_messages
  alter column updated_at drop not null,
  alter column updated_at drop default;

alter table if exists public.quote_messages
  alter column author_user_id drop not null,
  alter column author_user_id drop default;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'quote_messages'
      and column_name = 'provider_id'
  )
  and not exists (
    select 1
    from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'quote_messages'
      and constraint_name = 'quote_messages_provider_id_fkey'
  ) then
    execute $sql$
      alter table public.quote_messages
        add constraint quote_messages_provider_id_fkey
        foreign key (provider_id)
        references public.providers(id)
        on delete set null;
    $sql$;
  end if;
end $$;

alter table if exists public.quote_messages
  add constraint quote_messages_author_role_check
    check (author_role in ('customer', 'admin', 'provider'));

alter table if exists public.quote_messages
  add constraint quote_messages_provider_required_check
    check (author_role <> 'provider' or provider_id is not null)
    not valid;

create index if not exists quote_messages_quote_id_created_at_idx
  on public.quote_messages (quote_id, created_at desc);

create index if not exists quote_messages_provider_id_created_at_idx
  on public.quote_messages (provider_id, created_at desc);

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
    lower(author_role) = 'customer'
    and author_user_id = auth.uid()
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

-- TODO: Provider policies require an auth mapping to providers.
-- Expected logic: allow provider access when provider_id matches the
-- authenticated provider identity and the quote is routed to them via
-- public.rfq_destinations or selected on public.quotes.selected_provider_id.

notify pgrst, 'reload schema';
