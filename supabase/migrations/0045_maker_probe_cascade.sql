-- 0045: the maker probes are a THIRD child of agent_strategies, and 0044
-- did not know it.
--
-- `0044` deleted the retired rows and their history. It deleted
-- observations, orders, decisions and backtests — and `agent_maker_probes`
-- (`0042`) also references `agent_strategies (id)`, with no `on delete`
-- action. It survived only by luck: the three probe rows that existed
-- belonged to `trend-1h`, which stayed. Had a retired row owned one, the
-- migration would have failed on a foreign key for the SECOND time in a
-- day — `agent_orders` has two of them, and the first `0044` knew about
-- one.
--
-- The rule this settles, so the next person deleting a strategy does not
-- have to rediscover it:
--
--   * `agent_maker_probes` CASCADES. It is a measurement notebook — where
--     a post-only order would have rested and what the market did next.
--     It is not a record of money, so losing it with its strategy costs
--     nothing that cannot be re-measured, and a cascade cannot be
--     forgotten.
--   * `agent_orders` and `agent_decisions` stay EXPLICIT, deliberately.
--     They are the record the whole design rests on, and a fill that is
--     gone is a position that never existed. Deleting them should take a
--     statement someone wrote on purpose, and a forgotten one should fail
--     loudly, which is exactly what happened.
--
-- `order_id` already has `on delete set null`, so a probe outlives the
-- order it was written beside. That stays.

alter table public.agent_maker_probes
  drop constraint if exists agent_maker_probes_strategy_id_fkey;

alter table public.agent_maker_probes
  add constraint agent_maker_probes_strategy_id_fkey
  foreign key (strategy_id) references public.agent_strategies (id) on delete cascade;
