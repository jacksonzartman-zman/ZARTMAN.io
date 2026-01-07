-- Prevent duplicate canonical quote file rows.
-- Canonical readers prefer `files_valid` (fallback `files`).
--
-- Desired uniqueness:
-- - (quote_id, bucket_id, storage_path)
--
-- Some deployments use alternate column names:
-- - storage_bucket_id instead of bucket_id
-- - file_path instead of storage_path
--
-- This migration creates the best matching unique index when the table/columns exist.

do $$
begin
  -- files_valid
  if to_regclass('public.files_valid') is not null then
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'files_valid'
        and column_name = 'bucket_id'
    ) and exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'files_valid'
        and column_name = 'storage_path'
    ) then
      execute 'create unique index if not exists files_valid_quote_bucket_path_key on public.files_valid (quote_id, bucket_id, storage_path)';
    elsif exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'files_valid'
        and column_name = 'storage_bucket_id'
    ) and exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'files_valid'
        and column_name = 'storage_path'
    ) then
      execute 'create unique index if not exists files_valid_quote_bucket_path_key on public.files_valid (quote_id, storage_bucket_id, storage_path)';
    elsif exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'files_valid'
        and column_name = 'bucket_id'
    ) and exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'files_valid'
        and column_name = 'file_path'
    ) then
      execute 'create unique index if not exists files_valid_quote_bucket_path_key on public.files_valid (quote_id, bucket_id, file_path)';
    elsif exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'files_valid'
        and column_name = 'storage_bucket_id'
    ) and exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'files_valid'
        and column_name = 'file_path'
    ) then
      execute 'create unique index if not exists files_valid_quote_bucket_path_key on public.files_valid (quote_id, storage_bucket_id, file_path)';
    end if;
  end if;

  -- files
  if to_regclass('public.files') is not null then
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'files'
        and column_name = 'bucket_id'
    ) and exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'files'
        and column_name = 'storage_path'
    ) then
      execute 'create unique index if not exists files_quote_bucket_path_key on public.files (quote_id, bucket_id, storage_path)';
    elsif exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'files'
        and column_name = 'storage_bucket_id'
    ) and exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'files'
        and column_name = 'storage_path'
    ) then
      execute 'create unique index if not exists files_quote_bucket_path_key on public.files (quote_id, storage_bucket_id, storage_path)';
    elsif exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'files'
        and column_name = 'bucket_id'
    ) and exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'files'
        and column_name = 'file_path'
    ) then
      execute 'create unique index if not exists files_quote_bucket_path_key on public.files (quote_id, bucket_id, file_path)';
    elsif exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'files'
        and column_name = 'storage_bucket_id'
    ) and exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'files'
        and column_name = 'file_path'
    ) then
      execute 'create unique index if not exists files_quote_bucket_path_key on public.files (quote_id, storage_bucket_id, file_path)';
    end if;
  end if;
end $$;

