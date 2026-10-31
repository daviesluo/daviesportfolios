# CRYPTOBOOKS (2026-10-31): method (c), taking Revolut X quotes the outside price has left behind, replayed on the tape.
# Evidence the tape gives: a public taker order whose price was better than the basis-corrected outside fair of the second
# before by more than the 9 bps fee (a "pick", tape.py) took a quote that had gone stale. Its stale run is the seconds
# just before it during which the fair stood beyond the quote's price by more than the threshold T without a break.
# Our take: the same quote, L seconds after its run began (L = how fast we see it: 1 s at pg_cron's finest step, 60 s
# at the loop's minute), only if that is before the observed taker took it (the quote was there until then); its size
# the observed order's (it may have been bigger), capped at the money we have (CAP pounds a side). Our gain at the take:
# side x (fair / price) - 9 bps. The coin (or the pounds) we then hold is closed one of two ways, both marked at the
# basis-corrected fair H s later: at that fair as a 0 % maker (optimistic: it assumes our quote at the fair fills at once),
# or as a taker (the 9 bps fee and the median taker's dev against the fair, from tape.py, 2.5 bps); and, as a check on
# the fair itself, against Revolut X's own later prints (the centre of their buy and sell medians from H/5 to 2H after).
# What this misses: stale quotes nobody took (we would see them too: more takes), and quotes repriced before their run
# began (fewer). Only takes on the side the money allows: a taker buy needs pounds (we hold them), a taker sell needs
# coin, which a pound-only account has only after a buy; reported apart (buy side, both sides).
# Writes results/stale.json. Pure Python, no network.
#   CRYPTOBOOKS_BN=<binance_1s.py's output> python3 -I stale.py BOOK...
import collections, datetime as dt, json, math, os, statistics, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import ROOT, Fair, in_halt, load_tape, takers  # noqa: E402
from replay import basis_steps  # noqa: E402

FEE = 9.0
TAKER_EXIT = 9.0 + 2.5
SPLIT = 1792800000  # 2026-10-24 00:00 UTC: first week in, second week out
DAY = 1793404800  # 2026-10-31 00:00 UTC


def main(books):
    fair = Fair()
    tag = os.environ.get("CRYPTOBOOKS_TAG", "")  # "1031": 2026-10-31's own pull, every parameter fixed before it
    path = os.path.join(ROOT, "results", f"stale{tag}.json")
    res = json.load(open(path)) if os.path.exists(path) else {}
    for book in books:
        try:
            tape = load_tape(book)
            if tag:
                tape = sorted(set(tape + load_tape(book, tag)))
            tape = [r for r in tape if fair.t0 + 400 <= r[0] // 1000 < fair.t1 - 400]
        except (FileNotFoundError, EOFError):
            continue
        F, t0 = fair.series(book), fair.t0
        usd_gbp = (lambda s: 1.0) if book.endswith("-GBP") else (lambda s: 1.0 / fair.fx.at(s))
        steps = basis_steps(tape, F, t0)
        if not steps:
            continue
        st = [s for s, _ in steps]
        import bisect

        def cen(sec):
            i = bisect.bisect_right(st, sec) - 1
            return steps[i][1] if i >= 0 else None

        tk = [o for o in takers(tape) if not in_halt(o[0] // 1000) and (not tag or o[0] // 1000 >= DAY)]
        tms = [r[0] for r in tape]
        span = (tk[-1][0] - tk[0][0]) / 86400e3
        out = {"book": book, "span_days": round(span, 2)}
        for T in (12, 15, 20, 25):
            for L in (1, 5, 10, 30, 60):
                for H in (60, 300):
                    for cap in (600, 1200):
                        rows = []
                        for ms, worst, q, side, vw, k in tk:
                            sec = ms // 1000
                            c = cen(sec - 1)
                            if c is None:
                                continue
                            ec = math.exp(c / 1e4)
                            i = sec - 1 - t0

                            def g(j):
                                return side * 1e4 * math.log(F[j] * ec / vw)

                            if g(i) <= T:
                                continue
                            j = i
                            while j - 1 >= 0 and i - (j - 1) <= 600 and g(j - 1) > T:
                                j -= 1
                            take = j + L
                            if take >= i + 1:  # the observed taker got there first
                                continue
                            gain = g(take) - FEE
                            if take + H >= len(F) or t0 + take + H > tms[-1] // 1000:
                                continue
                            g_exit = side * 1e4 * math.log(F[take + H] * ec / vw)
                            notional = min(q * vw * usd_gbp(sec), cap)
                            # the same exit against Revolut X's own later prints, not our fair: the centre of the
                            # buys' and sells' medians in [take + H/5, take + 2H] (None when either side is missing)
                            a, b = t0 + take + H // 5, t0 + take + 2 * H
                            j0 = bisect.bisect_left(tms, a * 1000)
                            j1 = bisect.bisect_left(tms, b * 1000)
                            bb = [x[1] for x in tape[j0:j1] if x[3] > 0]
                            ss = [x[1] for x in tape[j0:j1] if x[3] < 0]
                            g_rx = (side * 1e4 * math.log((statistics.median(bb) + statistics.median(ss)) / 2 / vw) - FEE
                                    if bb and ss else None)
                            rows.append((t0 + take, side, notional, gain, g_exit - FEE, g_exit - FEE - TAKER_EXIT, g_rx))
                        key = f"T{T}_L{L}_H{H}_C{cap}"
                        if not rows:
                            out[key] = {"takes": 0}
                            continue

                        def agg(rs, span=span):
                            if not rs:
                                return {"takes": 0}
                            mk = sum(r[2] * r[4] / 1e4 for r in rs)
                            tx = sum(r[2] * r[5] / 1e4 for r in rs)
                            days = collections.defaultdict(float)
                            for r in rs:
                                days[dt.datetime.utcfromtimestamp(r[0]).date().isoformat()] += r[2] * r[4] / 1e4
                            rx = [r for r in rs if r[6] is not None]
                            return {"takes": len(rs), "takes_a_day": round(len(rs) / span, 2),
                                    "bps_rx_mid_exit_mean": round(statistics.mean(r[6] for r in rx), 2) if rx else None,
                                    "gbp_a_day_rx_mid_exit": round(sum(r[2] * r[6] / 1e4 for r in rx) / span, 3) if rx else None,
                                    "gbp_a_day_at_take": round(sum(r[2] * r[3] / 1e4 for r in rs) / span, 3),
                                    "gbp_a_day_maker_exit": round(mk / span, 3), "gbp_a_day_taker_exit": round(tx / span, 3),
                                    "bps_at_take_mean": round(statistics.mean(r[3] for r in rs), 2),
                                    "bps_maker_exit_mean": round(statistics.mean(r[4] for r in rs), 2),
                                    "notional_gbp_a_day": round(sum(r[2] for r in rs) / span), "days": dict(sorted(days.items()))}
                        t_a, t_b = tk[0][0] / 1000, tk[-1][0] / 1000
                        span1 = max(0.0, (min(SPLIT, t_b) - t_a) / 86400)
                        span2 = max(0.0, (t_b - max(SPLIT, t_a)) / 86400)
                        out[key] = {"both": agg(rows), "buy_side": agg([r for r in rows if r[1] > 0]),
                                    "in_week1": agg([r for r in rows if r[0] < SPLIT], span1 or 1),
                                    "out_week2": agg([r for r in rows if r[0] >= SPLIT], span2 or 1)}
        res[book] = out
        b = out.get("T15_L1_H300_C600", {}).get("both", {})
        print(book, b.get("takes_a_day"), b.get("gbp_a_day_at_take"), b.get("gbp_a_day_maker_exit"), b.get("gbp_a_day_taker_exit"), flush=True)
    with open(path, "w") as f:
        json.dump(json.loads(json.dumps(res)), f, separators=(",", ":"), sort_keys=True)  # compact: 24 books x 160 cells


if __name__ == "__main__":
    main(sys.argv[1:])
