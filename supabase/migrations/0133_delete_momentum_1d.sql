-- 0133: `momentum-1d` ("Momentum 30d", Revolut X paper) goes, history and all, on Davies' word.
--
-- `0129` retired it in place on 2026-10-18 ("momentum-1d可以删了"), and the tick has been winding down what it held
-- since: a paper BTC/USD position on 2026-10-20, shown on the Agents page as "Momentum 30d is winding down". Davies,
-- 2026-10-20: "这个策略直接删了，不用加这个" (delete the strategy outright, no wind-down). As with `0044`, that is a
-- deliberate, irreversible choice and this migration is the only copy of what it removed. Counted against the live table
-- on 2026-10-20: 1 strategy row · 11 orders · 95 decisions · 2,346 observations · 0 backtests, and 0 orders on another
-- row pointing at one of its decisions.
--
-- Its position was paper, so nothing is stranded at a venue; the record that it existed goes with the row. Its maker
-- probes go too, by `agent_maker_probes`' own cascade (`0045`): MX-1 pulled the tape of four of them (probes 38-41, its
-- 2026-10-19 pull) and describes momentum-1d's windows without judging them (its pre-registration §2), so its reading
-- loses nothing it scores; the committed tape files keep what was pulled.
--
-- What stays: the rulebook in `_shared/agents_strategy.ts` and its tests, the backtests that price it, and every number
-- the reference quotes for it. This removes the ROW, not the evidence. Children first, orders before decisions
-- (`agent_orders_decision_id_fkey`, the lesson of `0044`'s first draft).

delete from public.agent_observations where strategy_id = 'momentum-1d';
delete from public.agent_orders       where strategy_id = 'momentum-1d';
delete from public.agent_decisions    where strategy_id = 'momentum-1d';
delete from public.agent_backtests    where strategy_id = 'momentum-1d';
delete from public.agent_strategies   where id = 'momentum-1d';
