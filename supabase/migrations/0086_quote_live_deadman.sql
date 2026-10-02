-- 0086: PR5's live executor gets a dead-man switch, and its event log a kind for it.
--
-- On whose word. Davies, 2026-10-02, verbatim: "加一个“掉线保护”：执行器连续几轮没跑时撤掉所有挂单，免得像今天卡死时那样旧挂单被成交。
-- 这个加上" ("add a dead-man switch: when the executor misses several turns in a row, cancel every resting order, so
-- that stale orders are not filled the way they were when it stalled today").
--
-- Why. On 2026-10-02 the database thrashed from about 13:00 to 14:20 UTC. The live executor (`agents/quotes_live.ts`)
-- runs inside the one-minute job and missed its turns: between 12:51 and 14:12 UTC its call started in 2 minutes of 81.
-- Its post-only quotes stayed on Revolut X at the prices of before the stall, and stale bids were filled.
--
-- What. The `monitor` Edge Function (`supabase/functions/monitor/deadman.ts`), called every minute by the Cloudflare
-- Worker `daviesportfolios-monitor` from outside Supabase's scheduler, reads `agent_quote_live_state.updated_at`. Older
-- than three minutes, or not readable at all, it cancels every active order on PR5's sub-account and reads each back.
-- When it acted it records one row here: kind `deadman`, mode `live`, book and rung `-`, k 0, the minute it acted, and
-- in `detail` what it found (the state's time and age) and each order's outcome. This migration adds that kind and
-- changes nothing else: the table, its other checks, its key and every row stay as they are. 1,348 rows (664 kB) on
-- 2026-10-02, so the new check validates in an instant.

alter table public.agent_quote_live_events drop constraint if exists agent_quote_live_events_kind_check;
alter table public.agent_quote_live_events add constraint agent_quote_live_events_kind_check
  check (kind in ('skip', 'guard', 'stop_unfilled', 'loss_stop', 'deadman'));
