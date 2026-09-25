#!/usr/bin/env python3
"""Freeze pass 78 rule texts from the cutoff day. Does not read the score tape."""

from __future__ import annotations

import hashlib
import json
import subprocess
from datetime import datetime, timezone
from decimal import Decimal, ROUND_CEILING
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
TAPE = ROOT / "docs/agents/backtests/inputs/fp5_2026-09-25/pass78"
RULES = ROOT / "docs/agents/scripts/fp5"
SCREEN = RULES / "screen_pass78.py"

# 2026-06-16 is the cutoff. The score starts the next midnight and stops
# before 2026-09-25, so 2026-09-24 is the last included day.
THRESHOLD_START = int(datetime(2026, 6, 16, tzinfo=timezone.utc).timestamp() * 1000)
THRESHOLD_END = THRESHOLD_START + 86400000 - 1
SCORE_START = int(datetime(2026, 6, 17, tzinfo=timezone.utc).timestamp() * 1000)
SCORE_END = int(datetime(2026, 9, 25, tzinfo=timezone.utc).timestamp() * 1000) - 1

QUOTE_STEP = {
    "BTC-USD": Decimal("0.01"),
    "ETH-USD": Decimal("0.01"),
    "SOL-USD": Decimal("0.001"),
    "XRP-USD": Decimal("0.0001"),
}
BOOKS = ("BTC-USD", "XRP-USD")
LAG = ("ETH-USD", "SOL-USD")


def nearest_rank(values: list, fraction: Decimal):
    ordered = sorted(values)
    rank = int((fraction * len(ordered)).to_integral_value(rounding=ROUND_CEILING)) - 1
    rank = max(0, min(rank, len(ordered) - 1))
    return ordered[rank]


def lower_median(values: list[int]) -> int:
    ordered = sorted(values)
    return ordered[(len(ordered) - 1) // 2]


def load(stem: str):
    payload = json.loads((TAPE / f"{stem}.json").read_text())
    if payload["region"] != "UK":
        raise SystemExit("region")
    if int(payload["start"]) != THRESHOLD_START or int(payload["end"]) != THRESHOLD_END:
        raise SystemExit("threshold window %s" % stem)
    rows = []
    for row in payload["rows"]:
        rows.append(
            (int(row["timestamp"]), Decimal(row["price"]), Decimal(row["quantity"]), row["side"])
        )
    return rows


def census_sentence() -> str:
    payload = json.loads((TAPE / "continuity.json").read_text())
    rows = payload["rows"]
    full = [row["symbol"] for row in rows if row["at_least_100"]]
    zero = [row["symbol"] for row in rows if row["prints"] == 0]
    errors = [row["symbol"] for row in rows if row["prints"] is None]
    wanted = ["BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD"]
    missing = [name for name in wanted if name not in full]
    if missing:
        raise SystemExit("chosen books are not on a full page: %s" % missing)
    return (
        "Continuity, one UK page on 2026-09-24, start %d end %d, read %s. "
        "Active pairs requested: %d. A full page of 100 prints, with a further cursor: %d. "
        "An empty page: %d (%s). A request that did not return a list: %d. "
        "BTC-USD, ETH-USD, SOL-USD and XRP-USD each returned a full page. "
        "That day is inside the score stretch and only its count is used here. "
        "A year earlier, 2025-09-17, the same four books were pulled in full: "
        "BTC-USD 5450, ETH-USD 6306, SOL-USD 3079, XRP-USD 2902. "
        "Sampled full days in the score stretch, counts only: "
        "2026-06-17 BTC 1098 ETH 434 SOL 290 XRP 402; "
        "2026-07-17 BTC 1173 ETH 370 SOL 540 XRP 218; "
        "2026-08-17 BTC 459 ETH 207 SOL 205 XRP 183; "
        "2026-09-10 BTC 583 ETH 323 SOL 560 XRP 393; "
        "2026-09-17 BTC 479 ETH 319 SOL 448 XRP 506."
        % (
            payload["start"],
            payload["end"],
            payload["read_at"],
            len(rows),
            len(full),
            len(zero),
            ", ".join(zero) if zero else "none",
            len(errors),
        )
    )


def main() -> None:
    impact = {}
    quiet = {}
    for name in BOOKS:
        rows = load(name + "_threshold")
        sells = [row[2] for row in rows if row[3] == "sell"]
        gaps = [rows[i][0] - rows[i - 1][0] for i in range(1, len(rows))]
        impact[name] = nearest_rank(sells, Decimal("0.95"))
        quiet[name] = nearest_rank(gaps, Decimal("0.95"))
    lag = {}
    for name in LAG:
        rows = load(name + "_threshold")
        gaps = [rows[i][0] - rows[i - 1][0] for i in range(1, len(rows))]
        lag[name] = min(60000, max(1000, lower_median(gaps)))
    units = {name: QUOTE_STEP[name] * 100 for name in QUOTE_STEP}
    meta = {
        "threshold_day": "2026-06-16",
        "threshold_start": THRESHOLD_START,
        "threshold_end": THRESHOLD_END,
        "score_start": SCORE_START,
        "score_end": SCORE_END,
        "score_first_day": "2026-06-17",
        "score_last_day": "2026-09-24",
        "quote_step": {name: format(step, "f") for name, step in QUOTE_STEP.items()},
        "round_unit": {name: format(unit, "f") for name, unit in units.items()},
        "impact_qty": {name: format(qty, "f") for name, qty in impact.items()},
        "quiet_ms": quiet,
        "lag_w_ms": lag,
        "gap": "0.001",
        "lead": "0.0001",
        "maker_fee_bps": 0,
    }
    (TAPE / "thresholds.json").write_text(json.dumps(meta, indent=2, sort_keys=True) + "\n")
    shared = shared_text(meta, census_sentence())
    bodies = {
        "rxbounce": bounce_text(),
        "rxadverse": adverse_text(),
        "rximpact": impact_text(impact),
        "rxround": round_text(units),
        "rxgap": gap_text(),
        "rxlag": lag_text(lag),
        "rxmonday": monday_text(),
        "rxquiet": quiet_text(quiet),
    }
    frozen = subprocess.check_output(["date", "-u", "+%Y-%m-%d %H:%M:%S UTC"], text=True).strip()
    (RULES / "pass78.frozen_at").write_text(frozen + "\n")
    digests = {}
    for name, body in bodies.items():
        path = RULES / f"pass78_{name}_rule.txt"
        path.write_text(body + "\n" + shared)
        digests[name] = hashlib.sha256(path.read_bytes()).hexdigest()
    patch_screen(digests, frozen)
    print("frozen", frozen)
    for name, digest in digests.items():
        print(name, digest)


def shared_text(meta: dict, census: str) -> str:
    return f"""Books this account can trade are read with region=UK. EUR is not this account. There is no GBP-USD book. Kraken is not the fill. Spot is not shorted.
{census}
Cutoff day, out of the score: 2026-06-16 00:00:00.000 UTC through 2026-06-16 23:59:59.999 UTC, start {meta["threshold_start"]} end {meta["threshold_end"]}. Prices on that day set the size cutoff, the silence cutoff, and the lag window. They are not trades in the score.
Score stretch: 2026-06-17 00:00:00.000 UTC through 2026-09-24 23:59:59.999 UTC, start {meta["score_start"]} end {meta["score_end"]}. Four calendar months sit in that stretch. The cutoff day is not inside it. An hourly close is not a print. A four-hour close is not a print.
Fill: a public trade from GET /api/1.0/public/trades/all?region=UK. The aggressor side is the print's side. Entry is an aggressor sell. We were the resting bid, filled at that print's price. Exit is the next later aggressor buy on the same book. We were the resting ask, filled at that print's price. One position at a time. A sell that arrives while a position is open is not a second entry. If no later buy prints, the open buy is marked to the last print in the stretch and that mark is a trip. A mark is not a second fill. The entry fee is still the maker fee.
Maker fee is 0 percent on a resting fill. Taker fee is 0.09 percent and is not charged, because this order was resting. The page is https://www.revolut.com/legal/crypto-exchange-fees/ . The archive capture https://web.archive.org/web/20250813002900/https://www.revolut.com/legal/crypto-exchange-fees/ was read 2026-09-25. Its table says Maker fee 0% and Taker fee 0.09%. The live page returned 403. The schedule has no tiers. Doubling a maker fee of 0 is 0. Stress equals the pool. The old 20 bp taker screen charge is not put on these prints.
Gross bps = (exit print / entry print - 1) * 10000. The pool is the equal-weight average of the two books' summed bps. The trip count is the lesser of the two books, marks included. One book is not a second rule.
The edge-off control is every aggressor sell, same walk, filter off. It is not a ninth rule. The null draws that trip count from each book's unfiltered sell-to-next-buy moves, 500 draws without replacement, seed 20260925, index int(0.95*500)-1 = 474.
Kill unless pooled P&L > 0, stress > 0, the lesser trip count is at least 60, both books > 0, pooled P&L > null p95, no calendar month is more than 40% of pooled P&L, and pooled P&L exceeds 400 bps. A count of 0 is scored as 0. The print counts say why. The gate is not lowered. A ban list is not a score.
This is not a quote-currency triangle, not a four-hour forward, not a macro number, not a funding percent used as a price, not a taker print against an external dollar, not a candlestick, not a company cost, and not an hourly close treated as a fill at 0.9999. rxpar is not recomputed. The five earlier numeric clears and the confirmation-time fall after a higher day stay void.
A numeric clear is still not a testing row. reached_preregistration stays false. No order of this account was shown crossing the book. Do not arm. Do not push main. Do not open a pull request.
Frozen before any print in the score stretch was joined to a P&L.
"""


def bounce_text() -> str:
    return """Mechanism: bid-ask bounce. Roll, Journal of Finance 39(4), 1984, https://onlinelibrary.wiley.com/doi/10.1111/j.1540-6261.1984.tb03897.x . A transaction print alternates between the bid and the ask, so the change after a buy-then-sell is the spread, not a new value. The same bounce is described at https://hftradingbook.com/data/bid-ask-bounce . On a Bitcoin book the trade-to-trade change is negatively autocorrelated at the first lags, https://doi.org/10.3390/jrfm12010025 .
Who is wrong: the seller who hits the bid on the print immediately after an aggressor buy. The previous print lifted the ask. This print sells the bid. That seller traded the other side of the spread. We are the resting bid, filled by this sell print.
Entry print: an aggressor sell whose previous print on the same book is an aggressor buy. Any price. The first print of the stretch has no previous print and does not enter.
Exit print: the next aggressor buy, if it is still in the stretch. If it is not, mark the last print. The fee on each resting fill is maker, 0%. A mark pays no second fee.
Books: BTC-USD and XRP-USD. Two books, one rule.
"""


def adverse_text() -> str:
    return """Mechanism: adverse selection on a continuing sell, the opposite of a bounce. Trade signs are positively autocorrelated, so a sell after a sell is continuation, not a reversal. Lillo, Farmer, and coauthors, https://www.long-memory.com/returns/LilloFarmer2004.pdf . On Bitfinex, adverse selection is about a tenth of the effective spread, https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4175306 . The maker who was filled by that second sell sold liquidity to someone who kept selling.
Who is wrong: the resting bid, if the seller is informed. The seller who hits the bid after another sell is not the bounce seller. We still get filled, at this print, and the score is whether that fill is paid back by the next buy.
Entry print: an aggressor sell whose previous print on the same book is also an aggressor sell. A sell after a buy is the bounce rule and is not this one.
Exit print: the next aggressor buy, or a mark to the last print if that buy is absent. Fee on the resting fill is maker, 0%.
Books: BTC-USD and XRP-USD. Two books, one rule.
"""


def impact_text(impact: dict) -> str:
    btc = impact["BTC-USD"]
    xrp = impact["XRP-USD"]
    return f"""Mechanism: a large aggressive sell pushes through the bid and the price reverts as the book refills. The reversal grows with the size of the aggressive flow, https://arxiv.org/abs/2608.21888 . Their scored signal was the sign of a 15-minute candle. That candle is not this rule. The same temporary pressure is described at https://hftradingbook.com/strategies/intraday-mean-reversion .
Who is wrong: the large seller who lifts quantity through the bid. We are the resting bid that this print fills.
Entry print: an aggressor sell whose base quantity is at least the cutoff day's own 95th percentile of aggressor-sell quantities. Nearest rank, ceiling. BTC-USD cutoff {btc} base. XRP-USD cutoff {xrp} base. The percentile is sells only. A large buy is not an entry.
Exit print: the next aggressor buy, or a mark to the last print if that buy is absent. Fee on the resting fill is maker, 0%.
Books: BTC-USD and XRP-USD. Two books, one rule. The cutoff is not refit on the score stretch.
"""


def round_text(units: dict) -> str:
    return f"""Mechanism: prices cluster on round numbers, and the cluster is not a return. Urquhart, Economics Letters 159 (2017) 145-148, https://doi.org/10.1016/j.econlet.2017.07.035 , found Bitcoin trades pile up on round prices and found no significant return pattern after the round print. Harris, Review of Financial Studies 4(3), 1991, is the older stock result that traders prefer those prices. The score is the return anyway.
Who is wrong: the seller who hits a bid sitting on a round price, 100 quote steps. The quote step was read from GET /api/1.0/public/configuration/pairs on 2026-09-25. BTC-USD quote step 0.01, so the unit is {units["BTC-USD"]}. XRP-USD quote step 0.0001, so the unit is {units["XRP-USD"]}. A price lands on the unit when price modulo the unit is 0.
Entry print: an aggressor sell whose price is on that unit. We are the resting bid at that printed price.
Exit print: the next aggressor buy, or a mark to the last print if that buy is absent. Fee on the resting fill is maker, 0%.
Books: BTC-USD and XRP-USD. Two books, one rule. A different round multiple is not a second rule.
"""


def gap_text() -> str:
    return """Mechanism: a print that falls at least 10 bp through the previous print has overshot one spread. The bid-ask bounce is the next print on the other side, at any distance. This rule is the distance. A one-tick downtick is the bounce world and is not this entry. The 10 bp is fixed. It is not fit. Transient taker pressure that the book then refills is the account in https://hftradingbook.com/strategies/intraday-mean-reversion .
Who is wrong: the seller whose print is at least 10 bp below the previous print. They sold through more than a retail spread. We are the resting bid filled at that lower print.
Entry print: an aggressor sell with price <= previous price * 0.999. The previous print may be a buy or a sell. The side test is the bounce rule, not this one.
Exit print: the next aggressor buy, or a mark to the last print if that buy is absent. Fee on the resting fill is maker, 0%.
Books: BTC-USD and XRP-USD. Two books, one rule.
"""


def lag_text(lag: dict) -> str:
    return f"""Mechanism: on a liquid crypto book, Bitcoin's trade leads ether's trade at short horizons. The measurement on Binance is that above roughly 15 to 20 milliseconds Bitcoin leads ether, https://www.sotofranco.dev/articles/posts/btc-eth-lead-lag . This account's books print slower than that, so the window is this book's own median gap, not 20 milliseconds. The lead is a print on this venue, not another venue's last, and not a triangle into a second quote currency.
Who is wrong: the seller on ETH-USD or SOL-USD who hits the bid after Bitcoin has already printed an aggressor buy strictly more than 1 bp above Bitcoin's previous print. Their book has not caught the leader. We are the resting bid on the follower, filled by that sell.
Entry print: a follower aggressor sell that is strictly after that Bitcoin buy and no later than the window. ETH-USD window {lag["ETH-USD"]} ms. SOL-USD window {lag["SOL-USD"]} ms. The window is the lower median inter-print gap on the follower's cutoff day, clamped to the closed range 1000 ms through 60000 ms. A Bitcoin buy of 1 bp or less does not lead. A follower sell at the same millisecond does not enter.
Exit print: the next aggressor buy on that same follower book, or a mark to the last print on that book if the buy is absent. Fee on the resting fill is maker, 0%.
Books: ETH-USD and SOL-USD, one rule, leader BTC-USD. The leader is not a third scored book.
"""


def monday_text() -> str:
    return """Mechanism: the Monday return. Caporale and Plastun, Finance Research Letters, 2019, https://www.sciencedirect.com/science/article/pii/S1544612318304240 , found Monday Bitcoin returns higher. Litecoin, XRP and Dash did not show it, and their trading simulation was not distinguishable from a random timing. Mueller, Finance Research Letters, 2024, https://doi.org/10.1016/j.frl.2024.105429 , reports that the Monday effect in Bitcoin does not persist after 2015. The score is the print anyway.
Who is wrong: the seller who hits the bid on a Monday, UTC. The claim is that Monday's sale is the cheap side of a weekly pattern. We are the resting bid filled by that Monday sell. XRP is the second book because the 2019 paper said the effect is not there.
Entry print: an aggressor sell whose UTC weekday is Monday. The hour does not matter. Tuesday through Sunday do not enter. This is not a candlestick and not a Saturday dummy.
Exit print: the next aggressor buy, which may fall on a later day, or a mark to the last print if that buy is absent. Fee on the resting fill is maker, 0%.
Books: BTC-USD and XRP-USD. Two books, one rule.
"""


def quiet_text(quiet: dict) -> str:
    return f"""Mechanism: a quote that nobody has traded through for longer than the book's own quiet tail is a stale price. A stale price is a quotation with no recent trade, and a fill against it is not a refreshed book, https://learn.greeks.live/area/stale-price/ . The cutoff is a high percentile of the observed gap between prints, not a fixed five seconds, https://sifting.io/blog/stale-market-data-detect-handle-real-time-trading-applications . This is the gap on the tape. It is not a weekend flag and it is not the Monday rule.
Who is wrong: the seller who hits the bid after a silence at least as long as the cutoff day's 95th percentile gap between any two consecutive prints. The bid was not refreshed by a trade. We are that resting bid, filled at the sell print that ends the silence.
Entry print: an aggressor sell whose timestamp minus the previous print's timestamp is at least the cutoff. BTC-USD cutoff {quiet["BTC-USD"]} ms. XRP-USD cutoff {quiet["XRP-USD"]} ms. Nearest rank of every inter-print gap on the cutoff day, sells and buys together. The percentile is not refit on the score stretch.
Exit print: the next aggressor buy, or a mark to the last print if that buy is absent. Fee on the resting fill is maker, 0%.
Books: BTC-USD and XRP-USD. Two books, one rule.
"""


def patch_screen(digests: dict, frozen: str) -> None:
    text = SCREEN.read_text()
    for name, digest in digests.items():
        old = f'"{name}": "PENDING"'
        new = f'"{name}": "{digest}"'
        if old not in text:
            raise SystemExit("missing pending %s" % name)
        text = text.replace(old, new, 1)
    old_frozen = 'FROZEN_AT = "PENDING"'
    if old_frozen not in text:
        raise SystemExit("missing frozen placeholder")
    text = text.replace(old_frozen, 'FROZEN_AT = "%s"' % frozen, 1)
    SCREEN.write_text(text)


if __name__ == "__main__":
    main()
