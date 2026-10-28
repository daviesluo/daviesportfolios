-- 0158: the crypto loop's three strategy rows retire, on Davies' word: the live `trend-4h-live` ("Trend 4h · live",
-- Revolut X, the loop's account) and the paper `trend-4h` ("Trend 4h", its same-venue control) and `trend-1h`
-- ("Trend 1h").
--
-- Davies, 2026-10-28: "把实盘的Trend 4h和测试的Trend 1h Trend 4h删了吧，那一整套都表现太差了感觉不值得做" (retire the live Trend 4h
-- and the testing Trend 1h and Trend 4h; the whole set performed too poorly to be worth doing). Read on production at about
-- 23:00 UTC that day: all three flat (every fill closed; the live row's one round trip closed 2026-09-28 08:00 UTC, its
-- paper control's the same minute, trend-1h's last on 2026-10-22 02:00 UTC), no open order on any of them, and no maker
-- probe still watched.
--
-- Retired in place, as `0043` and `0129` retired rows: `mode = 'paused'` and `retired_at` set. Nothing is deleted: their
-- decisions, orders, observations and maker probes are the record EX-GAP and MX-1 read (both closed the same day, their
-- notes in `docs/agents/reviews/`), and reference them by foreign key. What the tick does with a retired row that is flat
-- (`tick.ts`, "winding down"): nothing. It decides nothing for it, writes no observation, places no order and runs no
-- stop; the dashboard drops it from LIVE and TESTING (`index.ts`, `shown`). The tick keeps running for what is left of it:
-- the two venues' quotes, the basis every fifth minute (`agent_basis`) and the Kraken candles (`agent_candles`) of the
-- rows' coins, and any order or probe still open, of which there are none.
--
-- The live row can never send an order afterwards:
--   * A retired row that still HOLDS something keeps its exits (`windingDown`), and a live exit is a real sell. So this
--     migration refuses to run while `trend-4h-live` holds any coin on its live book or has an order in flight: then a
--     person decides (wait for the rule's own exit, or Davies' word), and the workflow is re-run. Flat, the row is
--     skipped by every later turn.
--   * `agent_risk.live_confirmed_at`, the one switch every row labelled live needs before a live buy
--     (`liveConfirmationRefusal`), is cleared: with no row labelled live it arms nothing, and a future live row is armed
--     again in the conversation where Davies says go. It is read by the tick and the page only; PR5's live executor, the
--     twins, live-prep, GROKPM and IGBOT each read their own config row's switch and `agent_risk.global_pause`, which is
--     NOT set here, since it would stop all of them.
--
-- The monitor's `decisions` reading (a strategy decision within 75 minutes) was removed in the commit before this one and
-- must be deployed first; with it still deployed, this would page within 75 minutes. Un-retiring is a migration. The
-- rulebooks, their backtests and the tick's code stay.

do $$
declare
  held text;
begin
  select string_agg(format('%s %s', symbol, net), ', ') into held
  from (
    select symbol, sum(case when side = 'buy' then coalesce(filled_base, 0) else -coalesce(filled_base, 0) end) as net
    from public.agent_orders
    where strategy_id = 'trend-4h-live' and mode = 'live'
    group by symbol
  ) p
  where net > 0;
  if held is not null then
    raise exception '0158: trend-4h-live still holds % on its live book; retiring it now would leave its exit armed to sell for real. Wait until it is flat, then re-run.', held;
  end if;
  if exists (select 1 from public.agent_orders
             where strategy_id = 'trend-4h-live' and state in ('pending', 'new', 'partially_filled')) then
    raise exception '0158: trend-4h-live has an order in flight; re-run once it has settled.';
  end if;
end
$$;

update public.agent_strategies
   set mode = 'paused', retired_at = now(), updated_at = now()
 where id in ('trend-4h-live', 'trend-4h', 'trend-1h')
   and retired_at is null;

update public.agent_risk
   set live_confirmed_at = null, updated_at = now()
 where id = 1;
