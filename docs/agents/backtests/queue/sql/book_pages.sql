-- QUEUE "Data" item 1: the book record's export, after 2026-11-02 00:10 UTC and before 2026-11-06 10:25 UTC, SELECT only,
-- through the Supabase connector. The page statement is the pre-registration's, word for word
-- (docs/agents/reviews/2026-09-28-queue-prereg.md, "Data" item 1); <BOOK> is each of USDC-USD, USDT-USD, USDC-GBP,
-- USDT-GBP and <DAY> each UTC day of `ts` from the book's first page (the day of its least ts under the same predicate, A0
-- below) to 2026-11-02. Each reply is saved, unread, to <data>/pages/<BOOK>_<DAY>.json and decoded by
-- scripts/decode_pages.py, which checks every page's sha256 and never shows a row. A page the connector cannot return whole
-- is taken as hours: the same statement with the day's bounds replaced by the hour's (<DAY> <HH>:00:00 and + interval
-- '1 hour'), saved as <BOOK>_<DAY>T<HH>.json. Written 2026-10-24 with the scorer.

-- A0. Each book's first page: the least ts under the predicate (a timestamp, read first).
select book, min(ts) as first_ts
from public.agent_book_levels
where coalesce(seen_until, ts) >= timestamptz '2026-10-03 22:00:00+00'
  and ts < timestamptz '2026-11-02 00:10:00+00'
group by book order by book;

-- A. The page statement (verbatim), one per book and day.
with r as (
  select ts, json_build_object(
           'book', book,
           'ts', to_char(ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'seen_until', to_char(least(coalesce(seen_until, ts), timestamptz '2026-11-02 00:10:00+00')
                                 at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'reads', reads, 'bids', bids, 'asks', asks)::text as line
  from public.agent_book_levels
  where book = '<BOOK>'
    and ts >= timestamptz '<DAY> 00:00:00+00' and ts < timestamptz '<DAY> 00:00:00+00' + interval '1 day'
    and coalesce(seen_until, ts) >= timestamptz '2026-10-03 22:00:00+00'
    and ts < timestamptz '2026-11-02 00:10:00+00'),
p as (select count(*) as n, coalesce(string_agg(line, E'\n' order by ts), '') as body from r)
select n, octet_length(convert_to(body, 'UTF8')) as bytes,
       encode(sha256(convert_to(body, 'UTF8')), 'hex') as sha256,
       encode(convert_to(body, 'UTF8'), 'base64') as page
from p;

-- B. Complete: one count(*) of the same predicate, per book, taken right after the pages; decode_pages.py checks that the
-- pages' n add up to it. Saved to <data>/pages/count.json.
select book, count(*) as n
from public.agent_book_levels
where coalesce(seen_until, ts) >= timestamptz '2026-10-03 22:00:00+00'
  and ts < timestamptz '2026-11-02 00:10:00+00'
group by book order by book;
