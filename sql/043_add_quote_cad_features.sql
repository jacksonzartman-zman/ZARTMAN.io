-- Phase 13: MVP CAD feature cache (per quote_upload_files row)

create table if not exists public.quote_cad_features (
  id uuid primary key default gen_random_uuid(),
  quote_upload_file_id uuid not null references public.quote_upload_files(id) on delete cascade,
  file_size_bytes bigint not null,
  cad_kind text not null,
  triangle_count bigint null,
  bbox_min jsonb null,
  bbox_max jsonb null,
  approx_volume_mm3 numeric null,
  approx_surface_area_mm2 numeric null,
  complexity_score integer null,
  dfm_flags jsonb null,
  created_at timestamptz not null default now(),
  constraint quote_cad_features_cad_kind_check check (cad_kind in ('stl', 'obj', 'glb', 'step', 'unknown')),
  constraint quote_cad_features_complexity_score_check check (complexity_score is null or (complexity_score >= 0 and complexity_score <= 100))
);

create unique index if not exists quote_cad_features_quote_upload_file_id_key
  on public.quote_cad_features (quote_upload_file_id);

-- Helpful lookup index for joins.
create index if not exists quote_cad_features_created_at_idx
  on public.quote_cad_features (created_at desc);

-- -----------------------------------------------------------------------------
-- RLS: read-only for customers/suppliers/admins; service_role full manage.
-- Mirrors quote visibility via quote_upload_files -> quotes.
-- -----------------------------------------------------------------------------

alter table if exists public.quote_cad_features enable row level security;

drop policy if exists "quote_cad_features_service_role_manage" on public.quote_cad_features;
create policy "quote_cad_features_service_role_manage"
  on public.quote_cad_features
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Admin heuristic: allow zartman domain accounts to read.
drop policy if exists "quote_cad_features_admins_select" on public.quote_cad_features;
create policy "quote_cad_features_admins_select"
  on public.quote_cad_features
  for select
  using (
    lower(coalesce(auth.jwt()->> 'email', '')) like '%@zartman.%'
  );

-- Customers can read for quotes they can access.
drop policy if exists "quote_cad_features_customers_select" on public.quote_cad_features;
create policy "quote_cad_features_customers_select"
  on public.quote_cad_features
  for select
  using (
    exists (
      select 1
      from public.quote_upload_files qf
      join public.quotes q on q.id = qf.quote_id
      left join public.customers c on c.id = q.customer_id
      where qf.id = quote_cad_features.quote_upload_file_id
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

-- Suppliers can read for quotes they can access.
drop policy if exists "quote_cad_features_suppliers_select" on public.quote_cad_features;
create policy "quote_cad_features_suppliers_select"
  on public.quote_cad_features
  for select
  using (
    exists (
      select 1
      from public.suppliers s
      join public.quote_upload_files qf on qf.id = quote_cad_features.quote_upload_file_id
      where s.user_id = auth.uid()
        and (
          exists (
            select 1
            from public.supplier_bids sb
            where sb.quote_id = qf.quote_id
              and sb.supplier_id = s.id
          )
          or exists (
            select 1
            from public.quote_suppliers qs
            where qs.quote_id = qf.quote_id
              and qs.supplier_id = s.id
          )
          or exists (
            select 1
            from public.quotes q
            where q.id = qf.quote_id
              and q.awarded_supplier_id = s.id
          )
        )
    )
  );

notify pgrst, 'reload schema';
