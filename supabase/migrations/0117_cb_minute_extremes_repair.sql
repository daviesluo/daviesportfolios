-- 0117: puts back the Coinbase paper test's lost minute extremes (its pre-registration's Deviation 2, 2026-10-13).
--
-- Why. Davies, 2026-10-13: "Coinbase修复同意". `cbMinuteRow` took each aggressor side's lowest and highest print with
-- `xs.reduce(Math.min)`, which hands Math.min the index and the array too, so every side with two prints or more in a
-- minute was stored as null (7,216 of 12,802 minutes with prints to 2026-10-12 23:50 UTC). The engine never read them; the
-- 11-08 reading's replay (bar 1) does. The function was fixed in the push before this one (`00785d94`), so the minutes
-- written from its deploy on are right; this rebuilds the window's earlier ones from `cb_trades`, before `cb-rec-prune`
-- (prints kept 10 days) takes the window's first lit minute on 2026-10-21 23:01 UTC.
--
-- What this does, and nothing else: an update of `cb_quote_minutes`' four extremes from the window's start
-- (2026-10-11 00:00 UTC) where they differ from the prints'. It is
-- `docs/agents/backtests/cbreview/sql/repair_minute_bars.sql`'s update, unchanged, and re-running it changes nothing.
-- The review checked the formula on all 12,728 decided minutes: every non-null stored extreme equals the prints' own.

update public.cb_quote_minutes m
set sell_lo = b.sell_lo, sell_hi = b.sell_hi, buy_lo = b.buy_lo, buy_hi = b.buy_hi
from (
  select product as book, date_trunc('minute', ts) as minute,
         min(price) filter (where side = 'sell') sell_lo, max(price) filter (where side = 'sell') sell_hi,
         min(price) filter (where side = 'buy') buy_lo, max(price) filter (where side = 'buy') buy_hi
  from public.cb_trades where ts >= '2026-10-11 00:00' group by 1, 2
) b
where m.book = b.book and m.minute = b.minute and m.minute >= '2026-10-11 00:00' and m.prints_n > 0
  and (m.sell_lo is distinct from b.sell_lo or m.sell_hi is distinct from b.sell_hi or m.buy_lo is distinct from b.buy_lo or m.buy_hi is distinct from b.buy_hi);
