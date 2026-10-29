-- 0168: "Stablecoin quotes with Euros - 3", a Coinbase paper arm: "with Euros - 2"'s rule on USDC-GBP alone at $50 a rung, its
-- fair nudged by Revolut X's USDC-GBP book (docs/agents/reviews/2026-10-29-cb-usdc-nudge-prereg.md; the REVX-FAIR study's one
-- lead, docs/agents/reviews/2026-10-29-revx-fair-price-study.md §5, mirrored).
--
-- On whose word. Davies, 2026-10-29: "建USDC 那个线索，在with euro-2的基础上开-3，只做300美元的USDC-GBP；另外把目前的-2数字*2做600
-- 美元funded" (open "- 3" on the USDC lead, built on "with Euros - 2", USDC-GBP alone at $300; and "- 2" doubled to $600 funded).
-- "- 2"'s doubling is code alone (cb_usdc.ts, its Deviation 2): nothing here touches its tables, call or rows.
--
-- "- 3" (`cb_nudge.ts`): `runCbUsdcArm`, "- 2"'s driver, on USDC-GBP alone, from the first 00:00 UTC after its first run. Its own
-- tables (`cb_nudge_*`, "- 2"'s shapes with the one book, and the minute record's nudge columns: the un-nudged fair, Revolut X's
-- mid and its snapshot's stamp, the deviation, its EMA, whether the nudge applied), lease (`cb-nudge`), call
-- (`agents?action=cbnudge`, a row of `edge_calls` under the watchdog, its beat first, as every agents action's) and prune. It
-- reads the recorder's prints, the stored rates and Revolut X's recorded book (`agent_book_levels`); it calls no venue.
--
-- `retry` true: a second run in its minute changes nothing the first did (a lease, the recorder's coverage as the state row
-- gives it, the nudge's EMA kept in the state row saved with the minutes it decided, every row upserted on its natural key);
-- under a minute; its row waits 15 minutes for the function (0104).
--
-- What it leaves alone: every other arm and twin, LIVE and its config, the Coinbase base test, the weekend variant and "- 2"
-- (their tables, calls and frozen files), PR5's paper engine, the Revolut X book recorder. No grant and no policy: row level
-- security is on, and 0082's default privileges keep `anon` and `authenticated` out.

create table if not exists public.cb_nudge_state (
  id          integer primary key check (id = 1),
  state       jsonb not null default '{}'::jsonb,
  last_minute timestamptz,
  updated_at  timestamptz not null default now(),
  last_error  text
);

create table if not exists public.cb_nudge_events (
  book   text not null check (book in ('USDC-GBP')),
  minute timestamptz not null,
  side   text not null check (side in ('bid', 'ask', '-')),
  k      numeric not null,
  kind   text not null check (kind in ('order', 'refused', 'withdraw', 'fill', 'exit', 'stop')),
  ticks  integer,
  detail jsonb not null default '{}'::jsonb,
  primary key (book, minute, side, k, kind)
);

create table if not exists public.cb_nudge_trips (
  book          text not null check (book in ('USDC-GBP')),
  side          text not null check (side in ('bid', 'ask')),
  k             numeric not null,
  t_entry       timestamptz not null,
  fill_ts       timestamptz not null,
  fill_trade_id bigint not null,
  entry         numeric not null check (entry > 0),
  qty           numeric not null check (qty > 0),
  x_entry       numeric,
  fair_entry    numeric,
  entry_oid     integer,
  t_exit        timestamptz not null,
  exit          numeric not null check (exit > 0),
  how           text not null check (how in ('maker', 'taker')),
  exit_trade_id bigint,
  exit_oid      integer,
  notional_gbp  numeric not null,
  pnl_gbp       numeric not null,
  primary key (book, side, k, t_entry)
);
create index if not exists cb_nudge_trips_t_exit on public.cb_nudge_trips (t_exit);

-- "- 2"'s minute record, and the nudge: `fair` is the fair the minute was quoted on (nudged or not), `fair_raw` the un-nudged one.
create table if not exists public.cb_nudge_minutes (
  book      text not null check (book in ('USDC-GBP')),
  minute    timestamptz not null,
  x         numeric,
  x_t       timestamptz,
  eur_t     timestamptz,
  fair      numeric,
  hours_n   integer not null,
  prints_n  integer not null,
  vol       numeric not null,
  sell_lo   numeric, sell_hi numeric, buy_lo numeric, buy_hi numeric,
  last      numeric,
  last_side text check (last_side in ('buy', 'sell')),
  fair_raw  numeric,
  rx_mid    numeric,
  rx_t      timestamptz,
  dev       numeric,
  ema       numeric,
  nudged    boolean not null default false,
  primary key (book, minute)
);

alter table public.cb_nudge_state   enable row level security;
alter table public.cb_nudge_events  enable row level security;
alter table public.cb_nudge_trips   enable row level security;
alter table public.cb_nudge_minutes enable row level security;

create or replace view public.cb_nudge_days with (security_invoker = true) as
with ev as (
  select (minute at time zone 'UTC')::date as day,
         count(*) filter (where kind = 'order') as orders,
         count(*) filter (where kind = 'fill') as fills
  from public.cb_nudge_events
  where kind in ('order', 'fill')
  group by 1
), tr as (
  select (t_exit at time zone 'UTC')::date as day,
         count(*) as trips,
         count(*) filter (where pnl_gbp > 0) as won,
         sum(pnl_gbp) as realised_gbp
  from public.cb_nudge_trips
  group by 1
)
select coalesce(ev.day, tr.day) as day,
       coalesce(ev.orders, 0) as orders,
       coalesce(ev.fills, 0) as fills,
       coalesce(tr.trips, 0) as trips,
       coalesce(tr.won, 0) as won,
       coalesce(tr.realised_gbp, 0) as realised_gbp
from ev full outer join tr on tr.day = ev.day;

insert into public.agent_locks (name) values ('cb-nudge') on conflict (name) do nothing;

insert into public.edge_calls (path, timeout_ms, every_minutes, last_utc_hour, retry) values ('agents?action=cbnudge', 30000, 1, 23, true) on conflict (path) do nothing;

select cron.schedule(
  'cb-nudge-prune',
  '52 10 * * *',
  $cron$delete from public.cb_nudge_minutes where minute < now() - interval '120 days';$cron$
);
