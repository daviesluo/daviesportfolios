-- 0186: indexes for the Agents page's slowest reads (supabase/functions/agents, `dashboard()`).
--
-- On whose word. Davies, 2026-10-30, on the dashboard's speed: "好的接着优化" (good, carry on optimising), the second round after
-- 74ce9d40 started the page's reads together.
--
-- What pg_stat_statements showed, per dashboard call (about 395 calls since the last reset):
--   - Each Coinbase and OKX paper arm's last minute is read by `minute=eq.<its last minute>` (cb_page.ts `loadCoinbaseArm`,
--     okx_quotes.ts, okx_basis.ts). Their only index is the primary key (book, minute), whose leading column the read does not
--     name, so Postgres walks the whole key: cb_hold_minutes, 22 MB and growing a row a book a minute, took 0.36 s a call on
--     average (EXPLAIN: 787 buffers for 4 rows). An index on the minute makes it a few rows' read, on every such table.
--   - The 120 newest decisions of the loop (`agent_decisions` by ts, newest first) sorted the whole table, 14 MB of wide rows,
--     every call (0.23 s): its indexes lead with the strategy. An index on ts serves that read and the last 24 hours' one.
--
-- Plain `create index`: the tables are small enough (the largest 22 MB) that the build takes well under a second, and
-- migrations run in a transaction, where `concurrently` cannot. Writes add one small index entry a row.
-- What it leaves alone: every table's rows, every executor, arm, view and call. No grant and no policy.

create index if not exists cb_hold_minutes_minute_idx on public.cb_hold_minutes (minute);
create index if not exists cb_usdc_minutes_minute_idx on public.cb_usdc_minutes (minute);
create index if not exists cb_nudge_minutes_minute_idx on public.cb_nudge_minutes (minute);
create index if not exists okx_quote_minutes_minute_idx on public.okx_quote_minutes (minute);
create index if not exists okx_basis_minutes_minute_idx on public.okx_basis_minutes (minute);
create index if not exists agent_decisions_ts_idx on public.agent_decisions (ts desc);
