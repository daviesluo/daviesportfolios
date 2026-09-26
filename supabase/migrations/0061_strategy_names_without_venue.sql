-- 0061: a strategy's name no longer says its venue (Davies, 2026-09-26: "表格中已经有venue名字显示了").
--
-- The Agents page's table has a Venue column, and each strategy's page now carries the venue's tag beside its PAPER /
-- LIVE badge, so "Trend 4h · Revolut X" said the venue twice. A Revolut X row and its Binance twin now share a name
-- and are told apart by the venue, as on the page. `strategyName` still drops the live row's " · live" on screen,
-- where the LIVE tab says it. A name is for the page only: nothing in the loop, the dashboard or a study reads one.

update public.agent_strategies set name = 'Trend 4h'        where id in ('trend-4h', 'trend-4h-binance');
update public.agent_strategies set name = 'Trend 4h · live' where id = 'trend-4h-live';
update public.agent_strategies set name = 'Trend 1h'        where id in ('trend-1h', 'trend-1h-binance');
update public.agent_strategies set name = 'Momentum 30d'    where id in ('momentum-1d', 'momentum-1d-binance');

-- Any row this list missed would still say its venue: fail the migration rather than leave one.
do $$ begin
  if exists (select 1 from public.agent_strategies where name ~ '·\s*(Revolut X|Binance|Kraken|Polymarket)') then
    raise exception 'a strategy name still carries its venue';
  end if;
end $$;
