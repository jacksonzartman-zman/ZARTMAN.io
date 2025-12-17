-- RFQ Intelligence Step 1: ZIP upload support needs per-file enumeration.
-- This table stores the "files inside an upload", including ZIP member entries.
-- It intentionally does NOT change existing uploads/files tables or views.

create table if not exists public.quote_upload_files (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  upload_id uuid not null references public.uploads(id) on delete cascade,
  path text not null, -- full path within the ZIP or original filename for non-ZIP
  filename text not null,
  extension text null,
  size_bytes bigint null,
  is_from_archive boolean not null default false,
  created_at timestamptz not null default now()
);

-- Idempotency guard per upload: avoid duplicate rows on retries.
create unique index if not exists quote_upload_files_upload_id_path_key
  on public.quote_upload_files (upload_id, path);

create index if not exists quote_upload_files_quote_id_created_at_idx
  on public.quote_upload_files (quote_id, created_at asc);

create index if not exists quote_upload_files_upload_id_created_at_idx
  on public.quote_upload_files (upload_id, created_at asc);

