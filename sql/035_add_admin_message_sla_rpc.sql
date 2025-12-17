-- Admin message SLA aggregates via RPC (PostgREST-safe).

create or replace function public.admin_message_sla_for_quotes(p_quote_ids uuid[])
returns table (
  quote_id uuid,
  last_message_at timestamptz,
  last_message_author_role text,
  last_customer_message_at timestamptz,
  last_supplier_message_at timestamptz,
  last_admin_message_at timestamptz
)
language sql
stable
as $$
  with input as (
    select unnest(p_quote_ids) as quote_id
  ),
  agg as (
    select
      qm.quote_id,
      max(qm.created_at) as last_message_at,
      max(qm.created_at) filter (where lower(qm.sender_role) = 'customer') as last_customer_message_at,
      max(qm.created_at) filter (where lower(qm.sender_role) = 'supplier') as last_supplier_message_at,
      max(qm.created_at) filter (where lower(qm.sender_role) = 'admin') as last_admin_message_at
    from public.quote_messages qm
    where qm.quote_id = any(p_quote_ids)
    group by qm.quote_id
  ),
  last_role as (
    select
      a.quote_id,
      m.sender_role as last_message_author_role
    from agg a
    left join lateral (
      select
        case
          when lower(qm.sender_role) in ('customer', 'supplier', 'admin')
            then lower(qm.sender_role)
          else null
        end as sender_role
      from public.quote_messages qm
      where a.last_message_at is not null
        and qm.quote_id = a.quote_id
        and qm.created_at = a.last_message_at
      order by qm.created_at desc, qm.id desc
      limit 1
    ) m on true
  )
  select
    i.quote_id,
    a.last_message_at,
    lr.last_message_author_role,
    a.last_customer_message_at,
    a.last_supplier_message_at,
    a.last_admin_message_at
  from input i
  left join agg a using (quote_id)
  left join last_role lr using (quote_id);
$$;

select pg_notify('pgrst', 'reload schema');
