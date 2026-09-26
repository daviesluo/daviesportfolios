-- 0058: the stablecoin books' recorder reads 40 s into the minute, one book at a time (`agents/books.ts`).
--
-- 0057 read the four books at once at the top of the minute, where the tick reads Revolut X's public endpoints too,
-- and the public bucket is about a token a second: three of the four came back 429 every minute (2026-09-26
-- 18:16–18:20 UTC; the tick and PR5 reported no error). The recorder now waits until 40 s into the minute, after
-- the tick's reads (from :00) and PR5's (from :25), reads one book every 1.25 s and stops at the first 429. Its cron
-- call therefore needs longer than 0057's 30 s: 58 s, as PR5's own job has.
--
-- A reading is now timed to the instant it arrived, not the minute, and a reading that finds the book unchanged
-- extends the stored row instead of being dropped, so a study can tell a book that stood still from one nobody saw.
--
-- ⚠️  CROSS-ENVIRONMENT WARNING (as 0037): the `url` is the PRODUCTION project's Edge Function host,
-- hardcoded. Applying this to any other database makes THAT database POST to production every minute.

alter table public.agent_book_levels add column if not exists seen_until timestamptz;
alter table public.agent_book_levels add column if not exists reads integer not null default 1 check (reads >= 1);
update public.agent_book_levels set seen_until = ts where seen_until is null;

comment on column public.agent_book_levels.ts is
  'When this book was first read: the instant the reading arrived. Rows written before 0058''s code ran carry the minute instead.';
comment on column public.agent_book_levels.seen_until is
  'The last reading that found the same book. Null only on a row written before 0058''s code ran: read it as ts.';
comment on column public.agent_book_levels.reads is
  'How many readings found this book, the first included. Minutes between ts and seen_until that were not read are not counted.';

do $$ begin
  if exists (select 1 from cron.job where jobname = 'agents-books-every-minute') then
    perform cron.unschedule('agents-books-every-minute');
  end if;
end $$;

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
      timeout_milliseconds := 58000
    );
  $cron$
);
