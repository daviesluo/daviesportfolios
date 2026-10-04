-- 0092: Polymarket's rewarded markets, recorded for research (agents/pm_book_rec.ts): every minute the books of every
-- market paying at least $10 a day in liquidity rewards and of every market a Reward quotes path holds or quotes; every
-- rewarded market once every 15 minutes; and the prints of the first set. Nothing trades on it and nothing of a trading
-- path reads it.
--
-- On whose word. Davies, 2026-10-04, verbatim:
--
--   把polymarket的所有有reward的市场详细价格与order book等一切重要的信息也全和之前revolut stablecoins市场一样详细记录下来吧？以后可以
--   更好inform策略，随时可以调用研究，你觉得是个好主意的话就加上也加到watchdog上
--
-- In English: record every rewarded Polymarket market's prices, order book and everything important, in as much detail as
-- the Revolut X stablecoin books (0057), to inform the strategies later and to be read for research at any time; add it
-- if it is a good idea, and add it to the watchdog.
--
-- What runs. Two calls of the one-minute job, each its own row below, lease, and state row: `agents?action=pmrec` every
-- minute (the reads, into one gzip'd frame per kind and minute) and `agents?action=pmrec-meta` every five minutes (the
-- reward listing every 15 minutes, new markets' tokens, Gamma's metadata, the held and quoted markets, and the archive).
-- Every read is keyless; no key is read and nothing is placed.
--
-- Sizes, measured keylessly on 2026-10-04 before it was built (docs/agents/backtests/pmrec/results/): 18,895 rewarded
-- markets, 2,853 of them at $10 a day or more, every one with a book. A minute's books frame is about 180 KB of gzip,
-- the universe's fifteenth about 41 KB, the prints about 2 KB: one row each, never a row per book (about 850 MB a day
-- on PGlite).
--
-- Retention, to a budget of 150 MB at most: a frame keeps its data in the database only until the meta call archives its
-- closed hour to Supabase Storage (bucket `pm-rec`, private; the call creates it the first time through the Storage API,
-- so nothing here touches the storage schema), normally within fifteen minutes of the hour's end, so one to two hours of
-- frames (~13 MB an hour; an hour of book frames took 11.1 MB on PGlite) are held. The hourly job below drops the data of
-- any frame the archive has not taken within six hours (marked `lost`; so at most seven hours, ~95 MB, are ever held),
-- keeps the frames' counts for seven days, and deletes a market seven days after the listing dropped it.
-- `pm_rec_markets` is about 19,000 rows (20,000 took 14 MB on PGlite) and a week of dropped markets; `pm_rec_archive`
-- grows by 73 rows a day. About 50 MB in all while the archive runs, about 115 MB at most when it does not.
-- The archive itself, about 0.32 GB a day in Storage (~9.7 GB a month), is kept until Davies sets a horizon.
--
-- The watchdog (0075). Both rows' `retry` is TRUE: a second run in a minute changes nothing a first did. The minute call
-- holds the `pm-rec` lease and upserts its frames on (minute, kind): a run the platform failed to boot records its minute
-- 13 s late, and no rule reads a book at `t`. The meta call holds `pm-rec-meta`, and each of its steps is idempotent: the
-- listing applied as a difference, Gamma's metadata upserted on the market, an hour's object replaced by the same frames,
-- its row upserted on (hour, kind). The `agents` function writes each call's beat before its work (`serveRequest`).
--
-- No grant and no policy: row level security is on, and 0082's default privileges keep `anon` and `authenticated` from
-- the new tables.
--
-- ⚠️  CROSS-ENVIRONMENT WARNING (as 0037): the one-minute job's URL is the PRODUCTION project's Edge Function host,
-- hardcoded. Applying this to any other database makes THAT database POST to production every minute.

-- Every rewarded market the recorder has seen: its tokens, its reward programme as the listing last gave it, whether a
-- Reward quotes path holds or quotes it, and Gamma's metadata as last read. The frames name markets by `id`; `phase` is
-- the minute (of every 15) its universe line is read in (agents/pm_book_rec.ts's PM_REC_PHASES).
create table if not exists public.pm_rec_markets (
  id          integer generated always as identity primary key,
  cond        text not null unique check (cond ~ '^0x[0-9a-f]{64}$'),
  yes         text not null,
  no          text not null,
  rate        numeric not null default 0 check (rate >= 0),
  max_spread  numeric not null default 0 check (max_spread >= 0),
  min_size    numeric not null default 0 check (min_size >= 0),
  params_at   timestamptz,
  delisted_at timestamptz,
  ours_until  timestamptz,
  question    text,
  slug        text,
  event_slug  text,
  category    text,
  fee_type    text,
  neg_risk    boolean,
  end_date    timestamptz,
  game_start  timestamptz,
  gamma_at    timestamptz not null default 'epoch',
  volume24hr  numeric,
  volume      numeric,
  liquidity   numeric,
  competitive numeric,
  accepting   boolean,
  closed      boolean,
  first_seen  timestamptz not null default now(),
  phase       smallint generated always as ((id % 15)::smallint) stored
);

-- One minute of one kind: a gzip of JSON lines (a header naming the fields, then a line per book, market or print), and
-- its counts. `data` leaves the database once the hour is archived (`archived_at`) or dropped (`lost`).
create table if not exists public.pm_rec_frames (
  minute      timestamptz not null,
  kind        text not null check (kind in ('books', 'universe', 'prints')),
  n           integer not null check (n >= 0),
  bytes       integer not null check (bytes >= 0),
  ms          integer,
  detail      jsonb,
  data        bytea,
  recorded_at timestamptz not null default now(),
  archived_at timestamptz,
  lost        boolean not null default false,
  primary key (minute, kind)
);
-- Already gzip'd: stored out of line without a second compression.
alter table public.pm_rec_frames alter column data set storage external;
create index if not exists pm_rec_frames_held on public.pm_rec_frames (minute) where archived_at is null and not lost;

-- One object of the archive: an hour of one kind's frames (their gzip members, concatenated), or a day's dump of
-- `pm_rec_markets` (kind `markets`, `hour` the day's start), with a signed URL a research session downloads without a key.
create table if not exists public.pm_rec_archive (
  hour         timestamptz not null,
  kind         text not null check (kind in ('books', 'universe', 'prints', 'markets')),
  path         text not null,
  frames       integer not null check (frames >= 0),
  lines        integer not null check (lines >= 0),
  bytes        bigint not null check (bytes >= 0),
  first_minute timestamptz,
  last_minute  timestamptz,
  sha256       text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  url          text,
  url_expires  timestamptz not null,
  archived_at  timestamptz not null default now(),
  primary key (hour, kind)
);

-- The two calls' state: 1 the minute call's (where its prints ended, what it last reported), 2 the meta call's. Seeded
-- fresh, so neither reads the other as stale before its first run.
create table if not exists public.pm_rec_state (
  id          integer primary key check (id in (1, 2)),
  state       jsonb not null default '{}'::jsonb,
  last_minute timestamptz,
  updated_at  timestamptz,
  last_error  text
);
insert into public.pm_rec_state (id, updated_at) values (1, now()), (2, now()) on conflict (id) do nothing;

alter table public.pm_rec_markets enable row level security;
alter table public.pm_rec_frames  enable row level security;
alter table public.pm_rec_archive enable row level security;
alter table public.pm_rec_state   enable row level security;

insert into public.agent_locks (name) values ('pm-rec'), ('pm-rec-meta') on conflict (name) do nothing;

insert into public.edge_calls (path, timeout_ms, every_minutes, last_utc_hour, retry)
values ('agents?action=pmrec', 58000, 1, 23, true), ('agents?action=pmrec-meta', 58000, 5, 23, true) on conflict (path) do nothing;

-- Hourly: the hard cap on held data (six hours), the frames' counts kept seven days, and markets the listing dropped a
-- week ago that no path holds.
select cron.schedule(
  'pm-rec-prune',
  '41 * * * *',
  $cron$
    update public.pm_rec_frames set data = null, lost = true where archived_at is null and not lost and minute < now() - interval '6 hours';
    delete from public.pm_rec_frames where minute < now() - interval '7 days';
    delete from public.pm_rec_markets where delisted_at < now() - interval '7 days' and (ours_until is null or ours_until < now());
  $cron$
);
