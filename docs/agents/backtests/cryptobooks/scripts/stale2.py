# CRYPTOBOOKS-2 (2026-10-31): method (c), taking stale ladder quotes, as a short study to rank it (stale.py's evidence
# rule, unchanged: a public taker order that beat the basis-corrected fair by more than T bps proves a stale quote stood
# there through its stale run). Added here:
#  - one take open at a time a book (capital CAP pounds; a take while one is open is skipped), so the money is netted;
#  - each take closed H s later two ways: as a taker at the fair less 9 + 2.5 bps, and at Revolut X's own later mid
#    (the centre of the buy and sell medians from H/5 to 2H after; stale.py's check of the fair);
#  - the daily P&L, P(mean <= 0) by a circular block bootstrap of days (3-day blocks), in / out weeks, 10-31 apart;
#  - the latency curve L = 1, 2, 5, 15, 30, 60 s and the threshold T = 12, 15, 20, 25 bps;
#  - an upper bound on the IOCs a live version would send: the seconds the outside price moved T bps or more over 60 s
#    (where a stale quote could be standing), counted once a run.
# Writes results/stale2.json. Pure Python, no network.
#   CRYPTOBOOKS_BN=<binance_1s.py's output> python3 -I stale2.py [--tag 1031] BOOK...
import bisect, collections, datetime as dt, json, math, os, statistics, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import ROOT, Fair, in_halt, load_tape, takers  # noqa: E402
from replay import basis_steps  # noqa: E402
from rule import boot  # noqa: E402

FEE, TAKER_EXIT = 9.0, 11.5
SPLIT, DAY31 = 1792800000, 1793404800


def study(book, fair, tag):
    tape = load_tape(book)
    if tag:
        try:
            tape = sorted(set(tape + load_tape(book, tag)))
        except FileNotFoundError:
            pass
    tape = [r for r in tape if fair.t0 + 400 <= r[0] // 1000 < fair.t1 - 400]
    F, t0 = fair.series(book), fair.t0
    usd_gbp = (lambda s: 1.0) if book.endswith("-GBP") else (lambda s: 1.0 / fair.fx.at(s))
    steps = basis_steps(tape, F, t0)
    st = [s for s, _ in steps]
    tk = [o for o in takers(tape) if not in_halt(o[0] // 1000)]
    tms = [r[0] for r in tape]
    last = tape[-1][0] // 1000
    out = {}
    for T in (12, 15, 20, 25):
        for L in (1, 2, 5, 15, 30, 60):
            for H in (60, 300):
                cap = 600.0
                busy_until = 0
                rows = []
                for ms, worst, q, side, vw, k in tk:
                    sec = ms // 1000
                    i_ = bisect.bisect_right(st, sec - 1) - 1
                    if i_ < 0:
                        continue
                    ec = math.exp(steps[i_][1] / 1e4)
                    i = sec - 1 - t0
                    g = lambda j: side * 1e4 * math.log(F[j] * ec / vw)  # noqa: E731
                    if g(i) <= T:
                        continue
                    j = i
                    while j - 1 >= 0 and i - (j - 1) <= 600 and g(j - 1) > T:
                        j -= 1
                    take = j + L
                    if take >= i + 1 or t0 + take < busy_until or t0 + take + 2 * H > last:
                        continue
                    busy_until = t0 + take + H
                    notional = min(q * vw * usd_gbp(sec), cap)
                    g_exit = g(take + H) - FEE - TAKER_EXIT
                    a, b = t0 + take + H // 5, t0 + take + 2 * H
                    j0, j1 = bisect.bisect_left(tms, a * 1000), bisect.bisect_left(tms, b * 1000)
                    bb = [x[1] for x in tape[j0:j1] if x[3] > 0]
                    ss = [x[1] for x in tape[j0:j1] if x[3] < 0]
                    g_rx = side * 1e4 * math.log((statistics.median(bb) + statistics.median(ss)) / 2 / vw) - FEE if bb and ss else None
                    rows.append((t0 + take, side, notional, g(take) - FEE, g_exit, g_rx))
                days = collections.defaultdict(lambda: [0.0, 0.0])
                d_all = sorted({dt.datetime.utcfromtimestamp(o[0] / 1000).date().isoformat() for o in tk})
                for d in d_all:
                    days[d]
                for r in rows:
                    d = dt.datetime.utcfromtimestamp(r[0]).date().isoformat()
                    days[d][0] += r[2] * r[4] / 1e4
                    days[d][1] += r[2] * (r[5] if r[5] is not None else r[4]) / 1e4
                tx = [days[d][0] for d in sorted(days)]
                rx = [days[d][1] for d in sorted(days)]
                w1 = [days[d][0] for d in sorted(days) if d < "2026-10-24"]
                w2 = [days[d][0] for d in sorted(days) if "2026-10-24" <= d < "2026-10-31"]
                d31 = [days[d][0] for d in sorted(days) if d >= "2026-10-31"]
                out[f"T{T}_L{L}_H{H}"] = {
                    "takes": len(rows), "takes_a_day": round(len(rows) / max(1, len(days)), 2),
                    "taker_exit_a_day": round(sum(tx) / max(1, len(tx)), 3), "rx_mid_exit_a_day": round(sum(rx) / max(1, len(rx)), 3),
                    "p_days_taker_exit": boot(tx, 3), "p_days_rx_mid": boot(rx, 3),
                    "week1_a_day": round(sum(w1) / len(w1), 3) if w1 else None, "week2_a_day": round(sum(w2) / len(w2), 3) if w2 else None,
                    "d31_total": round(sum(d31), 3) if d31 else None,
                    "days_pos": sum(1 for x in tx if x > 0), "days_n": len(tx),
                    "bps_take_mean": round(statistics.mean(r[3] for r in rows), 2) if rows else None,
                    "worst_day": round(min(tx), 2) if tx else None, "days": {d: round(days[d][0], 3) for d in sorted(days)}}
    # IOC upper bound: runs of seconds with the outside 60-s move >= T
    ioc = {}
    for T in (12, 15, 20):
        n, inrun = 0, False
        for i in range(60, len(F)):
            m = abs(1e4 * math.log(F[i] / F[i - 60])) >= T
            if m and not inrun:
                n += 1
            inrun = m
        ioc[T] = round(n / (len(F) / 86400), 1)
    out["ioc_upper_a_day"] = ioc
    return out


def main(args):
    tag = ""
    if args and args[0] == "--tag":
        tag, args = args[1], args[2:]
    fair = Fair()
    path = os.path.join(ROOT, "results", "stale2.json")
    res = json.load(open(path)) if os.path.exists(path) else {}
    for b in args:
        res[b + tag] = study(b, fair, tag)
        x = res[b + tag]["T15_L1_H300"]
        print(b, x["takes_a_day"], x["taker_exit_a_day"], x["rx_mid_exit_a_day"], x["p_days_taker_exit"], x["week1_a_day"], x["week2_a_day"],
              x["d31_total"], flush=True)
    with open(path, "w") as f:
        json.dump(json.loads(json.dumps(res)), f, separators=(",", ":"), sort_keys=True)


if __name__ == "__main__":
    main(sys.argv[1:])
