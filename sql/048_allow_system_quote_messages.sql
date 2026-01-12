-- Allow system-authored quote messages.
--
-- Historical context:
-- - The original schema used `author_type` with an unnamed CHECK constraint, which Postgres
--   auto-named `quote_messages_author_type_check`.
-- - Later migrations renamed `author_type` -> `sender_role`, but the original constraint name
--   can persist while continuing to validate the (renamed) column.
--
-- This migration expands the allowed role set to include 'system' while keeping the
-- historical constraint name for backwards compatibility.

do $$
begin
  if to_regclass('public.quote_messages') is null then
    return;
  end if;

  -- Drop the legacy check constraint (it may still exist even if the column was renamed).
  execute 'alter table public.quote_messages drop constraint if exists quote_messages_author_type_check';

  -- Recreate the check against the currently-present column name.
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'quote_messages'
      and column_name = 'sender_role'
  ) then
    execute $sql$
      alter table public.quote_messages
      add constraint quote_messages_author_type_check
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
      add constraint quote_messages_author_type_check
      check (author_type in ('admin', 'customer', 'supplier', 'system'));
    $sql$;
  end if;
end $$;

