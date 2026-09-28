-- MX-1's weekly export (reviews/2026-09-28-mx1-maker-first-prereg.md §2). Two statements, run read-only by a session that
-- holds the database connector; each result is saved as JSON rows beside the pull and never printed.
--
-- A. The windows to pull: every Revolut X maker probe written since the freeze (2026-09-28 12:14:32 UTC), with only
--    what `pull_tape.py` needs to place its window. No price, fill or mark: those are the reading's, exported then.
select p.id, p.ts, p.symbol, p.strategy_id, s.kind as rulebook, d.bar_start
from public.agent_maker_probes p
left join public.agent_orders o on o.id = p.order_id
left join public.agent_decisions d on d.id = o.decision_id
left join public.agent_strategies s on s.id = p.strategy_id
where p.venue = 'revx' and p.ts >= timestamptz '2026-09-28 12:14:32+00'
order by p.ts, p.id;

-- B. The stand-in touches (§3): for every probe written since the freeze, more than 66 minutes ago, whose `o15` or `o60`
--    mark is missing or null, the `agent_basis` rows of its symbol from 15 to 20 and from 60 to 65 minutes after it.
--    `agent_basis` is pruned at 30 days; a weekly export keeps every row a stand-in can need.
with ev as (
  select p.id, p.symbol, p.ts from public.agent_maker_probes p
  where p.venue = 'revx' and p.ts >= timestamptz '2026-09-28 12:14:32+00' and p.ts < now() - interval '66 minutes'
    and (coalesce(jsonb_typeof(p.follow_up->'o15'), 'null') = 'null' or coalesce(jsonb_typeof(p.follow_up->'o60'), 'null') = 'null')
)
select ev.id as probe_id, b.symbol, b.ts, b.revx_bid, b.revx_ask
from ev join public.agent_basis b on b.symbol = ev.symbol
  and ((b.ts >= ev.ts + interval '15 minutes' and b.ts <= ev.ts + interval '20 minutes')
    or (b.ts >= ev.ts + interval '60 minutes' and b.ts <= ev.ts + interval '65 minutes'))
order by ev.id, b.ts;

-- C. How far the test has come: eligible events so far, by side (a sell is an exit). The reading is due at the first
--    weekly pull after which there are 150 eligible exits; this is an upper bound, since a window the tape could not
--    read (void) is known only to the pull. A count, never a price.
with p as (
  select p.symbol, p.side,
         d.bar_start + case s.kind when 'trend-4h' then interval '4 hours' when 'trend-1h' then interval '1 hour' end as bar_close
  from public.agent_maker_probes p
  join public.agent_orders o on o.id = p.order_id
  join public.agent_decisions d on d.id = o.decision_id
  join public.agent_strategies s on s.id = p.strategy_id
  where p.venue = 'revx' and p.ts >= timestamptz '2026-09-28 12:14:32+00' and p.ts < now() - interval '66 minutes'
    and s.kind in ('trend-4h', 'trend-1h') and p.symbol in ('BTC/USD', 'ETH/USD', 'SOL/USD')
    and coalesce(d.numbers->>'kind', '') <> 'protective' and coalesce(o.filled_base, 0) > 0
)
select side, count(distinct (symbol, bar_close)) as events
from p where bar_close >= timestamptz '2026-09-28 12:14:32+00'
group by side order by side;
