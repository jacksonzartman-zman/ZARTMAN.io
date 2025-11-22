-- Adds indexes that back the admin RFQ inbox search + filtering experience.
-- Each index uses IF NOT EXISTS so the migration is idempotent.

create index if not exists uploads_status_created_idx
  on public.uploads (status, created_at desc);

create index if not exists uploads_company_lower_idx
  on public.uploads (lower(company));

create index if not exists uploads_name_lower_idx
  on public.uploads (lower(name));

create index if not exists uploads_first_name_lower_idx
  on public.uploads (lower(first_name));

create index if not exists uploads_last_name_lower_idx
  on public.uploads (lower(last_name));

create index if not exists uploads_email_lower_idx
  on public.uploads (lower(email));

create index if not exists uploads_file_name_lower_idx
  on public.uploads (lower(file_name));

create index if not exists files_filename_lower_idx
  on public.files (lower(filename));
