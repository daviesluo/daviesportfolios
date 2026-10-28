-- GROKPM utilisation study (2026-10-28): the agent's p/m rows of the markets whose p cleared 5 points over m at some row,
-- a row each time p or m changed, with the book and depth the record kept (grokpm_shadow_marks, 0139: depth from 10-26 03:10).
-- Read-only, through the Supabase connector at 2026-10-28 ~21:30 UTC; the twelve markets whose p cleared 5 points on a tight book' output, copied by hand, is
-- data/rows.txt (columns: MMDDHHMI|p|m|category|book bid|book ask|bid depth $ within 5 points|last trade|action n/o).
with d as (
  select d.id, d.received_at, d.market_id, d.token_id, d.category, d.p, d.m, d.action, sm.book_bid bb, sm.book_ask ba,
         sm.bid_depth_usd bd, sm.price lt,
         lag(d.p) over w pp, lag(d.m) over w pm
    from grokpm_decisions d left join grokpm_shadow_marks sm on sm.decision_id = d.id
   where d.p is not null and d.m is not null and d.received_at > '2026-10-20 17:30+00'
  window w as (partition by d.market_id, d.token_id order by d.received_at)),
k as (select market_id from d group by 1 having max(p - m) >= 0.05),
r as (select d.* from d join k using (market_id) where pp is distinct from p or pm is distinct from m)
select left(market_id, 10) mk, token_id,
       string_agg(to_char(received_at, 'MMDDHH24MI') || '|' || p || '|' || m || '|' || category || '|' || coalesce(bb::text, '') || '|' ||
                  coalesce(ba::text, '') || '|' || coalesce(round(bd)::text, '') || '|' || coalesce(round(lt, 3)::text, '') || '|' ||
                  left(action, 1), ';' order by received_at) rows
  from r group by market_id, token_id order by min(received_at);
