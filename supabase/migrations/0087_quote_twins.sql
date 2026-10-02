-- 0087: the realistic twins of PR5's live executor, the TESTING rows "Stablecoin quotes" and "Stablecoin quotes variant-1".
--
-- On whose word. Davies, 2026-10-02 ~19:20 UTC: "testing页的三个Stablecoin quotes策略funded资金全部改成…并且把所有已知的
-- live遇到的不同点和问题全部在这几个testing策略上改动，确保一致，确保真实，不然测试的都是有问题的策略有什么用？如果你觉得必要的话把这
-- 三个testings重新上线，目前的转到在后台继续"; on the sizes, ~19:40 UTC: "改成原版每档100磅，variant-2 每档50磅，一定要确保新架构
-- 真实"; on the conversions, "都按我们昨天新设立的maker费来换币"; on the name, "这个variant-2上线testing后改名为variant-1" (rule D's
-- twin is "Stablecoin quotes variant-1" on the page). The design is frozen in
-- docs/agents/reviews/2026-10-02-pr5-realistic-twins-prereg.md.
--
-- What a twin is. The live executor's own code (`agents/quotes_live.ts`, as an instance, `QuoteLiveInstance`) and the live
-- client's own code under it, run against a SIMULATED Revolut X account (`agents/revx_sim.ts`) that fills a resting order
-- only on public prints strictly through it, by their quantity, and moves money as Revolut X moves it. Nothing it does
-- reaches a venue: it holds no key, and its account answers from the database. `agents/quotes_twin.ts` runs both twins:
--   pr5  PR5's rule, £1,200: twelve rungs of £100 (£600 of bids, £300 of each coin for the asks), one governed key.
--   d    rule D (`quotes_ruled.ts`' judged arm `d`), £1,800: thirty-six rungs of £50, nine a side of each book, four
--        governed keys, a book and a side each (the frozen design's four sub-accounts).
--
-- What this adds, per twin (`agent_quote_twin_pr5_*`, `agent_quote_twin_d_*`):
--   _config, _orders, _events, _state  0052's tables under the twin's name, the same columns, checks and indexes (the events'
--                                      kinds as 0086 left the live table's, with `deadman`), so the executor's own code runs
--                                      on them unchanged;
--   _paper                             the twin's replica of its paper engine, in the shape the executor reads one;
--   _sim                               its simulated account and its own state (how it runs, what it has checked).
-- Each config row is written live and armed, with its capital: on a simulated account that is what makes the executor send
-- its orders there. Three leases. One row of `edge_calls`.
--
-- What it leaves alone: every live table, config row and call (`agent_quote_live_*`, `agents?action=quotes`); PR5's paper
-- test, PR5V and rule D, which keep running and keep their frozen readings (2026-10-21, 10-28); every other row of
-- `edge_calls`. The twins READ PR5's record (`agent_quote_state`, `_minutes`, `_prints`, `_inputs`, `_events`), rule D's
-- (`agent_quoted_state`, and of `agent_quoted_events` arm d's order, refusal and withdrawal events only, its no-peek), the
-- beats and `agent_risk`; they write only their own tables.
--
-- Its call, `agents?action=quotestwins`, retry TRUE (0075 asks every new call to say): it waits until 38 s into its
-- minute, takes one lease for both twins, and each twin acts only when PR5's call has read prints since that twin's last
-- turn (`fetchedTo` past its last turn's instant). A second run in its minute finds nothing new and writes nothing; a run
-- whose worker never started, run again 13 s in by the watchdog, still waits to 38 s and does what the first would have.
-- Its function writes its beat before its work (`agents`' cron calls, beatKeyOfRequest).

do $$
declare
  t text;
begin
  foreach t in array array['pr5', 'd'] loop
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
    $f$, t);
  end loop;
end
$$;

-- Live and armed on the simulated account, from each engine's first decided minute, at the twin's capital.
insert into public.agent_quote_twin_pr5_config (id, dry_run, live_confirmed_at, capital_gbp)
values (1, false, timestamptz '2026-09-23 15:09:00+00', 1200) on conflict (id) do nothing;
insert into public.agent_quote_twin_d_config (id, dry_run, live_confirmed_at, capital_gbp)
values (1, false, timestamptz '2026-09-28 00:00:00+00', 1800) on conflict (id) do nothing;

insert into public.agent_locks (name) values ('quotes-twins'), ('quotes-twin-pr5'), ('quotes-twin-d') on conflict (name) do nothing;

insert into public.edge_calls (path, timeout_ms, every_minutes, last_utc_hour, retry)
values ('agents?action=quotestwins', 58000, 1, 23, true) on conflict (path) do nothing;
