#!/usr/bin/env python3
"""Write the eight pass-80 rule texts. Does not score and does not read P&L."""

from pathlib import Path

OUT = Path(__file__).resolve().parent

TAIL = """\
Books: BTC-USD and XRP-USD. Two books, one rule. Every print that the queue names posts, while flat. There is no second filter on which of those prints post. Pass 79's bounce, adverse, size, round-print, gap, Monday, and quiet filters are not this rule. The one-tick-under queue with a swapped signal is not this rule.
The print that posts the bid is public information from GET /api/1.0/public/trades/all?region=UK. This account was not in the book. That print is not our order and is not our fill. One order at a time. A further trigger while the bid is working, or while a position is long, does not post a second bid.
The fill is a later aggressor sell whose price is less than or equal to the bid. The fill price is that later print's price. If the tape ends while the bid is still working, left_working, and that is not a trip. If the tape ends while long, the position is marked to the last print and the mark is a trip.
Quote steps, read 2026-09-25: BTC-USD 0.01, XRP-USD 0.0001. Round units are 100 times the quote step: BTC-USD 1.00, XRP-USD 0.0100. The quiet cutoffs, from the 2026-06-16 tape and not refit, are BTC-USD 322180 ms and XRP-USD 1072376 ms. A time cancel uses a print strictly later than that cutoff. A print at exactly the cutoff can still fill.
Maker fee on a resting fill is 0 percent. A doubled maker fee of 0 is not the stress. Stress bps = ((exit print - one quote step) / (entry print + one quote step) - 1) * 10000, including when the queue or the exit used a different distance. Base bps = (exit print / entry print - 1) * 10000. The pool is the equal-weight average of the two books' summed base bps. The trip count is the lesser of the two books. A count of 0 is scored as 0.
The comparison is the pass-79 every-sell queue on these same two books: every aggressor sell posts one quote step under itself, a later sell at or under that bid fills, a buy cancels, and the exit is one quote step above the fill. That pool is 1687.4610546575 bp. It is recomputed from the same tapes and it is not a ninth rule. Beating it is not a gate. The null draws the lesser trip count from each book's own trips under THIS queue, 500 draws without replacement, seed 20260925, index int(0.95*500)-1 = 474. If that count is longer than either book, the null is undefined and the null gate fails. rximpact and rxmonday stay failed on that undefined null. Their queues are not rewritten.
Kill unless pooled base P&L > 0, stress > 0, the lesser trip count is at least 60, both books' base P&L > 0, pooled base P&L > null p95, no calendar month is more than 40% of pooled base P&L, and pooled base P&L exceeds 400 bps. The 40% month gate is not widened. The gate is not lowered.
This is not a quote-currency triangle, not a four-hour forward, not a macro number, not a funding percent used as a price, not a taker print against an external dollar, not a candlestick, not a company cost, and not an hourly close treated as a fill at 0.9999. Pass 78's sentence that the signal sell is our bid stays void. rxpar is not recomputed. The five earlier numeric clears and the confirmation-time fall after a higher day stay void.
A numeric clear is still not a testing row. reached_preregistration stays false. No order of this account was shown crossing the book. Do not arm. Do not push main. Do not open a pull request.
Tapes: docs/agents/backtests/inputs/fp5_2026-09-25/pass78/, region=UK, 2026-06-17 00:00:00.000 UTC through 2026-09-24 23:59:59.999 UTC. The cutoff day 2026-06-16 is not inside the score.
Frozen before any print in the score stretch was joined to a P&L under this queue.
"""

HEADS = {
    "rxat": """\
Queue: after every aggressor sell, while flat, the bid is that sell's own price. Not one quote step under it. A later sell at the same price reaches the bid. The sell that posted the bid does not.
Cancel: an aggressor buy before that later sell cancels the bid. A cancel is not a trip.
Exit: the first later aggressor buy at or above the fill plus one quote step.
Who is wrong: the next seller who trades at a price the previous sell already printed. Biais, Hillion, and Spatt, Journal of Finance 50(5), 1995, pages 1655-1689, https://doi.org/10.1111/j.1540-6261.1995.tb05192.x , found orders join near the quote. This join is the printed price, not a tick behind it.
""",
    "rxprev": """\
Queue: after every aggressor sell, while flat, the bid is the previous print minus one quote step. The bid follows the print before the sell, not the sell. The first print has no previous print and does not post. The bid may sit above the sell that posted it. That sell still does not fill us.
Cancel: an aggressor buy before a later sell at or under the bid cancels the bid. A cancel is not a trip.
Exit: the first later aggressor buy at or above the fill plus one quote step.
Who is wrong: the seller who comes back to the price that was trading before the latest sell. The queue is that earlier price, one step under it.
""",
    "rxfloor": """\
Queue: after every aggressor sell, while flat, the bid is the round unit strictly below that sell. The unit is 1.00 on BTC-USD and 0.0100 on XRP-USD. A sell already on the unit posts one unit further below. A later sell must trade at or under that round price. This is not the pass-79 rule that entered only when the sell itself was on the unit.
Cancel: an aggressor buy before that later sell cancels the bid. A cancel is not a trip.
Exit: the first later aggressor buy at or above the fill plus one quote step.
Who is wrong: the seller who trades through the round price under the last sell. Harris, Review of Financial Studies 4(3), 1991, is the clustering result. Urquhart, Economics Letters 159 (2017) 145-148, https://doi.org/10.1016/j.econlet.2017.07.035 , found no return after a round print. The queue is the round price anyway.
""",
    "rxstay": """\
Queue: after every aggressor sell, while flat, the bid is that sell minus one quote step. The price is the pass-79 join. The cancel is not. An aggressor buy does not cancel the bid. The bid stays until a later sell trades at or under it, or the tape ends. There is no signal filter on which sells post.
Cancel: none on a buy. A bid still working at the end is not a trip.
Exit: the first later aggressor buy at or above the fill plus one quote step.
Who is wrong: a seller who reaches the resting bid after the other side has already traded. Hasbrouck and Saar, Journal of Financial Markets 12(2), 2009, pages 143-172, https://doi.org/10.1016/j.finmar.2008.06.002 , measured orders that cancel within two seconds. This bid does not cancel when a buy prints.
""",
    "rxclock": """\
Queue: after every aggressor sell, while flat, the bid is that sell minus one quote step. Every sell posts. A print whose timestamp is strictly more than the book's quiet cutoff after the post cancels the bid, and that print does not fill, even if it is a sell at the bid. BTC-USD cutoff 322180 ms. XRP-USD cutoff 1072376 ms. A print at exactly the cutoff can fill. The cutoff is not refit.
Cancel: an aggressor buy before the fill cancels the bid, and so does the quiet-cutoff print. A cancel is not a trip.
Exit: the first later aggressor buy at or above the fill plus one quote step.
Who is wrong: a seller who reaches the bid before the book's own quiet tail has passed. The same Hasbrouck and Saar paper is the fleeting-order result. Their window was two seconds. This book's window is its own cutoff-day 95th percentile gap, because these prints are slower than that.
""",
    "rxtwo": """\
Queue: after every aggressor sell, while flat, the bid is that sell minus one quote step. Every sell posts. There is no signal filter.
Cancel: an aggressor buy before the fill cancels the bid. A cancel is not a trip.
Exit: the first later aggressor buy at or above the fill plus two quote steps. A buy one step above the fill does not exit. The stress is still one quote step on the entry print and one quote step on the exit print, not two.
Who is wrong: the buyer who pays two quote steps above the fill. The exit distance is the rule. The join is not a new signal.
""",
    "rxnext": """\
Queue: after every aggressor sell, while flat, the bid is that sell minus one quote step. Every sell posts. There is no signal filter.
Cancel: an aggressor buy before the fill cancels the bid. A cancel is not a trip.
Exit: the next aggressor buy after the fill, at that buy's price, even when the price is below the fill. There is no ask above the fill. The stress is still one quote step against the entry print and one quote step against that exit print.
Who is wrong: nobody on the exit. The exit is the next buy print, whatever it is. The queue is what is being scored against the one-tick-under rule's own exit.
""",
    "rxpost": """\
Queue: after every aggressor buy, while flat, the bid is that buy minus one quote step. A sell does not post. This is not a bid under a sell. The buy that posts the bid does not fill us. The fill is a later sell at or under that bid.
Cancel: a later aggressor buy before that sell cancels the bid. A cancel is not a trip.
Exit: the first later aggressor buy at or above the fill plus one quote step.
Who is wrong: the seller who trades back through the price one step under a buy. Biais, Hillion, and Spatt, the same 1995 paper, found both quotes move after a purchase. The bid here is posted after the buy, one step under it.
""",
}


def main() -> None:
    if len(HEADS) != 8:
        raise SystemExit("count")
    for name, head in HEADS.items():
        text = head + "\n" + TAIL
        if "not our fill" not in text or "1687.4610546575" not in text:
            raise SystemExit("tail missing %s" % name)
        if "swapped signal is not this rule" not in text:
            raise SystemExit("filter ban missing %s" % name)
        (OUT / ("pass80_%s_rule.txt" % name)).write_text(text)
        print(name)


if __name__ == "__main__":
    main()
