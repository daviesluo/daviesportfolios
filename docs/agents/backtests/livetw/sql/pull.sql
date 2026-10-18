-- The book recorder's reads of the two Revolut X books over LIVE's TAKE window (2026-10-04 15:55 to 2026-10-18 00:00 UTC),
-- each as one line: book | ts ms | seen_until ms | best bid | its size | best ask | its size. SELECT only, run 2026-10-18
-- through the Supabase connector; the reply's `text` is data/book_touch.txt (gzip -n -9), `n` 31,962 rows, `md5`
-- ca48f662c6edf4c0bde116ecd4c73062 (of the text without its last newline).
select json_build_object('table','book_touch','n',count(*),'md5',md5(string_agg(l, E'\n' order by l)),'text',string_agg(l, E'\n' order by l)) payload from (
select book||'|'||(extract(epoch from ts)*1000)::bigint||'|'||(extract(epoch from coalesce(seen_until,ts))*1000)::bigint||'|'||coalesce((bids->0->>0),'')||'|'||coalesce((bids->0->>1),'')||'|'||coalesce((asks->0->>0),'')||'|'||coalesce((asks->0->>1),'') l
from agent_book_levels where book in ('USDC-GBP','USDT-GBP') and ts >= '2026-10-04 15:55:00+00' and ts < '2026-10-18 00:00:00+00') s;
