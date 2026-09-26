#!/usr/bin/env python3
"""Write the eight pass-79 rule texts. Does not score and does not read P&L."""

from pathlib import Path

OUT = Path(__file__).resolve().parent

CONTINUITY = (
    "Books this account can trade are read with region=UK. EUR is not this account. "
    "There is no GBP-USD book. Kraken is not the fill. Spot is not shorted.\n"
    "Continuity, one UK page on 2026-09-24, start 1790208000000 end 1790294399999, "
    "read 2026-09-25 22:37:46 UTC. Active pairs requested: 455. A full page of 100 prints, "
    "with a further cursor: 341. An empty page: 66 (1INCH-EUR, AAVE-EUR, ADA-EUR, ALGO-EUR, "
    "APT-EUR, ARB-EUR, ATOM-EUR, AVAX-EUR, AVNT-EUR, BCH-EUR, BNB-EUR, BONK-EUR, BTC-EUR, "
    "CHZ-EUR, CRV-EUR, DASH-EUR, DOGE-EUR, DOLO-USD, DOT-EUR, ENA-EUR, ETC-EUR, ETH-EUR, "
    "FET-EUR, FIDA-EUR, FIL-EUR, FLOKI-EUR, FLUID-USD, HBAR-EUR, HYPE-EUR, ICP-EUR, INJ-EUR, "
    "JASMY-EUR, LDO-EUR, LINK-EUR, LTC-EUR, MAGIC-EUR, NEAR-EUR, ONDO-EUR, OP-EUR, PENDLE-EUR, "
    "PENGU-EUR, PEPE-EUR, POL-EUR, PUMP-USD, RENDER-EUR, SEI-EUR, SHIB-EUR, SOL-EUR, SOMI-USD, "
    "SPX-EUR, STRK-EUR, STX-EUR, SUI-EUR, SYND-EUR, TIA-EUR, TON-EUR, TRUMP-EUR, TRX-EUR, "
    "UNI-EUR, USDC-EUR, VVV-EUR, WIF-EUR, WLD-EUR, XLM-EUR, XRP-EUR, ZRO-EUR). "
    "A request that did not return a list: 0. BTC-USD, ETH-USD, SOL-USD and XRP-USD each "
    "returned a full page. That day is inside the score stretch and only its count is used here. "
    "A year earlier, 2025-09-17, the same four books were pulled in full: BTC-USD 5450, "
    "ETH-USD 6306, SOL-USD 3079, XRP-USD 2902. Sampled full days in the score stretch, counts only: "
    "2026-06-17 BTC 1098 ETH 434 SOL 290 XRP 402; 2026-07-17 BTC 1173 ETH 370 SOL 540 XRP 218; "
    "2026-08-17 BTC 459 ETH 207 SOL 205 XRP 183; 2026-09-10 BTC 583 ETH 323 SOL 560 XRP 393; "
    "2026-09-17 BTC 479 ETH 319 SOL 448 XRP 506.\n"
    "Cutoff day, out of the score: 2026-06-16 00:00:00.000 UTC through 2026-06-16 23:59:59.999 UTC, "
    "start 1781568000000 end 1781654399999. Prices on that day set the size cutoff, the silence "
    "cutoff, and the lag window. They are not trades in the score.\n"
    "Score stretch: 2026-06-17 00:00:00.000 UTC through 2026-09-24 23:59:59.999 UTC, "
    "start 1781654400000 end 1790294399999. Four calendar months sit in that stretch. "
    "The cutoff day is not inside it. An hourly close is not a print. A four-hour close is not a print.\n"
)

# SYND-EUR was a typo risk. The pass 78 list says SYND-USD. Fix before writing.
CONTINUITY = CONTINUITY.replace("SYND-EUR", "SYND-USD")

QUEUE = """\
Queue, written before any print in the score stretch is joined to a P&L. The signal print is public information from GET /api/1.0/public/trades/all?region=UK. This account was not in the book. The signal print is not our order and is not our fill. Pass 78 joined that signal sell to P&L as if it were our bid. That walk is not this score. rxpar is not recomputed.
After a signal sell, and only while flat, post one bid at the signal price minus one quote step of that book. A further signal while the bid is working, or while a position is long, is ignored. One order at a time.
The fill is the first later aggressor sell whose price is less than or equal to that bid. The fill price is that later print's price. A sell at the signal price does not fill, because the bid is one quote step under the signal. A sell above the bid does not fill and does not cancel. If an aggressor buy prints before a sell at or under the bid, the bid is cancelled. A cancel is not a trip. A bid still working when the tape ends is left_working and is not a trip.
The ask is the fill price plus one quote step. The exit is the first later aggressor buy whose price is greater than or equal to that ask, at that print's price. If the tape ends while long, the position is marked to the last print and the mark is a trip. A mark is not a second fill.
Quote steps, read 2026-09-25 from GET /api/1.0/public/configuration/pairs: BTC-USD 0.01, ETH-USD 0.01, SOL-USD 0.001, XRP-USD 0.0001. Round units are 100 times the quote step: BTC-USD 1.00, ETH-USD 1.00, SOL-USD 0.100, XRP-USD 0.0100.
Maker fee on a resting fill is 0 percent. Taker fee is 0.09 percent and is not charged, because the order was resting. The page is https://www.revolut.com/legal/crypto-exchange-fees/ . The archive capture https://web.archive.org/web/20250813002900/https://www.revolut.com/legal/crypto-exchange-fees/ was read 2026-09-25. Its table says Maker fee 0% and Taker fee 0.09%. The live page returned 403. The schedule has no tiers. A doubled maker fee of 0 is 0 and is not the stress. The old 20 bp taker screen charge is not put on these prints.
Base bps = (exit print / entry print - 1) * 10000. Stress bps = ((exit print - one quote step) / (entry print + one quote step) - 1) * 10000. The stress books the entry one quote step worse and the exit one quote step worse. A pre-fixed fraction of the print quantity is not this score. The pool is the equal-weight average of the two books' summed base bps. The trip count is the lesser of the two books, marks included, cancels and left_working excluded. One book is not a second rule. A count of 0 is scored as 0. The print counts say why: signals, acted, fills, cancels, exits, marks, left_working.
The edge-off control posts the same queue after every aggressor sell. It is not a ninth rule. The null draws the lesser trip count from each book's unfiltered queued base moves, 500 draws without replacement, seed 20260925, index int(0.95*500)-1 = 474. If that count is longer than either book's unfiltered queue, the null is undefined and the null gate fails. The null is compared with the base pool, not the stressed pool.
Kill unless pooled base P&L > 0, stress > 0, the lesser trip count is at least 60, both books' base P&L > 0, pooled base P&L > null p95, no calendar month is more than 40% of pooled base P&L, and pooled base P&L exceeds 400 bps. The gate is not lowered. A ban list is not a score.
This is not a quote-currency triangle, not a four-hour forward, not a macro number, not a funding percent used as a price, not a taker print against an external dollar, not a candlestick, not a company cost, and not an hourly close treated as a fill at 0.9999. The five earlier numeric clears and the confirmation-time fall after a higher day stay void. The pass 78 sentence that every aggressor sell is our resting bid stays void as a fill.
A numeric clear is still not a testing row. reached_preregistration stays false. No order of this account was shown crossing the book. Do not arm. Do not push main. Do not open a pull request.
Frozen before any print in the score stretch was joined to a P&L.
"""

HEADS = {
    "rxbounce": """\
Mechanism: bid-ask bounce. Roll, Journal of Finance 39(4), 1984, https://onlinelibrary.wiley.com/doi/10.1111/j.1540-6261.1984.tb03897.x . A transaction print alternates between the bid and the ask, so the change after a buy-then-sell is the spread, not a new value. The same bounce is described at https://hftradingbook.com/data/bid-ask-bounce . On a Bitcoin book the trade-to-trade change is negatively autocorrelated at the first lags, https://doi.org/10.3390/jrfm12010025 .
Who is wrong: the seller who hits the displayed bid on the print immediately after an aggressor buy. That print is the signal. It is not our fill. We were not resting at that price. After it, we join one quote step under it.
Signal: an aggressor sell whose previous print on the same book is an aggressor buy. Any price. The first print of the stretch has no previous print and is not a signal.
Books: BTC-USD and XRP-USD. Two books, one rule.
""",
    "rxadverse": """\
Mechanism: adverse selection on a continuing sell, the opposite of a bounce. Trade signs are positively autocorrelated, so a sell after a sell is continuation, not a reversal. Lillo, Farmer, and coauthors, https://www.long-memory.com/returns/LilloFarmer2004.pdf . On Bitfinex, adverse selection is about a tenth of the effective spread, https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4175306 .
Who is wrong: the seller who hits the displayed bid after another sell, if that seller is informed. That second sell is the signal. It is not our fill. We join one quote step under it. The score is whether a later sell reaches that bid and a later buy reaches the ask one step above the fill.
Signal: an aggressor sell whose previous print on the same book is also an aggressor sell. A sell after a buy is the bounce rule and is not this one.
Books: BTC-USD and XRP-USD. Two books, one rule.
""",
    "rximpact": """\
Mechanism: a large aggressive sell pushes through the bid and the price reverts as the book refills. The reversal grows with the size of the aggressive flow, https://arxiv.org/abs/2608.21888 . Their scored signal was the sign of a 15-minute candle. That candle is not this rule. The same temporary pressure is described at https://hftradingbook.com/strategies/intraday-mean-reversion .
Who is wrong: the large seller whose print carries at least the cutoff quantity. That print is the signal. It is not our fill. We were not the bid that print hit. We join one quote step under it.
Signal: an aggressor sell whose base quantity is at least the cutoff day's own 95th percentile of aggressor-sell quantities. Nearest rank, ceiling. BTC-USD cutoff 0.07521000 base. XRP-USD cutoff 5080.256020 base. The percentile is sells only. A large buy is not a signal. The cutoff is not refit on the score stretch.
Books: BTC-USD and XRP-USD. Two books, one rule.
""",
    "rxround": """\
Mechanism: prices cluster on round numbers, and the cluster is not a return. Urquhart, Economics Letters 159 (2017) 145-148, https://doi.org/10.1016/j.econlet.2017.07.035 , found Bitcoin trades pile up on round prices and found no significant return pattern after the round print. Harris, Review of Financial Studies 4(3), 1991, is the older stock result that traders prefer those prices. The score is the queued return anyway.
Who is wrong: the seller who prints on a round price, 100 quote steps. That print is the signal. It is not our fill. We join one quote step under that round price, so a later sell must trade through the round number to fill us.
Signal: an aggressor sell whose price modulo the round unit is 0. BTC-USD unit 1.00. XRP-USD unit 0.0100. A different round multiple is not a second rule.
Books: BTC-USD and XRP-USD. Two books, one rule.
""",
    "rxgap": """\
Mechanism: a print that falls at least 10 bp through the previous print has overshot one spread. The bid-ask bounce is the next print on the other side, at any distance. This rule is the distance. A one-tick downtick is the bounce world and is not this signal. The 10 bp is fixed. It is not fit. Transient taker pressure that the book then refills is the account in https://hftradingbook.com/strategies/intraday-mean-reversion .
Who is wrong: the seller whose print is at least 10 bp below the previous print. That print is the signal. It is not our fill. We join one quote step under that already-lower print.
Signal: an aggressor sell with price <= previous price * 0.999. The previous print may be a buy or a sell. The side test is the bounce rule, not this one.
Books: BTC-USD and XRP-USD. Two books, one rule.
""",
    "rxlag": """\
Mechanism: on a liquid crypto book, Bitcoin's trade leads ether's trade at short horizons. The measurement on Binance is that above roughly 15 to 20 milliseconds Bitcoin leads ether, https://www.sotofranco.dev/articles/posts/btc-eth-lead-lag . This account's books print slower than that, so the window is this book's own median gap, not 20 milliseconds. The lead is a print on this venue, not another venue's last, and not a triangle into a second quote currency.
Who is wrong: the seller on ETH-USD or SOL-USD who prints after Bitcoin has already printed an aggressor buy strictly more than 1 bp above Bitcoin's previous print. That follower sell is the signal. It is not our fill. We join one quote step under it on the follower book.
Signal: a follower aggressor sell that is strictly after that Bitcoin buy and no later than the window. ETH-USD window 60000 ms. SOL-USD window 60000 ms. The window is the lower median inter-print gap on the follower's cutoff day, clamped to the closed range 1000 ms through 60000 ms. A Bitcoin buy of 1 bp or less does not lead. A follower sell at the same millisecond does not signal. The leader is not a third scored book.
Books: ETH-USD and SOL-USD. Two books, one rule. Quote step on the follower is ETH-USD 0.01 and SOL-USD 0.001.
""",
    "rxmonday": """\
Mechanism: the Monday return. Caporale and Plastun, Finance Research Letters, 2019, https://www.sciencedirect.com/science/article/pii/S1544612318304240 , found Monday Bitcoin returns higher. Litecoin, XRP and Dash did not show it, and their trading simulation was not distinguishable from a random timing. Mueller, Finance Research Letters, 2024, https://doi.org/10.1016/j.frl.2024.105429 , reports that the Monday effect in Bitcoin does not persist after 2015. The score is the queued print anyway.
Who is wrong: the seller who prints on a Monday, UTC. That print is the signal. It is not our fill. We join one quote step under it. XRP is the second book because the 2019 paper said the effect is not there.
Signal: an aggressor sell whose UTC weekday is Monday. The hour does not matter. Tuesday through Sunday do not signal. This is not a candlestick and not a Saturday dummy.
Books: BTC-USD and XRP-USD. Two books, one rule.
""",
    "rxquiet": """\
Mechanism: a quote that nobody has traded through for longer than the book's own quiet tail is a stale price. A stale price is a quotation with no recent trade, and a fill against it is not a refreshed book, https://learn.greeks.live/area/stale-price/ . The cutoff is a high percentile of the observed gap between prints, not a fixed five seconds, https://sifting.io/blog/stale-market-data-detect-handle-real-time-trading-applications . This is the gap on the tape. It is not a weekend flag and it is not the Monday rule.
Who is wrong: the seller who prints after a silence at least as long as the cutoff day's 95th percentile gap between any two consecutive prints. That print is the signal that the book went quiet. It is not our fill. We were not resting through the silence. We join one quote step under the print that ends it.
Signal: an aggressor sell whose timestamp minus the previous print's timestamp is at least the cutoff. BTC-USD cutoff 322180 ms. XRP-USD cutoff 1072376 ms. Nearest rank of every inter-print gap on the cutoff day, sells and buys together. The percentile is not refit on the score stretch.
Books: BTC-USD and XRP-USD. Two books, one rule.
""",
}


def main() -> None:
    if "SYND-USD" not in CONTINUITY or "SYND-EUR" in CONTINUITY:
        raise SystemExit("continuity list")
    for name, head in HEADS.items():
        text = head + "\n" + CONTINUITY + "\n" + QUEUE
        if "not our fill" not in text:
            raise SystemExit("queue missing %s" % name)
        if "every aggressor sell is our resting bid" not in text:
            raise SystemExit("void sentence missing %s" % name)
        path = OUT / ("pass79_%s_rule.txt" % name)
        path.write_text(text)
        print(name, path.stat().st_size)


if __name__ == "__main__":
    main()
