-- 0076: Polymarket's order path made ready for its live CALIBRATION, left in dry-run and unarmed.
--
-- On whose word. Davies, 2026-10-01, verbatim:
--
--   选市场速度的问题也直接优化下吧，并且确保Polymarket可以上线测试（我准备把kraken的钱转到polymarket里去，密钥没有泄露，这些钱对我来说没多少，可以用来测试真实reward情况），
--   你确定一下上线的具体是哪个Reward quotes策略并解释原因，并确保这个策略所有设置最优，准备上线
--
-- In English: make the market selection fast; make sure Polymarket can go live for a test (he will move his Kraken
-- money to Polymarket; the key was not leaked; the money is small to him and is for testing what rewards really pay);
-- decide which Reward quotes strategy goes live and why; make every setting optimal; prepare to go live. The design and
-- the go-live checklist: docs/agents/reviews/2026-10-01-polymarket-live-calibration.md.
--
-- Davies agreed the plan the same afternoon, verbatim: "同意你polymarket的方案" (~15:25 UTC). On the money, verbatim, first
-- about $300:
--
--   没有400刀那么多闲钱，我觉得既然300刀上限的话我转300就可以了吧？而且转成usdc后还有些碎钱
--
-- ("I don't have $400 spare; with a $300 ceiling I'll move $300, and once it is USDC there is loose change besides"), and
-- then, ~17:00 UTC, about $400, which stands:
--
--   polymarket的策略我决定还是听你的转400美元进去追求最优效果
--
-- ("for the Polymarket strategy I've decided to follow your advice after all and put in $400, for the best result").
--
-- What the path does from this migration (agents/pm_live.ts): RW's quoting rule as RW-E applies it, on rewarded markets
-- OUTSIDE RW's universe — a total daily reward rate of at least $6 and under $10 (RW's is $10 and over) — chosen each UTC
-- day by RW's own first-round reward per dollar, at most `max_markets` of them within `select_budget_usd`; every minute
-- the formula reward of the quotes that rested (`pm_live_minutes`); once a day what Polymarket paid for them
-- (`pm_live_reward_days`). The ratio R = Σ actual / Σ formula over the live rows is the test's answer:
--
--   select sum(coalesce(actual_usd, 0) + coalesce(actual_sponsored_usd, 0)) / nullif(sum(formula_usd), 0) as r,
--          sum(formula_usd) as formula, count(*) as market_days
--     from public.pm_live_reward_days where mode = 'live';
--
-- The code can now send (`PM_ORDER_SENDS_ENABLED` is true and the action loads the signing key); this row is the lock,
-- and this migration sets it: dry-run, unarmed. Going live is one statement, run in the conversation where Davies says
-- go, after his funding. It sets the total cap from the pUSD balance the path itself read within the last five minutes
-- (`pm_live_state`; the same `/balance-allowance` read the probe makes), the balance less the −$75 total stop less a $5
-- margin, clamped only at $320, the cap the $400 he named gives; and it fails, leaving the path in dry-run, if that
-- balance is unread or stale (the cap would be null) or under $81 (the cap would not be positive):
--
--   update public.pm_live_config c
--      set cap_total_usd = case when s.pusd is null or s.at < now() - interval '5 minutes' then null
--                               else least(320, floor(s.pusd - c.loss_total_usd - 5)) end,
--          dry_run = false, live_confirmed_at = now(), updated_at = now()
--     from (select (state->>'pusd')::numeric as pusd, (state->>'at')::timestamptz as at from public.pm_live_state where id = 1) s
--    where c.id = 1;
--
-- The kill switches: `update public.pm_live_config set live_confirmed_at = null where id = 1;` (nothing that opens is
-- placed; sells of what is held stay armed) and `agent_risk.global_pause` (every order cancelled, nothing placed).
-- His Ireland attestation (0074) is standing and is not touched here.
--
-- The one-minute job is NOT changed: `agents?action=pmlive&forceFunctionRegion=eu-west-1` (0074), a row of
-- `public.edge_calls` since 0075, runs the path as before; this migration calls no cron function and touches no row of
-- that list. Its `retry` stays true: a second run in the same minute (0075's watchdog runs a call that wrote no beat
-- again, once) still changes nothing a first run did. The `pm-live` lease keeps two runs apart. A day is selected once:
-- its markets are upserted on (day, cond), and no selection starts while the day has any, or within five minutes of a
-- try. One open order per market, token and side (0074's unique index): an order resting as the rule wants is left
-- alone, one whose POST has not settled stays pending and holds its slot, and a refused quote waits for new
-- information, so a second run sends no second order. The minute's formula is upserted on
-- (mode, minute, cond): a second reading of the same minute replaces the first, as good a sample of it. The readout is
-- made at most once a day per day read and ten minutes apart, upserted on (mode, day, cond); events on (mode, minute,
-- kind); a settlement on its market.

-- ── the config: the day's markets and their budget, and the live test's values ───────────────────────────────────────
alter table public.pm_live_config
  add column if not exists max_markets integer not null default 2,
  add column if not exists select_budget_usd numeric not null default 40;
alter table public.pm_live_config drop constraint if exists pm_live_config_max_markets_check;
alter table public.pm_live_config add constraint pm_live_config_max_markets_check check (max_markets >= 0 and max_markets <= 12);
alter table public.pm_live_config drop constraint if exists pm_live_config_select_budget_usd_check;
alter table public.pm_live_config add constraint pm_live_config_select_budget_usd_check check (select_budget_usd > 0 and select_budget_usd <= 320);
-- The total cap's ceiling follows the code's (`PM_LIVE_CAP_TOTAL_USD`): $320, Davies' $400 less the −$75 stop and $5.
alter table public.pm_live_config drop constraint if exists pm_live_config_cap_total_usd_check;
alter table public.pm_live_config add constraint pm_live_config_cap_total_usd_check check (cap_total_usd > 0 and cap_total_usd <= 320);
alter table public.pm_live_config alter column cap_total_usd set default 320;

-- Phase 1 of the pre-study's plan: two markets and $40 of first-quote capital, until the first payout has been read back
-- (phase 2, eight markets and $160 with the $400 deposit, is one more statement: the design's checklist). The caps, for
-- a wallet of about $400: $320 in all, the deposit less the −$75 total stop and a $5 margin, so the strategy's own limits
-- bind before the balance does (the go-live statement above sets it again from the balance that arrived); $60 a
-- market, which RW's 3N at N ≤ 20 never passes; stops at −$25 a day and −$75 in all, unchanged: the extra money buys
-- breadth, not risk. GTD orders live 600 s, the most the path allows: fewer replacements, more minutes resting (an order
-- scores only once it "has been live for the required duration"). The locks: in dry-run, unarmed, whatever the row held
-- before.
update public.pm_live_config
   set dry_run = true, live_confirmed_at = null,
       max_markets = 2, select_budget_usd = 40,
       cap_total_usd = 320, cap_market_usd = 60, loss_day_usd = 25, loss_total_usd = 75, max_posts_day = 6000,
       gtd_lifetime_s = 600, updated_at = now()
 where id = 1;

-- ── the day's markets: any number a day now, one row each ────────────────────────────────────────────────────────────
-- 0074 kept one standard and one neg-risk market a day, keyed by (day, kind). The day's markets are now RW's ranking's,
-- so the key is the market. The CHECK that refuses a reward rate of $10 or more (RW's universe) stays.
alter table public.pm_live_markets drop constraint if exists pm_live_markets_pkey;
alter table public.pm_live_markets add constraint pm_live_markets_pkey primary key (day, cond);
alter table public.pm_live_markets
  add column if not exists max_spread     numeric,      -- the reward programme's maximum spread, in cents
  add column if not exists n_size         numeric,      -- RW's N: the reward minimum, at least 5 shares
  add column if not exists per_dollar_day numeric,      -- RW's first-round reward per dollar of capital, a day
  add column if not exists capital        numeric,      -- RW's first-quote capital, N × (b + 1 − a)
  add column if not exists formula_day    numeric,      -- RW's first-round formula reward, a day
  add column if not exists end_date       timestamptz,  -- Gamma's endDate
  add column if not exists game_start     timestamptz;  -- Gamma's gameStartTime

-- ── the events: a market's own condition, and the day's readout ──────────────────────────────────────────────────────
alter table public.pm_live_events drop constraint if exists pm_live_events_kind_check;
alter table public.pm_live_events add constraint pm_live_events_kind_check
  check (kind in ('gates', 'selection', 'loss_stop_day', 'loss_stop_total', 'governor', 'alert', 'condition', 'readout'));

-- ── every minute's formula: RW's reward line on the quotes that rested, against the book without them ───────────────
-- bb … q2 are RW's `summarize` of the book less our own orders (its touch, its size-adjusted touch, the others' scores);
-- bid_* and ask_* our resting quotes in the YES book (a NO bid at p is an ask at 1 − p); the scoring flags the venue's
-- word on each side (live only, null in a dry-run); pct the venue's live share of the pool, in percent.
create table if not exists public.pm_live_minutes (
  mode        text not null check (mode in ('dry_run', 'live')),
  minute      timestamptz not null,
  cond        text not null,
  rate        numeric not null check (rate >= 0 and rate < 10),
  max_spread  numeric not null check (max_spread >= 0),
  min_size    numeric not null check (min_size >= 0),
  tick        numeric not null check (tick > 0),
  bb          numeric,
  ba          numeric,
  ab          numeric,
  aa          numeric,
  q1          numeric,
  q2          numeric,
  bid_price   numeric,
  bid_size    numeric,
  ask_price   numeric,
  ask_size    numeric,
  bid_scoring boolean,
  ask_scoring boolean,
  ours        numeric not null default 0 check (ours >= 0),
  others      numeric not null default 0 check (others >= 0),
  formula_usd numeric not null default 0 check (formula_usd >= 0),
  pct         numeric,
  detail      jsonb not null default '{}'::jsonb,
  primary key (mode, minute, cond)
);

-- ── each market-day's readout: the formula's sums beside what Polymarket paid ────────────────────────────────────────
-- Written once a UTC day after 01:00 for the two days before (a day is read twice, for a late posting). The actual
-- columns are the venue's `/rewards/user` (native; sponsored only) and `/rebates/current`, in USD; only a live order can
-- be paid, so a dry-run row carries none.
create table if not exists public.pm_live_reward_days (
  mode                 text not null check (mode in ('dry_run', 'live')),
  day                  date not null,
  cond                 text not null,
  minutes              integer not null default 0 check (minutes >= 0),
  minutes_two_sided    integer not null default 0 check (minutes_two_sided >= 0),
  minutes_scored       integer not null default 0 check (minutes_scored >= 0),
  formula_usd          numeric not null default 0 check (formula_usd >= 0),
  formula_scored_usd   numeric not null default 0 check (formula_scored_usd >= 0),
  rate                 numeric,
  actual_usd           numeric,
  actual_sponsored_usd numeric,
  rebate_usd           numeric,
  read_at              timestamptz not null default now(),
  detail               jsonb not null default '{}'::jsonb,
  primary key (mode, day, cond),
  check (mode = 'live' or (actual_usd is null and actual_sponsored_usd is null and rebate_usd is null))
);

-- ── the markets that resolved while held ─────────────────────────────────────────────────────────────────────────────
-- Settled at Gamma's payout once Gamma shows the market closed with one and a closed time (RW's condition): YES pays
-- `payout`, NO 1 − `payout`. The path then holds nothing of it; its tokens left on chain until Davies redeems them are
-- counted as capital, not exposure.
create table if not exists public.pm_live_settlements (
  cond        text primary key,
  yes_token   text not null,
  no_token    text not null,
  payout      numeric not null check (payout >= 0 and payout <= 1),
  closed_time text,
  settled_at  timestamptz not null default now(),
  detail      jsonb not null default '{}'::jsonb
);

alter table public.pm_live_minutes     enable row level security;
alter table public.pm_live_reward_days enable row level security;
alter table public.pm_live_settlements enable row level security;
