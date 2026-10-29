-- 0162: "AUD weekend (FXW-AUD)" on paper, a row of the Agents page's TESTING list (`supabase/functions/ig/fxw.ts`).
--
-- On whose word. Davies, 2026-10-29: "在testing列表中把IG Trader和澳元策略都上线，funded金额按照你推荐的来定，确保模拟一切真实".
-- The size is the recommendation of docs/agents/reviews/2026-10-18-ig-strategy-search-3.md §5: a GBP 1,000 spread-bet
-- account at GBP 1.50 a pip, no stop. The rule is the frozen FXW-AUD rule (ig_deepdive/params/g2_s1a_frozen.json, the
-- spec's S1b) on the live recorder's own quotes (`ig_quotes`, environment 'live', 0161); fills at the recorded bid or
-- offer only, margin 5 % with IG's close-out at half of it, funding as the research charged it. fxw.ts says each rule.
-- Nothing here calls IG: `ig?action=fxw` reads the database and writes these two tables.
--
-- What it keeps:
--   ig_fxw_weekends  one row a weekend from Friday 2026-10-30: Friday's mid and the quote it came from, Sunday's decision
--                    quote and the gap, the side, stake, entry, margin, the exit and the quote it filled at, why it closed,
--                    funding, P&L and the equity it started with; the mark while open. A row whose status is final
--                    (no_trade, missed, closed) is never rewritten. Kept: a dozen small rows a quarter.
--   ig_fxw_state     the run's last minute and its last error, and the book's name, funding, stake and start (one row),
--                    so the page can tell a stopped run and reads the terms from the run that applies them.
--
-- The row. `ig?action=fxw`, every five minutes, 30 s, all week (a run with no weekend to decide reads one small table and
-- writes one row). Its beat is the `ig` function's, written before its work. `retry` true: a second run in a minute
-- recomputes the same rows from the same quotes and upserts them on their keys. Like every row since 0104 it waits 15
-- minutes for the function's deploy.
--
-- No grant to anon or authenticated, no policy: row level security is on, and 0082's default privileges keep them out.
-- The service role (the `ig` function writes, `agents` reads for the page) only.

set lock_timeout = '3s';

create table if not exists public.ig_fxw_weekends (
  friday         date primary key,                  -- the weekend's Friday, UK date
  status         text not null check (status in ('pending', 'waiting', 'no_trade', 'missed', 'open', 'closed')),
  reason         text,
  epic           text,
  account_id     text,
  fri_ts         timestamptz, fri_bid numeric, fri_offer numeric, fri_mid numeric,
  dec_ts         timestamptz, dec_bid numeric, dec_offer numeric, gap_bps numeric,
  side           text check (side in ('long', 'short')),
  stake_gbp      numeric check (stake_gbp >= 0.5),  -- IG's minimum spread-bet stake on AUD/USD, GBP 0.50 a pip
  entry_ts       timestamptz, entry_price numeric, margin_gbp numeric,
  exit_ts        timestamptz, exit_bid numeric, exit_offer numeric, exit_price numeric, exit_reason text,
  mark_ts        timestamptz, mark_price numeric,
  midnight_ts    timestamptz, midnight_price numeric,
  pnl_gbp        numeric, funding_gbp numeric, net_gbp numeric,
  equity_before  numeric not null,
  updated_at     timestamptz not null default now()
);

create table if not exists public.ig_fxw_state (
  id          integer primary key check (id = 1),
  last_run    timestamptz,
  last_error  text,
  name        text,                                 -- what the page shows, and the book's terms as the run holds them
  funded_gbp  numeric,
  stake_gbp   numeric,
  start_at    timestamptz
);

alter table public.ig_fxw_weekends enable row level security;
alter table public.ig_fxw_state    enable row level security;

insert into public.edge_calls (path, timeout_ms, every_minutes, last_utc_hour, retry) values ('ig?action=fxw', 30000, 5, 23, true) on conflict (path) do nothing;

reset lock_timeout;
