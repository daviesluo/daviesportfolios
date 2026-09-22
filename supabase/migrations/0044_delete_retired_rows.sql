-- 0044: the retired rows go, history and all, on Davies' word (2026-09-22).
--
-- `0038` and `0043` retired four rows IN PLACE — paused, `retired_at` set,
-- records kept under their foreign keys — because deleting a strategy row
-- is refused by `agent_decisions_strategy_id_fkey` and because the record
-- of what a rule saw and did was worth keeping. Davies has now asked for
-- them gone: "retired 的 testing strategies 也都删了，不用留历史".
--
-- That is a deliberate, irreversible choice and this migration is the only
-- copy of what it removed. Counted against the live table first:
--
--   dislocation-1m       retired by 0038 — 2 orders, one round trip on the
--                        wrong region's book (§3.5), flat
--   momentum-1d-kraken   retired by 0043 — 3 orders, still long
--   rotation-1d          retired by 0043 — 2 orders, still long
--   rotation-1w-kraken   retired by 0043 — 2 orders, still long
--
--   4 strategy rows · 11 orders · 35 decisions · ~1,380 observations
--   (the observation count is live — three of these rows were still being
--   wound down and still writing state when this was counted)
--
-- Three of them still HELD a position, which the loop had been winding
-- down since 2026-09-22 02:00 (§4.11). Deleting the rows ends that: the
-- positions were paper, so nothing is stranded at a venue, but the record
-- that they existed goes with them. Said plainly because a later reader
-- will find a gap in `agent_orders` between 2026-09-20 18:25 and
-- 2026-09-21 01:28 and should know it was removed on purpose.
--
-- What is NOT deleted, and why: `agent_basis` and `agent_candles` carry no
-- strategy id — they are venue measurements, not a rule's record. The
-- rulebooks stay in `_shared/agents_strategy.ts` and in their tests; the
-- reference keeps every number these rows produced (§3.4, §3.5, §3.14,
-- §3.17). This removes the ROWS, not the evidence.
--
-- Children first, and the ORDER of the children matters. The first version
-- of this file deleted decisions before orders and was refused by
-- `agent_orders_decision_id_fkey`: there are TWO foreign keys in play, not
-- one. `agent_orders.strategy_id` points at the strategy, and
-- `agent_orders.decision_id` points at the DECISION that produced it, so
-- orders have to go before decisions do. Checked before this version was
-- pushed: no order on a live row points at a retired row's decision
-- (0 cross-references), so deleting by `strategy_id` is enough, and the
-- whole sequence was dry-run inside a transaction that raised at the end
-- to roll itself back — 1,377 observations, 11 orders, 35 decisions, 4
-- strategies, no constraint violated.

delete from public.agent_observations
 where strategy_id in (select id from public.agent_strategies where retired_at is not null);

delete from public.agent_orders
 where strategy_id in (select id from public.agent_strategies where retired_at is not null);

delete from public.agent_decisions
 where strategy_id in (select id from public.agent_strategies where retired_at is not null);

delete from public.agent_backtests
 where strategy_id in (select id from public.agent_strategies where retired_at is not null);

delete from public.agent_strategies
 where retired_at is not null;
