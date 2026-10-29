"""The OKX twins' own engine replayed on the recorded tape (okx_replay.ts), its inputs prepared here from the committed pulls.

For each book, each minute of its window: the EUR/USD the engine reads (`fxBarAt`, the newest Yahoo bar of the last ten
minutes; in a closure null, so the engine holds its last as `okxXAt` does), GBP/USD, the prints, the recorded touch, and the
fair of each candidate expressed as the EUR/USD that gives it through `okxFair` (USDG-EUR's fair is 1 / x, EURC-USDC's is x),
so `stepOkxMinute` is called unchanged. Candidates: par (the rows' rule), par × (1 + a × the trailing median of the book's
earlier prints over par − 1) for L = 24 h and a = 0.5 and 1, and Coinbase's USDC-EUR touch read at the top of the minute
(USDG-EUR: its mid; EURC-USDC: one over it). Windows: EURC-USDC 2026-10-20 00:00 → 10-29 05:30, USDG-EUR 10-27 00:00 → 10-29
05:30 (its tape starts 10-26 07:25); the first day of each only warms up the trailing medians and is reported apart.
usage: python3 -I okx_replay_prep.py OUT.json [repro]   (repro: the paper record's own window, to check the replay against it)
"""
import collections, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fpc as C  # noqa: E402
import hist as HI  # noqa: E402

M = C.M
WIN = {"EURC-USDC": (C.iso_ms("2026-10-20T00:00:00Z"), C.iso_ms("2026-10-29T05:30:00Z")),
       "USDG-EUR": (C.iso_ms("2026-10-27T00:00:00Z"), C.iso_ms("2026-10-29T05:30:00Z"))}
TICK = {"EURC-USDC": 1e-3, "USDG-EUR": 1e-4}


def main(out_path, mode="study"):
    if mode == "repro":                  # the paper record's own window: flat from its start, 2026-10-28 22:00
        for b in WIN:
            WIN[b] = (C.iso_ms("2026-10-28T22:00:00Z"), C.iso_ms("2026-10-29T05:30:00Z"))
    fx = C.load_fx()
    ser = {k: (list(v[0]), list(v[1])) for k, v in fx.items()}
    for l in C.lines("fx_1029"):
        k, m, v = l.split("\t")
        ser[k][0].append(int(m) * M); ser[k][1].append(float(v))
    touch = C.load_touch()["USDC-EUR"]
    for l in C.lines("touch_1029"):
        b, m, s, bid, ask, bs, az = l.split("\t")
        touch[int(m)] = (float(s), float(bid), float(ask), float(bs), float(az))
    prints = collections.defaultdict(list)
    for l in C.lines("okx_trades"):
        book, tid, ts, px, sz, side = l.split("\t")
        prints[book].append((int(ts), int(tid), float(px), float(sz), side))
    books = collections.defaultdict(list)
    for l in C.lines("okx_books"):
        book, ts, bid, ask, bs, az = l.split("\t")
        books[book].append({"at": int(ts), "bid": float(bid), "ask": float(ask)})
    out = {}
    for b, (t0, t1) in WIN.items():
        ps = sorted(prints[b])
        ms = list(range(t0, t1, M))
        n = len(ms)
        eur = [C.bar_at(t, *ser["EURUSD"]) for t in ms]
        gbp = [C.bar_at(t, *ser["GBPUSD"]) for t in ms]
        # par: the engine's x where it has one; in a closure the engine holds its last x itself
        par = [(1 / x if b == "USDG-EUR" else x) if x else None for x in eur]
        last = [None] * n
        j = 0
        mins = collections.defaultdict(list)
        for p in ps:
            if t0 <= p[0] < t1:
                mins[(p[0] - t0) // M].append(p)
        # the trailing median needs each earlier minute's last print against that minute's par; a closure minute has none
        held = None
        par_h = []
        for i in range(n):
            if par[i]:
                held = par[i]
            par_h.append(par[i] if par[i] else held)
        for i, pp in mins.items():
            last[i] = pp[-1][2]
        cands = {"par": [x for x in eur]}
        adj = HI.rolling_basis(n, last, par_h, HI.LS["24h"])
        for a in (0.5, 1.0):
            f = [(par_h[i] * (1 + a * adj[i])) if (par_h[i] and adj[i] is not None) else par_h[i] for i in range(n)]
            # back to the x okxFair turns into that fair; null where the engine's own x is null (it then holds its last)
            cands[f"par+b24h_{a}"] = [((1 / f[i]) if b == "USDG-EUR" else f[i]) if (eur[i] and f[i]) else None for i in range(n)]
        xv = []
        for i, t in enumerate(ms):
            r = touch.get(t // M)
            mid = (r[1] + r[2]) / 2 if r else None
            fv = None if (mid is None or not eur[i]) else (mid if b == "USDG-EUR" else 1 / mid)
            xv.append(((1 / fv) if b == "USDG-EUR" else fv) if fv else None)
        cands["coinbase_usdceur"] = xv
        out[b] = {"t0": t0, "minutes": ms, "gbpusd": gbp, "cands": cands, "tick": TICK[b],
                  "prints": [[p[0], round(p[2] / TICK[b]), p[3], p[4], p[1]] for p in ps if t0 <= p[0] < t1],
                  "touches": books[b]}
    json.dump(out, open(out_path, "w"))
    print({b: (len(v["minutes"]), len(v["prints"]), len(v["touches"])) for b, v in out.items()})


if __name__ == "__main__":
    main(*sys.argv[1:3])
