-- 0185: the other maker's watch on Revolut X's two GBP stablecoin books (agents/maker_watch.ts;
-- docs/agents/reviews/2026-10-30-mmcomp-3.md, docs/agents/reviews/2026-10-30-maker-absent.md).
--
-- On whose word. Davies, 2026-10-30, after hearing that the automated maker (one order of about 5,000 coins a side) had been
-- absent from both books since 2026-10-29 21:16 UTC: "我们能不能对他加个监控，实时观察和记录他的行为" (can we put a watch on him,
-- to observe and record his behaviour in real time).
--
-- Every minute, for USDT-GBP and USDC-GBP: whether the maker was there (both sides, one side, none, or unseen when the book
-- recorder had no fresh reading), its prices and sizes, the gap between its bid and ask in ticks, and each side's distance from
-- LIVE's fair; and the moments it appeared, disappeared, settled at a new width or a new size. Derived from the book recorder's
-- own snapshots (`agent_book_levels`) and PR5's minute record (`agent_quote_minutes`), inside the recorder's own call
-- (`agents?action=books`) while that call waits for 40 s into its minute: no new recurring call, no new `edge_calls` row, and
-- the call's beat and watchdog are the recorder's. Its first runs fill the history from 2026-09-26 00:00 UTC (the recorder keeps
-- 35 days), a chunk of six hours a book at a time, so the history is complete within the hour after the deploy.
--
-- About 2,900 small rows a day; kept, not pruned (the record is the point). It calls no venue, holds no key and places nothing.
-- What it leaves alone: the recorder's table and its prune, LIVE and every executor and their configs, every twin and arm.
-- No grant and no policy: row level security is on, and 0082's default privileges keep `anon` and `authenticated` out.

create table if not exists public.agent_maker_minutes (
  book        text not null check (book in ('USDT-GBP', 'USDC-GBP')),
  minute      timestamptz not null,
  present     text not null check (present in ('both', 'bid', 'ask', 'none', 'unseen')),
  bid         numeric check (bid > 0),
  bid_qty     numeric check (bid_qty > 0),
  bid_kind    text check (bid_kind in ('one', 'shared', 'partial')),
  ask         numeric check (ask > 0),
  ask_qty     numeric check (ask_qty > 0),
  ask_kind    text check (ask_kind in ('one', 'shared', 'partial')),
  width_ticks integer,
  fair        numeric,
  bid_bps     numeric,
  ask_bps     numeric,
  touch_bid   numeric,
  touch_ask   numeric,
  primary key (book, minute)
);
comment on table public.agent_maker_minutes is
  'The other maker on Revolut X''s GBP stablecoin books, a row a book a UTC minute (agents/maker_watch.ts, 0185): present both / bid / ask / none / unseen, its levels as recognised (one order of its size, a shared level, or a part-filled order at its last price), the bid-ask gap in ticks of 0.0001, and each side''s distance from LIVE''s fair (fairU / GBP-USD) in bps, positive away from fair.';

create table if not exists public.agent_maker_events (
  book       text not null check (book in ('USDT-GBP', 'USDC-GBP')),
  ts         timestamptz not null,
  kind       text not null check (kind in ('appeared', 'disappeared', 'width', 'size')),
  from_value numeric,
  to_value   numeric,
  detail     jsonb not null default '{}'::jsonb,
  primary key (book, ts, kind)
);
comment on table public.agent_maker_events is
  'The other maker''s changes (0185): appeared after 2 minutes seen with it, disappeared after 3 seen without it (detail: the book''s top two levels a side then), width when 10 of its last 15 two-sided minutes agree on a new gap in ticks, size when the median of its last 30 one-order sightings moves 10 coins. ts is the first minute of the run that made it. The first events of each book (2026-09-26) are the watch starting, not the maker.';

create table if not exists public.agent_maker_state (
  book       text primary key check (book in ('USDT-GBP', 'USDC-GBP')),
  cursor     timestamptz,
  memo       jsonb,
  last       jsonb,
  updated_at timestamptz not null default now()
);
comment on table public.agent_maker_state is
  'Each book''s watch (0185): the last minute written, the debounce''s memory (status and since, the recent widths and sizes, the size it follows, the last GBP/USD), and that minute''s row for the page.';

create index if not exists agent_maker_minutes_minute on public.agent_maker_minutes (minute);

alter table public.agent_maker_minutes enable row level security;
alter table public.agent_maker_events enable row level security;
alter table public.agent_maker_state enable row level security;
