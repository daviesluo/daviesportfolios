-- 0142: TAKE's twin back on the page as "Stablecoin quotes variant-3", and "Stablecoin quotes with Euros - 2", a new Coinbase
-- paper arm: the weekend variant's rule on the two USDC books alone at 25 a rung (docs/agents/reviews/2026-10-26-cb-usdc-prereg.md;
-- the stablecoin quotes review of 2026-10-26, §6).
--
-- On whose word. Davies, 2026-10-26, on TAKE's twin (`take50`), hidden by 0141: "那这个加到variant-3吧" (put it in as variant-3).
-- On Coinbase: "目前的Stablecoin quotes with Euros - 2改为-1，然后-2改为你说的这个新策略在-1（含周末）的基础上做" (rename the current
-- "with Euros - 2" to "- 1", and make "- 2" the new strategy proposed, built on "- 1", weekends included).
--
-- 1. The twins. Page names are unique: the switched-off weekend twin (`take50wk`, 0141) gives up "variant-3" first, then TAKE's
--    twin takes it and comes back on the page (`hidden` false). Its id, tables, record, TAKE reading and its role as the take
--    shadow's yardstick are unchanged; its place (30) is after variant-2 (15).
-- 2. "Stablecoin quotes with Euros - 1". The weekend variant's page name is the page's (cb_page.ts), not a row: nothing here.
--    Its tables, call, pre-registration and 11-10 reading are unchanged.
-- 3. "Stablecoin quotes with Euros - 2" (`cb_usdc.ts`): runCbHold's steps, the same held rates and release blackout, on
--    USDC-GBP and USDC-EUR alone, £25 a rung on the GBP book and €25 on the EUR book (six a book), from the first 00:00 UTC
--    after its first run. Its own tables (`cb_usdc_*`, 0118's shapes with the two books), lease (`cb-usdc`), call
--    (`agents?action=cbusdc`, a row of `edge_calls` under the watchdog, its beat first) and prune, as 0118 made the
--    weekend variant's. It reads the recorder's prints and the stored rates; it calls no venue.
--
-- `retry` true: a second run in its minute changes nothing the first did (a lease, the recorder's coverage as the state row
-- gives it, every row upserted on its natural key); under a minute; its row waits 15 minutes for the function (0104).
--
-- What it leaves alone: every other twin's row, LIVE and its config, the Coinbase base test and the weekend variant (their
-- tables, calls and frozen files: cb_quotes.ts, cb_view.ts, cb_hold.ts, cb_rec.ts, cb_releases.ts), PR5's paper engine. No
-- grant and no policy: row level security is on, and 0082's default privileges keep `anon` and `authenticated` out.

update public.agent_quote_twin_specs
   set display_name = 'Stablecoin quotes weekend twin'
 where id = 'take50wk' and display_name = 'Stablecoin quotes variant-3';
update public.agent_quote_twin_specs
   set display_name = 'Stablecoin quotes variant-3'
 where id = 'take50' and display_name = 'Stablecoin quotes TAKE';
update public.agent_quote_twin_specs
   set hidden = false
 where id in ('take50');

create table if not exists public.cb_usdc_state (
  id          integer primary key check (id = 1),
  state       jsonb not null default '{}'::jsonb,
  last_minute timestamptz,
  updated_at  timestamptz not null default now(),
  last_error  text
);

create table if not exists public.cb_usdc_events (
  book   text not null check (book in ('USDC-GBP', 'USDC-EUR')),
  minute timestamptz not null,
  side   text not null check (side in ('bid', 'ask', '-')),
  k      numeric not null,
  kind   text not null check (kind in ('order', 'refused', 'withdraw', 'fill', 'exit', 'stop')),
  ticks  integer,
  detail jsonb not null default '{}'::jsonb,
  primary key (book, minute, side, k, kind)
);

create table if not exists public.cb_usdc_trips (
  book          text not null check (book in ('USDC-GBP', 'USDC-EUR')),
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
create index if not exists cb_usdc_trips_t_exit on public.cb_usdc_trips (t_exit);

create table if not exists public.cb_usdc_minutes (
  book      text not null check (book in ('USDC-GBP', 'USDC-EUR')),
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
  primary key (book, minute)
);

alter table public.cb_usdc_state   enable row level security;
alter table public.cb_usdc_events  enable row level security;
alter table public.cb_usdc_trips   enable row level security;
alter table public.cb_usdc_minutes enable row level security;

create or replace view public.cb_usdc_days with (security_invoker = true) as
with ev as (
  select (minute at time zone 'UTC')::date as day,
         count(*) filter (where kind = 'order') as orders,
         count(*) filter (where kind = 'fill') as fills
  from public.cb_usdc_events
  where kind in ('order', 'fill')
  group by 1
), tr as (
  select (t_exit at time zone 'UTC')::date as day,
         count(*) as trips,
         count(*) filter (where pnl_gbp > 0) as won,
         sum(pnl_gbp) as realised_gbp
  from public.cb_usdc_trips
  group by 1
)
select coalesce(ev.day, tr.day) as day,
       coalesce(ev.orders, 0) as orders,
       coalesce(ev.fills, 0) as fills,
       coalesce(tr.trips, 0) as trips,
       coalesce(tr.won, 0) as won,
       coalesce(tr.realised_gbp, 0) as realised_gbp
from ev full outer join tr on tr.day = ev.day;

insert into public.agent_locks (name) values ('cb-usdc') on conflict (name) do nothing;

insert into public.edge_calls (path, timeout_ms, every_minutes, last_utc_hour, retry) values ('agents?action=cbusdc', 30000, 1, 23, true) on conflict (path) do nothing;

select cron.schedule(
  'cb-usdc-prune',
  '51 10 * * *',
  $cron$delete from public.cb_usdc_minutes where minute < now() - interval '120 days';$cron$
);
