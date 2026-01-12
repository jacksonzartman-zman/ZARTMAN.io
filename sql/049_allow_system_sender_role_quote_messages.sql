-- Allow system-authored quote messages by expanding the sender_role check constraint.
--
-- We keep the constraint name `quote_messages_sender_role_check` stable so application logs
-- and error handling remain consistent across environments.

do $$
begin
  if to_regclass('public.quote_messages') is null then
    return;
  end if;

  -- Drop and recreate the constraint to ensure it allows 'system'.
  execute 'alter table public.quote_messages drop constraint if exists quote_messages_sender_role_check';

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'quote_messages'
      and column_name = 'sender_role'
  ) then
    execute $sql$
      alter table public.quote_messages
      add constraint quote_messages_sender_role_check
      check (sender_role in ('admin', 'customer', 'supplier', 'system'));
    $sql$;
  elsif exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'quote_messages'
      and column_name = 'author_type'
  ) then
    execute $sql$
      alter table public.quote_messages
      add constraint quote_messages_sender_role_check
      check (author_type in ('admin', 'customer', 'supplier', 'system'));
    $sql$;
  end if;
end $$;

