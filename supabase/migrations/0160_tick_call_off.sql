-- 0160: the crypto loop's tick stops. `0158` retired its last three strategy rows (`trend-4h-live`, `trend-4h`,
-- `trend-1h`) on 2026-10-28, flat, and since then each turn decides nothing, writes no observation, places no order and
-- runs no stop: it only records the two venues' quotes, the basis every fifth minute (`agent_basis`) and Kraken's candles
-- (`agent_candles`) for the retired rows' coins.
--
-- On whose word. Davies, 2026-10-28, on the tick once its rows were retired: "你来决定" (you decide), to the main session,
-- which switched it off on the retirement's own reasoning: nothing live or pre-registered reads what the tick still
-- writes. Read before this was written (2026-10-29):
--   * `agent_basis`: the page's dashboard reads its last 24 h into a field the page does not show; MX-1's weekly export
--     read it for probes missing a touch, and MX-1 closed on 2026-10-28 with nothing missing
--     (`docs/agents/reviews/2026-10-28-trend-rows-retired.md`). No other function reads it.
--   * `agent_candles` and `agent_observations`: read by the dashboard and the strategy chart for the strategies the page
--     shows, and it shows none of the loop's rows since `0158`. No other function reads them.
--   * the venues' quotes, Jev, `agent_risk`: the tick reads them for its own turn only; it writes nothing to
--     `agent_risk`. PR5, the twins, GROKPM and IGBOT read their own venues and their own config rows.
--   * its lease (`agent_locks` 'tick'): no other code waits on it. The monitor read it, and the tick's beat, until the
--     commit before this one, which must be deployed first (with them still read, the Worker pages three minutes after
--     this applies).
--
-- Off (enabled = false, never a delete): `agents?action=tick`. Its row, the tables and every record stay; the daily prune
-- (`agents-prune-daily`) keeps its 30-day window on the basis and the observations, as before. Its code stays. Turning
-- the call back on is a migration, and the monitor's reading of it with it.
-- Kept: every other call and every cron job. No grant and no policy.

set lock_timeout = '3s';
update public.edge_calls set enabled = false where path in ('agents?action=tick');
reset lock_timeout;
