-- Phase 3 Step 1: Supplier Match Health & Bench Signals (read-only analytics)
-- Adds two lightweight views for supplier-level match + utilization summaries.
-- No workflow/invariants changes.

create or replace view public.supplier_match_health_summary as
with exposure as (
  select qs.supplier_id, qs.quote_id
  from public.quote_suppliers qs
  where qs.supplier_id is not null

  union

  select qi.supplier_id, qi.quote_id
  from public.quote_invites qi
),
quote_exposure as (
  select
    e.supplier_id,
    e.quote_id,
    q.created_at as quote_created_at
  from exposure e
  join public.quotes q on q.id = e.quote_id
),
bids as (
  select
    sb.supplier_id,
    sb.quote_id,
    sb.created_at as bid_created_at
  from public.supplier_bids sb
),
awards as (
  select
    q.awarded_supplier_id as supplier_id,
    q.id as quote_id,
    q.awarded_at
  from public.quotes q
  where q.awarded_supplier_id is not null
)
select
  s.id as supplier_id,
  s.company_name as supplier_name,

  -- RFQ exposure
  count(distinct qe.quote_id) as rfqs_considered,
  count(distinct qe.quote_id) filter (
    where qe.quote_created_at >= (now() - interval '90 days')
  ) as rfqs_considered_90d,

  -- Bidding
  count(distinct b.quote_id) as rfqs_bid,
  count(distinct b.quote_id) filter (
    where b.bid_created_at >= (now() - interval '90 days')
  ) as rfqs_bid_90d,
  count(distinct b.quote_id) filter (
    where b.bid_created_at >= (now() - interval '30 days')
  ) as rfqs_bid_30d,

  -- Awards / wins
  count(distinct a.quote_id) as rfqs_won,
  count(distinct a.quote_id) filter (
    where a.awarded_at >= (now() - interval '90 days')
  ) as rfqs_won_90d,
  count(distinct a.quote_id) filter (
    where a.awarded_at >= (now() - interval '30 days')
  ) as rfqs_won_30d,

  -- Simple win rate (recent window)
  case
    when count(distinct b.quote_id) filter (where b.bid_created_at >= (now() - interval '90 days')) = 0 then null
    else round(
      100.0 *
        count(distinct a.quote_id) filter (where a.awarded_at >= (now() - interval '90 days'))
        /
        greatest(count(distinct b.quote_id) filter (where b.bid_created_at >= (now() - interval '90 days')), 1),
      1
    )
  end as win_rate_pct_90d,

  -- Placeholder counts (no dedicated mismatch logs yet)
  0::int as mismatch_count,
  0::int as good_match_count,

  -- Coarse match health: deterministic + explainable using bid/win history.
  case
    when count(distinct b.quote_id) filter (where b.bid_created_at >= (now() - interval '90 days')) = 0 then 'unknown'
    when count(distinct a.quote_id) filter (where a.awarded_at >= (now() - interval '90 days')) = 0
      and count(distinct b.quote_id) filter (where b.bid_created_at >= (now() - interval '90 days')) >= 3
      then 'poor'
    when coalesce(
      round(
        100.0 *
          count(distinct a.quote_id) filter (where a.awarded_at >= (now() - interval '90 days'))
          /
          greatest(count(distinct b.quote_id) filter (where b.bid_created_at >= (now() - interval '90 days')), 1),
        1
      ),
      0
    ) < 10
      then 'caution'
    else 'good'
  end as match_health
from public.suppliers s
left join quote_exposure qe on qe.supplier_id = s.id
left join bids b on b.supplier_id = s.id
left join awards a on a.supplier_id = s.id
group by s.id, s.company_name;


create or replace view public.supplier_bench_utilization_summary as
with recent_capacity as (
  select
    scs.supplier_id,
    avg(
      case scs.capacity_level
        when 'high' then 3
        when 'medium' then 2
        when 'low' then 1
        when 'overloaded' then 0
        else null
      end
    ) as avg_capacity_recent,
    max(scs.created_at) as last_capacity_update_at
  from public.supplier_capacity_snapshots scs
  where scs.created_at >= (now() - interval '28 days')
  group by scs.supplier_id
),
recent_awards as (
  select
    q.awarded_supplier_id as supplier_id,
    count(*) as awards_last_30d
  from public.quotes q
  where q.awarded_supplier_id is not null
    and q.awarded_at >= (now() - interval '30 days')
  group by q.awarded_supplier_id
)
select
  s.id as supplier_id,
  s.company_name as supplier_name,
  rc.avg_capacity_recent,
  rc.last_capacity_update_at,
  coalesce(ra.awards_last_30d, 0) as awards_last_30d,
  case
    when rc.avg_capacity_recent is null then 'unknown'
    when rc.avg_capacity_recent >= 2 and coalesce(ra.awards_last_30d, 0) = 0 then 'underused'
    when rc.avg_capacity_recent <= 1 and coalesce(ra.awards_last_30d, 0) >= 2 then 'overused'
    else 'balanced'
  end as bench_status
from public.suppliers s
left join recent_capacity rc on rc.supplier_id = s.id
left join recent_awards ra on ra.supplier_id = s.id;

select pg_notify('pgrst','reload schema');
