-- 0088: the realistic twins become rows. `agent_quote_twin_specs` holds one row per twin, which the twins' call and the
-- Agents page read; `create_quote_twin_tables` makes a twin's six tables from 0087's own template; and `p50`, "Stablecoin
-- quotes variant-1" (PR5's rule at £600, £50 a rung), is the first twin made that way.
--
-- On whose word. Davies, 2026-10-03, on a small variant being a row and not hand-wired code (a spec table, a function for
-- its tables, the call and the page reading the rows, the browser test generic over them): "你说的这四点建议全做". On the
-- names: "你目前正在做的variant改名为variant-1排上面，这个新的是variant-2，原来的variant-1改名为variant-3" (variant-2 is kept for
-- a later twin, not made here). On the page: "把变体改成数据只是针对后台吧？我前端看到的不影响吧？" — the change is the back
-- end's; the page reads as before but for p50's row and page and rule D's twin's new name. p50 is the size study's proposal
-- (reference §4 item 51, its addendum of 2026-10-03; docs/agents/backtests/twins/size/), launched on his standing approval of
-- recommended variants: PR5's rule keeps 14–15 bps a round trip at every rung size and makes fewer trips as the rungs grow
-- (60, 58, 57 and 47 at £10, £25, £50 and £100 a rung over 2026-09-23 15:10 → 10-02 21:05 UTC), so p50 measures that
-- forward beside the £100 twin, at rule D's rung size. Its pre-registration: docs/agents/reviews/2026-10-03-pr5-size-twin-prereg.md;
-- the twins' pre-registration's deviation 1 (docs/agents/reviews/2026-10-02-pr5-realistic-twins-prereg.md §12) covers the rest.
--
-- The rows (`agents/quotes_twin.ts`' TWIN_SPEC_ROWS holds the same three; src/twin_specs.test.js holds them equal):
--   pr5  "Stablecoin quotes": PR5's rule, £1,200, twelve rungs of £100, the live account's one governed key. 0087's
--        tables, row and backfill, unchanged.
--   p50  "Stablecoin quotes variant-1": PR5's rule, £600, twelve rungs of £50, one key, from PR5's first decided minute.
--        Its record to 2026-10-02 21:05 UTC is the committed backfill (docs/agents/backtests/twins/p50.json.gz, the size
--        study's s50 run figure for figure), loaded by the call's first run after the deploy.
--   d    "Stablecoin quotes variant-3" (variant-1 until today): rule D's arm d, £1,800, thirty-six rungs of £50, its four
--        keys. 0087's tables, row and backfill, unchanged.
-- A row has no rungs of its own: the executor carries out its engine's rung decisions, so its rungs and exit re-price are
-- its engine's. `gov` is the live account's one key (`account`) or rule D's four (`variant-keys`); `rules` names rule
-- extensions by key, and a key the code has no rule for keeps the row from running (none yet: the coming variant-2 adds
-- the first); `enabled` false takes a twin off the call and the page, its tables and record kept. An id names a twin's
-- tables and lease and never a variant number, so a page name changes in its row alone.
--
-- The next variant that differs only in its parameters is a migration of two statements, its row and then its tables (the
-- function reads the row, so the config's capital and start cannot disagree with it):
--   insert into public.agent_quote_twin_specs
--   select * from jsonb_populate_recordset(null::public.agent_quote_twin_specs, $json$[{ "id": "…", … }]$json$::jsonb)
--   on conflict (id) do nothing;
--   select public.create_quote_twin_tables('…');
-- after docs/agents/reviews/TEMPLATE-variant-prereg.md is filled in, and with the browser test's fixture made again
-- (docs/agents/backtests/twins/scripts/fixture.ts). No code changes: the call and the page read the row the next minute.
--
-- Its time. No new call: 0087's `agents?action=quotestwins` (58 s timeout) runs every enabled twin in the rows' order, under
-- one 55 s lease. It waits until 38 s into its minute; the function's logs of 2026-10-02 22:15 → 10-03 02:50 UTC
-- (`execution_time_ms`, 238 calls) put two twins turning forward at 38.2–41.4 s from the call's start (median 39.3 s), and
-- the calls catching up after 0087 at 50.2–50.5 s (no new catch-up turn 12 s after the wait, `TWIN_CALL_BUDGET_MS`, one
-- budget for the whole call); catch-up turns ran about 0.5 s each. A third twin adds a forward turn of about half a second:
-- a forward call ends near 41 s and one catching up by about 52 s. p50 catches up from 2026-10-02 21:05 at about 20 turns a
-- call (a day behind takes about an hour and a quarter), its row on the page meanwhile; its first call loads its backfill
-- (one file; pr5's took 1.5 s), and pr5 and d still turn in that call.
--
-- What it leaves alone: 0087's tables and rows, every live table and call, PR5's paper test, PR5V and rule D and their
-- frozen readings (2026-10-21, 10-28), `edge_calls` and every cron job. No grant and no policy: row level security is on,
-- and 0082's default privileges keep `anon` and `authenticated` from the new table and the function.

create table if not exists public.agent_quote_twin_specs (
  id            text primary key check (id ~ '^[a-z][a-z0-9]{0,15}$'),
  display_name  text not null unique,
  display_order integer not null unique,
  engine        text not null check (engine in ('pr5', 'ruled-d')),
  capital_gbp   numeric not null check (capital_gbp > 0),
  gov           text not null check (gov in ('account', 'variant-keys')),
  start         timestamptz not null,
  table_prefix  text not null check (table_prefix = 'agent_quote_twin_' || id),
  lease         text not null check (lease = 'quotes-twin-' || id),
  rules         jsonb check (rules is null or jsonb_typeof(rules) = 'object'),
  backfill      jsonb check (backfill is null or (backfill ? 'file' and backfill ? 'sha256' and backfill ? 'until')),
  prereg        text not null,
  migration     text not null,
  enabled       boolean not null default true
);
alter table public.agent_quote_twin_specs enable row level security;

-- One twin's tables, as 0087 made pr5's and d's (the statement below is 0087's, word for word), its config row live and
-- armed on its simulated account from its start at its capital (both read from its row), and its lease.
create or replace function public.create_quote_twin_tables(twin_id text) returns void
language plpgsql
set search_path = ''
as $fn$
declare
  s public.agent_quote_twin_specs;
begin
  select * into s from public.agent_quote_twin_specs where id = twin_id;
  if not found then
    raise exception 'create_quote_twin_tables: agent_quote_twin_specs has no row %', twin_id;
  end if;
  execute format($f$
      create table if not exists public.agent_quote_twin_%1$s_config (
        id                integer primary key check (id = 1),
        dry_run           boolean not null default true,
        live_confirmed_at timestamptz,
        capital_gbp       numeric not null default 50 check (capital_gbp > 0),
        updated_at        timestamptz not null default now()
      );
      create table if not exists public.agent_quote_twin_%1$s_orders (
        id                  bigserial primary key,
        ts                  timestamptz not null default now(),
        mode                text not null check (mode in ('dry_run', 'live')),
        book                text not null check (book in ('USDC-GBP', 'USDT-GBP')),
        rung_side           text check (rung_side in ('bid', 'ask')),
        k                   numeric,
        leg                 text not null check (leg in ('entry', 'exit', 'stop', 'convert')),
        side                text not null check (side in ('buy', 'sell')),
        price               numeric not null check (price > 0),
        base_size           numeric not null check (base_size > 0),
        client_order_id     uuid not null unique,
        venue_order_id      text,
        state               text not null default 'pending'
                            check (state in ('pending', 'new', 'partially_filled', 'filled', 'cancelled', 'rejected')),
        filled_base         numeric not null default 0 check (filled_base >= 0),
        avg_fill_price      numeric,
        fee_gbp             numeric not null default 0,
        paper_oid           integer,
        paper_live          timestamptz,
        fair                numeric,
        request             jsonb,
        response            jsonb,
        book_seen           jsonb,
        cancel_requested_at timestamptz,
        cancel_reason       text,
        filled_at           timestamptz,
        cancelled_at        timestamptz,
        updated_at          timestamptz not null default now(),
        check ((leg = 'convert') = (rung_side is null)),
        check ((rung_side is null) = (k is null))
      );
      create unique index if not exists agent_quote_twin_%1$s_orders_one_open_per_rung
        on public.agent_quote_twin_%1$s_orders (mode, book, rung_side, k)
        where state in ('pending', 'new', 'partially_filled') and rung_side is not null;
      create index if not exists agent_quote_twin_%1$s_orders_open
        on public.agent_quote_twin_%1$s_orders (state) where state in ('pending', 'new', 'partially_filled');
      create index if not exists agent_quote_twin_%1$s_orders_ts on public.agent_quote_twin_%1$s_orders (ts);
      create table if not exists public.agent_quote_twin_%1$s_events (
        mode      text not null check (mode in ('dry_run', 'live')),
        minute    timestamptz not null,
        book      text not null check (book in ('USDC-GBP', 'USDT-GBP', '-')),
        rung_side text not null check (rung_side in ('bid', 'ask', '-')),
        k         numeric not null,
        kind      text not null check (kind in ('skip', 'guard', 'stop_unfilled', 'loss_stop', 'deadman')),
        detail    jsonb not null default '{}'::jsonb,
        primary key (mode, minute, book, rung_side, k, kind)
      );
      create table if not exists public.agent_quote_twin_%1$s_state (
        id         integer primary key check (id = 1),
        state      jsonb not null default '{}'::jsonb,
        updated_at timestamptz not null default now(),
        last_error text
      );
      create table if not exists public.agent_quote_twin_%1$s_paper (
        id          integer primary key check (id = 1),
        state       jsonb not null,
        last_minute timestamptz,
        updated_at  timestamptz not null default now()
      );
      create table if not exists public.agent_quote_twin_%1$s_sim (
        id         integer primary key check (id = 1),
        state      jsonb not null,
        updated_at timestamptz not null default now(),
        last_error text
      );
      alter table public.agent_quote_twin_%1$s_config enable row level security;
      alter table public.agent_quote_twin_%1$s_orders enable row level security;
      alter table public.agent_quote_twin_%1$s_events enable row level security;
      alter table public.agent_quote_twin_%1$s_state  enable row level security;
      alter table public.agent_quote_twin_%1$s_paper  enable row level security;
      alter table public.agent_quote_twin_%1$s_sim    enable row level security;
    $f$, s.id);
  execute format('insert into public.agent_quote_twin_%1$s_config (id, dry_run, live_confirmed_at, capital_gbp) values (1, false, $1, $2) on conflict (id) do nothing', s.id)
    using s.start, s.capital_gbp;
  insert into public.agent_locks (name) values (s.lease) on conflict (name) do nothing;
end
$fn$;

insert into public.agent_quote_twin_specs
select * from jsonb_populate_recordset(null::public.agent_quote_twin_specs, $json$[
  { "id": "pr5", "display_name": "Stablecoin quotes", "display_order": 10, "engine": "pr5", "capital_gbp": 1200, "gov": "account", "start": "2026-09-23T15:09:00Z", "table_prefix": "agent_quote_twin_pr5", "lease": "quotes-twin-pr5", "rules": null, "backfill": { "file": "docs/agents/backtests/twins/pr5.json.gz", "sha256": "f04fb89659b608d12cc1533b4afc0599d4c008048ab9a1a6c40c5c8cc4843c98", "until": "2026-10-02T21:05:00.000Z" }, "prereg": "docs/agents/reviews/2026-10-02-pr5-realistic-twins-prereg.md", "migration": "0087", "enabled": true },
  { "id": "p50", "display_name": "Stablecoin quotes variant-1", "display_order": 20, "engine": "pr5", "capital_gbp": 600, "gov": "account", "start": "2026-09-23T15:09:00Z", "table_prefix": "agent_quote_twin_p50", "lease": "quotes-twin-p50", "rules": null, "backfill": { "file": "docs/agents/backtests/twins/p50.json.gz", "sha256": "f94c9ebecb6a757498fa39f25a2e9907c4e0e4a00f008a16dda17f25335a7bc8", "until": "2026-10-02T21:05:00.000Z" }, "prereg": "docs/agents/reviews/2026-10-03-pr5-size-twin-prereg.md", "migration": "0088", "enabled": true },
  { "id": "d", "display_name": "Stablecoin quotes variant-3", "display_order": 40, "engine": "ruled-d", "capital_gbp": 1800, "gov": "variant-keys", "start": "2026-09-28T00:00:00Z", "table_prefix": "agent_quote_twin_d", "lease": "quotes-twin-d", "rules": null, "backfill": { "file": "docs/agents/backtests/twins/d.json.gz", "sha256": "ecbec6c51dc34d1ae6d2e7b80dafa03194e3296600d460ac3fa1692b04bb9392", "until": "2026-10-02T21:05:00.000Z" }, "prereg": "docs/agents/reviews/2026-10-02-pr5-realistic-twins-prereg.md", "migration": "0087", "enabled": true }
]$json$::jsonb)
on conflict (id) do nothing;

-- pr5's and d's tables are 0087's; p50's are made here.
select public.create_quote_twin_tables('p50');
