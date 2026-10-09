-- 0106: "Reward quotes live-prep"'s total cap follows its equity, so each day's payout and any deposit are used at once.
--
-- Why. Davies, 2026-10-09, verbatim: "每天的rewards受益payout之后立马运用资金进策略，你研究一下最好的方式，如果我补充资金的话也可以
-- 立马运用资金". In English: as soon as each day's reward payout arrives, put that money to work in the strategy; if he adds
-- funds, use them at once too. Until now the cap was set once, at the go (step 8lp: the pUSD then less the $75 stop and
-- $5), and a payout or a deposit sat idle in the account. The rule and its evidence are live-prep's pre-registration,
-- Addendum 8 (docs/agents/reviews/2026-10-04-polymarket-lp-prereg.md), and the capacity study docs/agents/backtests/lpcap/.
--
-- What this does, and nothing else.
--   1. `pm_lp_config.reinvest` (boolean, not null, default false): on, a live turn's total cap is the account's equity at
--      cost (pUSD + what the CONFIRMED fills hold at cost + settled tokens not yet redeemed, at their payout) less the
--      total stop and $5, every turn (`lpCapital`, agents/pm_live.ts). It goes down at once; it goes up only on two
--      readings a minute apart that agree, with no fill still settling; an unread balance holds the last cap. Off, or in
--      dry-run, the cap is `cap_total_usd`, as before.
--   2. `pm_lp_config.cap_ceiling_usd` (numeric, not null, default 1000, CHECK 0 < x <= 1000): the most the equity's cap
--      may reach. The code's own ceiling is the same $1,000 (`PM_LP_CAP_CEILING_USD`: ten markets of $100, the most the
--      day's markets can hold under today's rules); a row may lower it, never raise it.
--   3. Live-prep's row: `reinvest = true`. No other column is written: not `dry_run`, `live_confirmed_at`, `cap_total_usd`
--      (still the go's $320, the cap whenever reinvest is off), the stop, the markets, the budget, nor `updated_at`. The
--      arming trigger (0091) fires on the update and finds no other config armed, as at the go.
-- Mini-pool's and mid-pool's configs are untouched: neither has the columns, and their code never reads them.
--
-- Safe in either deploy order. The function first: the row has no `reinvest`, which the turn reads as off, so the cap is
-- `cap_total_usd`, $320, as now. This first: the deployed function does not read the columns, so the cap is $320 until
-- the function deploys. Only both make the cap follow the equity. The first live turn with both holds $320 (no earlier
-- reading of the equity to agree with) and the next sets it from the equity: about $322 at 2026-10-09 14:50 UTC (pUSD
-- $235.44 + $166.59 held at cost, less $80), so the step is small.
--
-- To turn it off, one statement: `update public.pm_lp_config set reinvest = false where id = 1;` (the next turn's cap is
-- `cap_total_usd` again; nothing rests above it once the turn has run, and sells stay armed).
--
-- Safe while the path runs live. The path reads its config once a minute in a statement of milliseconds. Adding two
-- columns with constant defaults is a catalogue change (no table rewrite), and with the CHECK and the one-row update it
-- takes the table's exclusive lock until the commit, milliseconds later; `lock_timeout` stops this waiting in the lock
-- queue behind a long reader, where it would hold the path's read behind it: after 3 s it fails instead, and
-- migrations.yml says so. Applied twice it changes nothing more.

set lock_timeout = '3s';

alter table public.pm_lp_config add column if not exists reinvest boolean not null default false;
alter table public.pm_lp_config add column if not exists cap_ceiling_usd numeric not null default 1000;
alter table public.pm_lp_config drop constraint if exists pm_lp_config_cap_ceiling_usd_check;
alter table public.pm_lp_config add constraint pm_lp_config_cap_ceiling_usd_check check (cap_ceiling_usd > 0 and cap_ceiling_usd <= 1000);

update public.pm_lp_config set reinvest = true where id = 1 and reinvest is distinct from true;

reset lock_timeout;
