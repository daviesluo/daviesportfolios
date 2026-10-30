-- 0182: "Stablecoin quotes USDC/GBP" (agents/cb_live.ts) may decide for itself, with the paper rule's own code, instead of
-- following the paper arm order for order; and until it does, it records what it would decide beside what it does (the shadow).
-- docs/agents/reviews/2026-10-29-cb-live-design.md §10.
--
-- On whose word. Davies, 2026-10-30 ~00:45 UTC: "要做" (do it), on the recommendation that LIVE decide for itself as the two
-- Revolut X live executors do (quotes_live.ts, whose paper twins are only the comparison), because the follower:
--   (1) goes dark on a rung while the paper rung is held and live's is not, until the paper exits; a paper post-only refusal
--       darkens it too;
--   (2) goes dark when the paper arm's run is lost;
--   (3) cannot take a live-only rule without changing the paper arm;
--   (4) follows a $300 paper record with £120 at £20 rungs, so their states differ anyway.
--
-- `decide`, the decision source:
--   'paper'  the follower, as 0177 built it. The default: landing this changes nothing that is sent or would be.
--   'self'   every minute the executor steps the rule of the arm named by `paper` (`coinbasenudge`: "with Euros - 2"'s driver
--            with the nudge; cb_usdc.ts `cbUsdcMinuteFair`, PR5's frozen `stepMinute`) on its own copy of the rule's state
--            (`cb_live_state.state.self`), the same shared inputs (the stored GBP/USD bars and fast reads, the coin's hourly
--            closes, Revolut X's book), two minutes behind its clock, and its own fills for which rungs are held. It reads
--            nothing of the paper arm's orders or state. `coinbasehold` has no such rule: the check below refuses it.
-- The switch, run only in the conversation where Davies says so, after reading the shadow (§10 has the comparison):
--
--   update public.cb_live_config set decide = 'self', updated_at = now() where id = 1 and decide = 'paper' returning decide;
--
-- and its undo the same with the two words swapped.
--
--   cb_live_shadow  while `decide` is 'paper': one row a rung a turn (the turn's minute), what 'self' would rest (leg, side,
--                   price, size, why, whether the touch crossed it, its fair and minute) beside what the follower wanted (the
--                   same, with the paper's fair and newest minute) and what rested after the turn. 14 days.
--
-- No grant and no policy: row level security is on, and 0082's default privileges keep `anon` and `authenticated` out.

alter table public.cb_live_config add column if not exists decide text not null default 'paper';
alter table public.cb_live_config drop constraint if exists cb_live_config_decide_check;
alter table public.cb_live_config add constraint cb_live_config_decide_check
  check (decide in ('paper', 'self') and (decide = 'paper' or paper in ('coinbasenudge', 'coinbaseusdc')));

create table if not exists public.cb_live_shadow (
  minute         timestamptz not null,
  rung_side      text not null check (rung_side in ('bid', 'ask')),
  k              numeric not null,
  at             timestamptz not null,
  self_leg       text check (self_leg in ('entry', 'exit', 'stop')),
  self_side      text check (self_side in ('BUY', 'SELL')),
  self_price     numeric,
  self_size      numeric,
  self_why       text not null,
  self_crosses   boolean,
  self_fair      numeric,
  self_minute    timestamptz,
  paper_leg      text check (paper_leg in ('entry', 'exit', 'stop')),
  paper_side     text check (paper_side in ('BUY', 'SELL')),
  paper_price    numeric,
  paper_size     numeric,
  paper_why      text not null,
  paper_fair     numeric,
  paper_minute   timestamptz,
  rested_leg     text,
  rested_side    text,
  rested_price   numeric,
  rested_mode    text,
  rested_state   text,
  primary key (minute, rung_side, k)
);
alter table public.cb_live_shadow enable row level security;

-- Daily: shadow rows older than 14 days (a comparison of a few hours to a few days is what they are for).
select cron.schedule(
  'cb-live-shadow-prune',
  '53 10 * * *',
  $cron$delete from public.cb_live_shadow where minute < now() - interval '14 days';$cron$
);
