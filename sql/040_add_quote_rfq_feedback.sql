create table public.quote_rfq_feedback (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  categories text[] not null,
  note text,
  created_at timestamptz not null default now()
);

create index quote_rfq_feedback_quote_id_idx on public.quote_rfq_feedback (quote_id);
create index quote_rfq_feedback_supplier_id_idx on public.quote_rfq_feedback (supplier_id);

-- RLS
alter table public.quote_rfq_feedback enable row level security;

create policy "suppliers_insert_feedback"
on public.quote_rfq_feedback for insert
using (auth.role() = 'authenticated')
with check (
    exists (
        select 1 
        from public.suppliers s
        where s.user_id = auth.uid()
          and s.id = quote_rfq_feedback.supplier_id
    )
);

-- Admin read
create policy "admin_read_feedback"
on public.quote_rfq_feedback for select
using (auth.role() = 'service_role');

select pg_notify('pgrst','reload schema');
