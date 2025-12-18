-- RFQ Intelligence Step 2: Manual part grouping + file association.
-- Admin-managed (service role). Customer/supplier: read-only visibility scoped to quotes.

create table if not exists public.quote_parts (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  part_label text not null,
  part_number text null,
  notes text null,
  sort_order integer null,
  created_at timestamptz not null default now()
);

create index if not exists quote_parts_quote_id_sort_order_idx
  on public.quote_parts (quote_id, sort_order asc, created_at asc);

create table if not exists public.quote_part_files (
  id uuid primary key default gen_random_uuid(),
  quote_part_id uuid not null references public.quote_parts(id) on delete cascade,
  quote_upload_file_id uuid not null references public.quote_upload_files(id) on delete cascade,
  role text not null default 'other',
  created_at timestamptz not null default now(),
  unique (quote_part_id, quote_upload_file_id),
  constraint quote_part_files_role_check check (role in ('cad', 'drawing', 'other'))
);

create index if not exists quote_part_files_quote_part_id_created_at_idx
  on public.quote_part_files (quote_part_id, created_at asc);

create index if not exists quote_part_files_quote_upload_file_id_idx
  on public.quote_part_files (quote_upload_file_id);

-- -----------------------------------------------------------------------------
-- RLS: mirror quote visibility. Admin/server uses service_role (full manage).
-- Customers/suppliers: select-only for quotes they can already access.
-- -----------------------------------------------------------------------------

alter table if exists public.quote_parts enable row level security;
alter table if exists public.quote_part_files enable row level security;

drop policy if exists "quote_parts_service_role_manage" on public.quote_parts;
create policy "quote_parts_service_role_manage"
  on public.quote_parts
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "quote_part_files_service_role_manage" on public.quote_part_files;
create policy "quote_part_files_service_role_manage"
  on public.quote_part_files
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "quote_parts_customers_select" on public.quote_parts;
create policy "quote_parts_customers_select"
  on public.quote_parts
  for select
  using (
    exists (
      select 1
      from public.quotes q
      left join public.customers c on c.id = q.customer_id
      where q.id = quote_parts.quote_id
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

drop policy if exists "quote_part_files_customers_select" on public.quote_part_files;
create policy "quote_part_files_customers_select"
  on public.quote_part_files
  for select
  using (
    exists (
      select 1
      from public.quote_parts qp
      join public.quotes q on q.id = qp.quote_id
      left join public.customers c on c.id = q.customer_id
      where qp.id = quote_part_files.quote_part_id
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

drop policy if exists "quote_parts_suppliers_select" on public.quote_parts;
create policy "quote_parts_suppliers_select"
  on public.quote_parts
  for select
  using (
    exists (
      select 1
      from public.suppliers s
      where s.user_id = auth.uid()
        and (
          exists (
            select 1
            from public.supplier_bids sb
            where sb.quote_id = quote_parts.quote_id
              and sb.supplier_id = s.id
          )
          or exists (
            select 1
            from public.quote_suppliers qs
            where qs.quote_id = quote_parts.quote_id
              and qs.supplier_id = s.id
          )
          or exists (
            select 1
            from public.quotes q
            where q.id = quote_parts.quote_id
              and q.awarded_supplier_id = s.id
          )
        )
    )
  );

drop policy if exists "quote_part_files_suppliers_select" on public.quote_part_files;
create policy "quote_part_files_suppliers_select"
  on public.quote_part_files
  for select
  using (
    exists (
      select 1
      from public.suppliers s
      join public.quote_parts qp on qp.id = quote_part_files.quote_part_id
      where s.user_id = auth.uid()
        and (
          exists (
            select 1
            from public.supplier_bids sb
            where sb.quote_id = qp.quote_id
              and sb.supplier_id = s.id
          )
          or exists (
            select 1
            from public.quote_suppliers qs
            where qs.quote_id = qp.quote_id
              and qs.supplier_id = s.id
          )
          or exists (
            select 1
            from public.quotes q
            where q.id = qp.quote_id
              and q.awarded_supplier_id = s.id
          )
        )
    )
  );

