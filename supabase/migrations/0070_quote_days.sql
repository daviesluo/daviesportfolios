-- The Stablecoin quotes page's DAYS table (Davies, 2026-09-28: the Reward quotes page's days table, for Stablecoin
-- quotes too, below BOOKS): each UTC day of PR5's paper test, counted where its rows live, so the page reads a row a
-- day instead of every order. A view: it stores nothing and changes nothing the engine reads or writes (`quotes.ts`
-- and its tables are untouched, as QUEUE's and PR5-W's freeze lines require).
--
-- orders: every order event (a placement, a re-price or a re-placement counts one, as against the venue's 1,000 a
-- day); fills: the entry fills; trips, won and realised_usd: the round trips that CLOSED that day, so a day's realised
-- is what the page's TODAY and REALIZED G/L add up. security_invoker: it reads the tables with the caller's rights, so
-- it is exactly as closed to the anon key as they are.

create or replace view public.agent_quote_days with (security_invoker = true) as
with ev as (
  select (minute at time zone 'UTC')::date as day,
         count(*) filter (where kind = 'order') as orders,
         count(*) filter (where kind = 'fill') as fills
  from public.agent_quote_events
  where kind in ('order', 'fill')
  group by 1
), tr as (
  select (t_exit at time zone 'UTC')::date as day,
         count(*) as trips,
         count(*) filter (where pnl_usd > 0) as won,
         sum(pnl_usd) as realised_usd
  from public.agent_quote_trips
  group by 1
)
select coalesce(ev.day, tr.day) as day,
       coalesce(ev.orders, 0) as orders,
       coalesce(ev.fills, 0) as fills,
       coalesce(tr.trips, 0) as trips,
       coalesce(tr.won, 0) as won,
       coalesce(tr.realised_usd, 0) as realised_usd
from ev full outer join tr on tr.day = ev.day;
