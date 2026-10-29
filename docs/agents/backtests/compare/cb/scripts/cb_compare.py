"""CMP-CB: the Coinbase half of the strategy comparison of 2026-10-29. Davies: "测一下目前最新的revolut x的live以及variant7和8以及7和8的
结合，与最新的coinbase的 with euros和with euros-2的这几个的表现对比，每个策略都按单币种分开测，分别按600磅和1200磅 2400磅测三轮看对比（按年化收益率，
需真实反映未来12个月的期待）". The Revolut X half is another study's; the coordinator merges them on the shared method
(`docs/agents/reviews/2026-10-29-strategy-compare-cb.md` §2).

THE ROWS, as they run from 2026-10-29 10:00 UTC (the page's names):
  "Stablecoin quotes with Euros"      cb_hold.ts: PR5's `stepMinute`, the rates held through a closure up to 60 hours;
  "Stablecoin quotes with Euros - 2"  cb_nudge.ts: the same rule on USDC-GBP with its fair nudged inside FX closures by Revolut X's
                                      USDC-GBP mid (`nudgeStep`, ported in fx_speed/scripts/cb_long.py). Revolut X's book is recorded
                                      from 2026-10-09 only: before that the row runs without the nudge (it is then exactly the first
                                      row on USDC-GBP), from then with it. Its rule needs Revolut X's USDC-GBP book, so it is run on
                                      USDC-GBP alone.
Both: the coin at Coinbase's own value (`cb_live`: USDC 1, USDT Coinbase USDT-USD's newest one-minute close of [t − 10, t − 1] min)
with the 50 bps de-peg guard against Revolut X's F3 (from 2025-11-22, when its hours exist); the [T − 1, T + 5] blackout around
every scheduled release (`cbreview/inputs/release_calendar.json`); the rate as the switch of 2026-10-29 reads it (`cb_fx.ts`: the
newest `fx_ticks` read that arrived by t + 58 s, at its own level), modelled as Exness's last tick at t + 57 s (FX-SPEED-LONG's
L3_raw, review §8.3), held through a closure on the last value; Coinbase's taker fee plus half the touch on the 24-hour stop.

ONE BOOK AT A TIME, all the capital on it: £600, £1,200 or £2,400, six rungs of a sixth each (£100, £200, £400), as the
engines size a rung (`stepMinute` at `QUOTE_SIZE_USD` × the factor), capped at 10 % of the minute's printed value. A EUR book's
rung is its pounds in euros at the minute's EUR/GBP (the simulator's X is the pounds per unit of the book's currency), and its
P&L comes back in pounds at the exit minute's rate.

THE RECORD: SCQ-VENUES' Coinbase minute bars 2024-10-01 → 10-08 (proven to replay as the prints do), then the engines' own minute
record 10-10 → 10-28 (`fair_price_cb_okx/inputs/prod`), one continuous book; 2026-10-09 has no prints in either (orders rest,
nothing fills). PR5's frozen `pr5_sim.simulate`, imported unchanged.

usage: python3 -I cb_compare.py EXNESS_LONG.txt.gz OUT.json.gz   (EXNESS_LONG from fx_speed/scripts/exness_long.py build)
"""
import collections, datetime, gzip, json, multiprocessing as mp, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
BT = os.path.normpath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, os.path.join(BT, "fx_speed", "scripts"))
import numpy as np  # noqa: E402
import cb_long as CL  # noqa: E402  (FX-SPEED-LONG: the X columns, the coin, the releases, the nudge, the simulator call)
import exness_long as EL  # noqa: E402

C, HI, SI, BR, P = CL.C, CL.HI, CL.SI, CL.BR, CL.P
M, H, DAY = CL.M, CL.H, CL.DAY
T0 = CL.T0H                                   # 2024-10-01
TH = CL.T1H                                   # 2026-10-09: the bars end, the production record starts 10-10
T1 = CL.TP1                                   # 2026-10-29
BOOKS = ["USDC-GBP", "USDT-GBP", "USDC-EUR", "USDT-EUR"]
CAPITALS = [600.0, 1200.0, 2400.0]
RUNGS = 6
ROWS = {"with_euros": BOOKS, "with_euros_2": ["USDC-GBP"]}
XNAME = "L3_raw"


class Book:
    """The fields `simulate` reads, over [T0, T1): the history's bars, then the production record's minutes."""

    def __init__(self, b, tick):
        bars, _ = SI.load_bars("coinbase:" + b)
        hist = {k: v for k, v in bars.items() if int(k) * M < TH}
        prints = BR.prints_from_bars(hist, tick)
        qvol = {int(k): v[8] for k, v in hist.items()}
        for m, r in sorted(C.load_minutes(b).items()):
            t = m * M
            if not (TH <= t < T1) or r["prints_n"] == 0:
                continue
            tk = lambda p: (lambda v: int(round(v)) if abs(v - round(v)) < 1e-6 else v)(float(p) / tick)
            for c, side in (("sell_lo", "sell"), ("buy_lo", "buy"), ("sell_hi", "sell"), ("buy_hi", "buy")):
                if r[c] is not None:
                    prints.append((t, tk(r[c]), 0.0, side))
            prints.append((t, tk(r["last"]), 0.0, r["last_side"]))
            qvol[m] = r["vol"]
        prints.sort(key=lambda p: p[0])
        self.book, self.t0, self.n = b, T0, (T1 - T0) // M
        self.all_prints = prints
        self.pts = [p[0] for p in prints]
        self.by_min = collections.defaultdict(list)
        for p in prints:
            if T0 <= p[0] < T1:
                self.by_min[(p[0] - T0) // M].append(p)
        self.qvol = {i: qvol[(T0 // M) + i] for i in self.by_min}
        self.X, self.F = [None] * self.n, [None] * self.n

    def last_before(self, t_ms):
        import bisect
        k = bisect.bisect_left(self.pts, t_ms) - 1
        return None if k < 0 else (self.all_prints[k][1], self.all_prints[k][3])

    def last_at_or_before(self, t_ms):
        import bisect
        k = bisect.bisect_right(self.pts, t_ms) - 1
        return self.all_prints[k][1] if k >= 0 else None


def revx_hours_all():
    """Revolut X's USD-book hourly closes for the guard: the history's (to 10-09), then the production pulls."""
    h = {c: dict(v) for c, v in HI.revx_hours().items()}
    for c, v in C.load_hours_revx().items():
        h.setdefault(c, {}).update(dict(v))
    return {c: sorted(v.items()) for c, v in h.items()}


def task(args):
    b, = args
    tick = C.TICK[b]
    B = Book(b, tick)
    n = B.n
    i0 = (T0 - EL.FROM) // M
    pair = CL.PAIR[C.QUOTE[b]]
    sz = CL.sizing()
    gbp = sz["GBPUSD"][i0:i0 + n]
    B.X = [1.0] * n if pair == "GBPUSD" else [float(v) for v in sz["EURUSD"][i0:i0 + n] / gbp]
    ut, uv = CL.usdt_minutes()
    rx = revx_hours_all()[C.COIN[b]]
    ts = [T0 + i * M for i in range(n)]
    U = CL.coin_value(C.COIN[b], ts, ut, uv, C.F3(rx), rx[0][0] + DAY)
    blk = CL.blackout_mask(T0, n, CL.releases())
    xs, lit = CL.x_columns(pair, True)
    X = xs[XNAME][i0:i0 + n]
    F = [None if (blk[i] or U[i] is None or np.isnan(X[i])) else U[i] / float(X[i]) for i in range(n)]
    half = json.load(open(os.path.join(BT, "scq_venues", "inputs", "touch.json")))["coinbase:" + b]["half_spread"]
    out = {}
    fairs = {"with_euros": F}
    if b in ROWS["with_euros_2"]:
        fairs["with_euros_2"] = CL.nudge_fair(ts, F, CL.rx_mids())
    meta = {"minutes": n, "lit": sum(1 for f in F if f), "nudged": sum(1 for a, c in zip(F, fairs.get("with_euros_2", F)) if a and c and a != c)}
    for row, Fv in fairs.items():
        for cap in CAPITALS:
            tr = CL.sim(B, Fv, cap / RUNGS, tick, half)
            out[f"{row}|{b}|{int(cap)}"] = [[x["t_entry"], x["t_exit"], round(x["pnl_usd"], 6), round(x["notional_usd"], 4), x["how"][0]] for x in tr]
    # the check: on the history alone the combined book is SCQ-VENUES' BarBook, trip for trip (trips closed before 10-08)
    if b == "USDC-GBP":
        BB = BR.BarBook("coinbase:" + b, {str(k): v for k, v in SI.load_bars("coinbase:" + b)[0].items()}, T0, TH, [], [], [], [], tick, gbp=True)
        BB.X = B.X[:BB.n]
        ref = CL.sim(BB, F[:BB.n], 100.0, tick, half)
        cut = TH - DAY
        # (as sorted lists: trips closed in one minute come back in rung order, which neither book fixes)
        a = sorted((x["t_entry"], x["t_exit"], round(x["pnl_usd"], 6)) for x in ref if x["t_exit"] < cut)
        c = sorted((x[0], x[1], x[2]) for x in out[f"with_euros|{b}|600"] if x[1] < cut)
        meta["check_barbook"] = {"trips": len(a), "equal": a == c}
    print(b, meta, {k: (len(v), round(sum(x[2] for x in v), 2)) for k, v in out.items()}, flush=True)
    return out, {b: meta}


def main(ex_path, out_path):
    CL.EX = EL.Long(ex_path)
    with mp.get_context("fork").Pool(4) as pool:
        parts = pool.map(task, [(b,) for b in BOOKS])
    runs, meta = {}, {}
    for r, m in parts:
        runs.update(r); meta.update(m)
    json.dump({"window": {"T0": T0, "TH": TH, "T1": T1}, "capitals": CAPITALS, "rungs": RUNGS, "x": XNAME, "runs": runs, "meta": meta},
              gzip.open(out_path, "wt"))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
