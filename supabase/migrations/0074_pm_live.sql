-- 0074: Polymarket's order path, built INERT during RW-C, with a dry-run every minute from Ireland.
--
-- On whose word. The pre-study (docs/agents/reviews/2026-10-01-polymarket-live-prestudy.md) put three options to
-- Davies. On 2026-10-01 he chose Option 1, in these words, verbatim:
--
--   “选项 1：违反原规则的先后顺序，在 RW-C 期间先把下单通道建好、只空跑，可以早约 5–7 天” - 这个你现在就建好吧
--   我之后长期在爱尔兰，如果变动需要更改会和你说，不和你说关就一直没事 也不用问我
--
-- In English: "'Option 1: break the frozen ordering, build the order path during RW-C, dry-run only, about 5–7 days
-- sooner' — build this now. From now on I will be in Ireland long-term; if that changes I will tell you; until I tell
-- you, it stays on, and there is no need to ask me." Option 1, as the pre-study words it: "build the rule-independent
-- path (signing, client, reconciliation, gates, caps) during RW-C, inert, with any dry-run only on markets outside RW's
-- universe and nothing of `pm_rwc_*` read". It is a recorded deviation of RW-NEXT's ordering.
--
-- What is built (the design: docs/agents/reviews/2026-10-01-polymarket-order-path.md):
--   * `_shared/polymarket_orders.ts`: the CLOB V2 order (EIP-712), its hash (the order id), its signature, the bodies,
--     and the one function that talks to Polymarket. Its constant `PM_ORDER_SENDS_ENABLED` is FALSE: no request but a
--     GET can leave it, whatever this table says. Turning it on is a reviewed commit.
--   * `agents/pm_live.ts`: the executor. `agents?action=pmlive`, a new row of the one-minute job below, runs it every
--     minute in Supabase's Ireland region (`forceFunctionRegion=eu-west-1`). It records the runtime's `SB_REGION`, runs
--     every gate, and writes the orders it WOULD send or cancel. It does not load POLYMARKET_PRIVATE_KEY: an order's
--     hash needs no key. It reads no table of RW's or RW-C's.
--   * It quotes, in dry-run, only on two markets a UTC day OUTSIDE RW's universe: one standard and one neg-risk market
--     that Gamma shows accepting orders, with two tokens and a two-sided book, whose daily reward rate in
--     `/rewards/markets/current` is under $10 or absent (RW's universe is $10 and over). Its quoting rule is a
--     placeholder for the plumbing (join the touch at the minimum size); the candidate's rule plugs in after RW-C.
--
-- The attestation. Part 4 of RW-NEXT opens a position only while Davies' Ireland attestation is current. On his word
-- above it is a STANDING record: `ireland_attested_at` is set here, and it stays current until a revocation is
-- recorded. Revoking it is one statement, run in the conversation where he says he has left Ireland:
--
--   update public.pm_live_config set ireland_until = now() where id = 1;
--
-- From that instant the path may only reduce or close. A later return is recorded the same way it was set:
--
--   update public.pm_live_config set ireland_attested_at = now(), ireland_until = null where id = 1;
--
-- Nothing can go live from here. Live needs, all of: the commit that sets `PM_ORDER_SENDS_ENABLED`; the private key
-- loaded by the action (it is not); `dry_run` false and `live_confirmed_at` set, in the conversation where Davies says
-- go, after RW-C's verdict and the live design. The caps below are code ceilings a row may lower and never raise.
--
-- ⚠️  CROSS-ENVIRONMENT WARNING (as 0037): the `url` is the PRODUCTION project's Edge Function host,
-- hardcoded. Applying this to any other database makes THAT database POST to production every minute.

create table if not exists public.pm_live_config (
  id                  integer primary key check (id = 1),
  dry_run             boolean not null default true,
  -- The go, in the conversation where Davies gives it, and the kill switch: cleared, nothing that opens is placed;
  -- sells of what is held stay armed. It decides nothing while the path is in dry-run.
  live_confirmed_at   timestamptz,
  -- His Ireland attestation: current from `ireland_attested_at` until `ireland_until` (null: standing).
  ireland_attested_at timestamptz,
  ireland_until       timestamptz,
  -- The caps (RW-NEXT Part 3.1 and the pre-study): a row may lower each, never raise it past the code's ceiling.
  cap_total_usd       numeric not null default 300 check (cap_total_usd > 0 and cap_total_usd <= 300),
  cap_market_usd      numeric not null default 60 check (cap_market_usd > 0 and cap_market_usd <= 60),
  loss_day_usd        numeric not null default 25 check (loss_day_usd > 0 and loss_day_usd <= 25),
  loss_total_usd      numeric not null default 75 check (loss_total_usd > 0 and loss_total_usd <= 75),
  max_posts_day       integer not null default 6000 check (max_posts_day >= 0 and max_posts_day <= 6000),
  -- A GTD order's effective life: it is sent with expiration now + 60 + this, and the venue ends it a minute early. At
  -- least 180: the venue refuses an expiration under 3 minutes ahead, and an order can reach it 45 s into its turn.
  gtd_lifetime_s      integer not null default 300 check (gtd_lifetime_s >= 180 and gtd_lifetime_s <= 600),
  updated_at          timestamptz not null default now(),
  check (ireland_until is null or ireland_attested_at is not null)
);
-- In dry-run and unarmed, whatever the row held before. The attestation is set only when the row is new: running this
-- again cannot re-attest after a revocation.
insert into public.pm_live_config (id, dry_run, live_confirmed_at, ireland_attested_at, ireland_until)
values (1, true, null, now(), null)
on conflict (id) do update set dry_run = true, live_confirmed_at = null, updated_at = now();

-- Each UTC day's two markets, chosen once by the rule above and never from RW's universe: the database refuses a market
-- whose reward rate was $10 or more.
create table if not exists public.pm_live_markets (
  day         date not null,
  kind        text not null check (kind in ('standard', 'neg_risk')),
  cond        text not null,                     -- the condition id
  yes_token   text not null,                     -- Gamma's first token: YES
  no_token    text not null,
  neg_risk    boolean not null,
  tick        numeric not null check (tick > 0),
  min_size    numeric not null check (min_size > 0),
  reward_rate numeric check (reward_rate is null or (reward_rate >= 0 and reward_rate < 10)),
  rank        integer not null check (rank > 0), -- its place in Gamma's list by 24-hour volume
  question    text,
  detail      jsonb not null default '{}'::jsonb,
  selected_at timestamptz not null default now(),
  primary key (day, kind),
  check ((kind = 'neg_risk') = neg_risk)
);

-- Every order the path sent (`live`) or would have sent (`dry_run`). One row is one POST, so the governor counts these
-- rows. The id is the order's EIP-712 hash, known before the POST; a live row is written `pending` before the venue is
-- called. The signature is never stored, and neither is the API key the body names as its owner.
create table if not exists public.pm_live_orders (
  id                  bigserial primary key,
  ts                  timestamptz not null default now(),
  mode                text not null check (mode in ('dry_run', 'live')),
  cond                text not null,
  token               text not null,
  outcome             text not null check (outcome in ('yes', 'no')),
  side                text not null check (side in ('BUY', 'SELL')),
  price               numeric not null check (price > 0 and price < 1),
  size                numeric not null check (size > 0),
  order_type          text not null check (order_type = 'GTD'),
  post_only           boolean not null check (post_only),
  expiration          bigint not null check (expiration > 0),
  neg_risk            boolean not null,
  hash                text not null unique check (hash ~ '^0x[0-9a-f]{64}$'),
  state               text not null default 'pending'
                      check (state in ('pending', 'live', 'filled', 'cancelled', 'expired', 'rejected')),
  size_matched        numeric not null default 0 check (size_matched >= 0),
  -- Which gate let it through: 'open' (every gate passed) or 'reduce' (a sell of what is held, close-only).
  gate                text not null check (gate in ('open', 'reduce')),
  reason              text,
  book_seen           jsonb,                     -- the book it met: touch, tick, minimum size, the book's own time
  request             jsonb,                     -- the order as signed, without its signature
  response            jsonb,
  cancel_requested_at timestamptz,               -- a cancel sent and not yet read back: the slot is frozen
  cancel_gate         text,
  cancel_reason       text,
  filled_at           timestamptz,
  cancelled_at        timestamptz,
  updated_at          timestamptz not null default now()
);
-- Never two open orders on one market, token and side. An open row is the slot's claim, so a second is refused.
create unique index if not exists pm_live_orders_one_open_per_slot
  on public.pm_live_orders (mode, cond, token, side) where state in ('pending', 'live');
create index if not exists pm_live_orders_open on public.pm_live_orders (state) where state in ('pending', 'live');
create index if not exists pm_live_orders_ts on public.pm_live_orders (ts);

-- The live orders' fills, one row per trade and order, read back from GET /data/trades until CONFIRMED or FAILED. P&L
-- counts CONFIRMED only. A dry-run never fills.
create table if not exists public.pm_live_fills (
  trade_id   text not null,
  hash       text not null references public.pm_live_orders (hash),
  cond       text not null,
  token      text not null,
  side       text not null check (side in ('BUY', 'SELL')),
  price      numeric not null check (price > 0 and price < 1),
  size       numeric not null check (size > 0),
  status     text not null check (status in ('MATCHED', 'MINED', 'CONFIRMED', 'RETRYING', 'FAILED')),
  match_time timestamptz,
  tx_hash    text,
  detail     jsonb,
  updated_at timestamptz not null default now(),
  primary key (trade_id, hash)
);

-- What changed, when it changed: the gates' verdicts, a day's selection, the loss stops and the governor, alerts.
create table if not exists public.pm_live_events (
  mode   text not null check (mode in ('dry_run', 'live')),
  minute timestamptz not null,
  kind   text not null check (kind in ('gates', 'selection', 'loss_stop_day', 'loss_stop_total', 'governor', 'alert')),
  detail jsonb not null default '{}'::jsonb,
  primary key (mode, minute, kind)
);

-- The last turn: the runtime's SB_REGION, every gate, the books met, the orders wanted and withheld. Written every minute.
create table if not exists public.pm_live_state (
  id         integer primary key check (id = 1),
  state      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  last_error text
);

alter table public.pm_live_config  enable row level security;
alter table public.pm_live_markets enable row level security;
alter table public.pm_live_orders  enable row level security;
alter table public.pm_live_fills   enable row level security;
alter table public.pm_live_events  enable row level security;
alter table public.pm_live_state   enable row level security;

insert into public.agent_locks (name) values ('pm-live') on conflict (name) do nothing;

-- The one-minute job (0063): 0072's list with one row added, `agents?action=pmlive`, every minute. Every other row is
-- unchanged, byte for byte, and so are the headers, the body and the filter. The job sends one set of headers for every
-- call, so the region rides in the call's own path: `forceFunctionRegion` is Supabase's documented alternative to the
-- `x-region` header "in case you cannot add the x-region header to the request" (guides/functions/regional-invocation).
select cron.schedule(
  'edge-calls-every-minute',
  '* * * * *',
  $cron$
    select net.http_post(
      url     := 'https://flmvxigozjuizpckllvk.supabase.co/functions/v1/' || call.path,
      headers := jsonb_build_object(
        'Authorization',
        concat('Bearer ', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
        'Content-Type', 'application/json'
      ),
      body    := '{}'::jsonb,
      timeout_milliseconds := call.timeout_ms
    )
    from (values
      ('agents?action=tick',          50000, 1, 23),
      ('agents?action=quotes',        58000, 1, 23),
      ('agents?action=quotesv',       58000, 1, 23),
      ('agents?action=quotesd',       58000, 1, 23),
      ('agents?action=books',         58000, 1, 23),
      ('agents?action=pmrw',          58000, 1, 23),
      ('agents?action=pmrw-e',        58000, 1, 23),
      ('agents?action=pmrw-x',        58000, 1, 23),
      ('agents?action=pmrwc',         58000, 1, 23),
      ('agents?action=pmrwc-e',       58000, 1, 23),
      ('agents?action=pmrwc-x',       58000, 1, 23),
      ('agents?action=views',         59000, 1, 23),
      ('agents?action=pmlive&forceFunctionRegion=eu-west-1', 58000, 1, 23),
      ('agents?action=pmrw-select',  290000, 5, 23),
      ('agents?action=pmrwc-select', 290000, 5, 23),
      ('snapshot-record',             25000, 5, 23),
      ('overnight-record',             9000, 5, 9)
    ) as call(path, timeout_ms, every_minutes, last_utc_hour)
    where extract(minute from now() at time zone 'utc')::int % call.every_minutes = 0
      and extract(hour from now() at time zone 'utc')::int <= call.last_utc_hour;
  $cron$
);
