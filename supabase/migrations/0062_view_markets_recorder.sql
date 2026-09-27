-- 0062: Polymarket's view-count markets and the YouTube counters they resolve on, recorded (agents/views.ts).
--
-- Davies added YOUTUBE_API_KEY on 2026-09-26; the probe verified it read-only on 09-27 (reference §6). Markets such as
-- "# of views of MrBeast Gaming's next video on day 1" resolve on the video's own view counter, which no one records:
-- the API answers only the current number. Nor does anyone keep Polymarket's books. `agents?action=views` records both,
-- every minute, and every second around each market's deadline (15 minutes before to 3 after; every 10 s in the hour
-- before that). It trades nothing; nothing reads these tables but a study pre-registered before it reads them, after
-- four to six weeks of record. Prints and market records are not stored: the data API and Gamma keep them.
--
-- Reads are change-only, as agent_book_levels (0057): a row is a value first read at `ts` and read again, unchanged,
-- until `seen_until`, `reads` reads in all.
--
-- ⚠️  CROSS-ENVIRONMENT WARNING (as 0037): the `url` is the PRODUCTION project's Edge Function host,
-- hardcoded. Applying this to any other database makes THAT database POST to production every minute.

-- The channels an open view market names, by handle, with their uploads playlist.
create table if not exists public.yt_channels (
  channel_id  text primary key,
  handle      text,
  title       text,
  uploads     text,
  first_seen  timestamptz not null default now()
);

-- Their uploads: when each was posted (a market counts from this instant) and whether it is a Short (none counts one).
create table if not exists public.yt_videos (
  video_id      text primary key,
  channel_id    text not null,
  title         text,
  published_at  timestamptz not null,
  duration_s    integer,
  short         boolean not null default false,
  first_seen    timestamptz not null default now()
);
create index if not exists yt_videos_published on public.yt_videos (published_at);

-- Each video's counter as the API gave it.
create table if not exists public.yt_video_reads (
  video_id    text not null,
  ts          timestamptz not null,       -- the instant the read that first found this value arrived
  views       bigint not null check (views >= 0),
  likes       bigint,
  comments    bigint,
  seen_until  timestamptz not null,       -- the last read that found the same value
  reads       integer not null default 1 check (reads >= 1),
  primary key (video_id, ts)
);
create index if not exists yt_video_reads_seen_until on public.yt_video_reads (seen_until);

-- Each channel's totals (subscribers come rounded to three significant figures, as the channel page shows them).
create table if not exists public.yt_channel_reads (
  channel_id   text not null,
  ts           timestamptz not null,
  subscribers  bigint,
  views        bigint,
  videos       integer,
  seen_until   timestamptz not null,
  reads        integer not null default 1 check (reads >= 1),
  primary key (channel_id, ts)
);
create index if not exists yt_channel_reads_seen_until on public.yt_channel_reads (seen_until);

-- The view markets, as the recorder read them from Gamma: the channel and video the rules name, the hours counted.
create table if not exists public.pm_view_markets (
  cond         text primary key,
  yes          text not null,
  no           text not null,
  event_slug   text not null,
  event_start  timestamptz,
  label        text,
  question     text,
  handle       text,
  video_id     text,
  window_h     integer check (window_h is null or window_h > 0),
  last_seen    timestamptz not null,      -- the last discovery that found it open
  first_seen   timestamptz not null default now()
);
create index if not exists pm_view_markets_last_seen on public.pm_view_markets (last_seen);

-- The YES book of each (a NO book is its mirror), five levels a side.
create table if not exists public.pm_view_books (
  token       text not null,
  ts          timestamptz not null,
  bids        jsonb not null,             -- [[price, size], …], best first
  asks        jsonb not null,
  seen_until  timestamptz not null,
  reads       integer not null default 1 check (reads >= 1),
  primary key (token, ts)
);
create index if not exists pm_view_books_seen_until on public.pm_view_books (seen_until);

-- The key's units spent, by Google's quota day (it ends at midnight Pacific).
create table if not exists public.yt_quota (
  day    date primary key,
  units  integer not null default 0 check (units >= 0)
);

alter table public.yt_channels enable row level security;
alter table public.yt_videos enable row level security;
alter table public.yt_video_reads enable row level security;
alter table public.yt_channel_reads enable row level security;
alter table public.pm_view_markets enable row level security;
alter table public.pm_view_books enable row level security;
alter table public.yt_quota enable row level security;

insert into public.agent_locks (name) values ('views') on conflict (name) do nothing;

-- Every minute. A run reads until 56 s into its minute when a deadline's window is open, so its call gets 59 s.
select cron.schedule(
  'agents-views-every-minute',
  '* * * * *',
  $cron$
    select net.http_post(
      url     := 'https://flmvxigozjuizpckllvk.supabase.co/functions/v1/agents?action=views',
      headers := jsonb_build_object(
        'Authorization',
        concat('Bearer ', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
        'Content-Type', 'application/json'
      ),
      body    := '{}'::jsonb,
      timeout_milliseconds := 59000
    );
  $cron$
);
