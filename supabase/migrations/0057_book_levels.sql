-- 0057: Revolut X's UK stablecoin order books, recorded for a queue model (docs/agents/reviews/2026-09-26-fp5-review.md).
--
-- On a pegged book a resting quote is filled by its place in the queue far more often than by the price moving through
-- it, and nothing on record says how long that queue was: "no book history" stopped both fp2 and fp5, and PR5's paper
-- fills count only prints strictly through a quote. `agents?action=books` reads the top five levels a side of the four
-- stablecoin books once a minute from the keyless public book (`agents/books.ts`) and stores a book only when it has
-- changed. It reads no key and places nothing; nothing reads this table but a study, whose queue model is
-- pre-registered before any of it is read.

create table if not exists public.agent_book_levels (
  book text not null check (book in ('USDC-USD', 'USDT-USD', 'USDC-GBP', 'USDT-GBP')),
  ts   timestamptz not null,               -- the minute it was read
  bids jsonb not null,                     -- [[price, quantity, orders], …], best first, five at most
  asks jsonb not null,
  primary key (book, ts)
);

alter table public.agent_book_levels enable row level security;

-- Every minute: read the four books, store what changed.
select cron.schedule(
  'agents-books-every-minute',
  '* * * * *',
  $cron$
    select net.http_post(
      url     := 'https://flmvxigozjuizpckllvk.supabase.co/functions/v1/agents?action=books',
      headers := jsonb_build_object(
        'Authorization',
        concat('Bearer ', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
        'Content-Type', 'application/json'
      ),
      body    := '{}'::jsonb,
      timeout_milliseconds := 30000
    );
  $cron$
);

-- Four weeks of record and a week to read them.
select cron.schedule(
  'agents-books-prune',
  '25 10 * * *',
  $cron$ delete from public.agent_book_levels where ts < now() - interval '35 days'; $cron$
);
