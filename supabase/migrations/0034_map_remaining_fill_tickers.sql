-- The last three T212 codes with no Yahoo ticker.
--
-- `0032` did `2DGd_EQ` and `BRK_B_US_EQ`. Three were left, and the
-- transaction history is why they matter now: it lists trades for
-- holdings the board no longer carries, so a closed round trip with no
-- ticker is a stretch of history that simply isn't there.
--
--   XFABp_EQ   8 fills  — X-FAB on Euronext Paris. The `p` suffix has
--                         no derivation rule; named in the alias table.
--   CSPX_EQ    2 fills  — an LSE UCITS ETF with no exchange letter at
--                         all, so neither generic rule reaches it.
--   QQQ3l_EQ   6 fills  — WisdomTree 3x NASDAQ 100 on the LSE. The `l`
--                         rule matched letters only and a digit in the
--                         ticker skipped it; the rule accepts digits now.
--
-- All three net to zero: closed positions, no bearing on any holding.
--
-- Fixed in `t212TickerToYahoo`, but the backfill re-upserts only the
-- pages it visits, so rows already stored keep the null they were
-- written with. This maps them in place.
--
-- Idempotent — only rows whose ticker is still null. Applied by
-- `migrations.yml` on push to main; do NOT also run it by hand.

update public.t212_orders
set ticker = 'XFAB.PA'
where ticker is null and t212_ticker = 'XFABp_EQ';

update public.t212_orders
set ticker = 'CSPX.L'
where ticker is null and t212_ticker = 'CSPX_EQ';

update public.t212_orders
set ticker = 'QQQ3.L'
where ticker is null and t212_ticker = 'QQQ3l_EQ';
