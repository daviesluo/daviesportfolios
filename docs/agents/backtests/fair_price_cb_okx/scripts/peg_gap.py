"""The peg gap by month: Revolut X UK's USD-book F3 (the engine's fairU) against the coin's dollar price on Coinbase (USDC 1;
USDT Coinbase USDT-USD's F3), in bps, at every hour from 2025-11-21 to 2026-10-29. History from hist.py's inputs (Revolut X
hourly closes, CJ5's Coinbase USDT-USD hourly closes to 2026-10-09); then production (PR5's stored closes, Coinbase USDT-USD
one-minute candles). A positive gap is a fair above the coin's Coinbase price.
usage: python3 -I peg_gap.py OUT.json
"""
import collections, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import hist as HI  # noqa: E402
import fpc as C  # noqa: E402

H = C.H


def main(out_path):
    rx = HI.revx_hours()
    cb = {c: v for c, v in HI.CI.load_usd().items() if c in ("USDC", "USDT")}
    prx = C.load_hours_revx()
    ut, uv = C.load_cb_usdt_1m()
    pcb = C.hourly_from_minutes(ut, uv)
    cut = C.iso_ms("2026-10-09T00:00:00Z")
    series = {"USDC_revx": [h for h in rx["USDC"] if h[0] < cut] + [h for h in prx["USDC"] if h[0] >= cut],
              "USDT_revx": [h for h in rx["USDT"] if h[0] < cut] + [h for h in prx["USDT"] if h[0] >= cut],
              "USDT_cb": [h for h in cb["USDT"] if h[0] < cut] + [h for h in pcb if h[0] >= cut],
              "USDC_bitstamp": [h for h in cb["USDC"] if h[0] < cut]}
    F = {k: C.F3(v) for k, v in series.items()}
    t0, t1 = C.iso_ms("2025-11-21T00:00:00Z"), C.iso_ms("2026-10-29T00:00:00Z")
    by = collections.defaultdict(lambda: collections.defaultdict(list))
    for t in range(t0, t1, H):
        mo = C.day_of(t)[:7] if t < C.iso_ms("2026-10-01T00:00:00Z") else C.day_of(t)[:8] + ("01-09" if C.day_of(t) < "2026-10-10" else "10-19" if C.day_of(t) < "2026-10-20" else "20-28")
        a, b, c = F["USDC_revx"](t), F["USDT_revx"](t), F["USDT_cb"](t)
        if a:
            by[mo]["USDC: Revolut X F3 vs 1"].append((a - 1) * 1e4)
        if b and c:
            by[mo]["USDT: Revolut X F3 vs Coinbase F3"].append((b / c - 1) * 1e4)
        if c:
            by[mo]["USDT: Coinbase F3 vs 1"].append((c - 1) * 1e4)
        d = F["USDC_bitstamp"](t)
        if d:
            by[mo]["USDC: Bitstamp F3 vs 1"].append((d - 1) * 1e4)
    res = {}
    for mo, d in sorted(by.items()):
        res[mo] = {k: round(sorted(v)[len(v) // 2], 2) for k, v in d.items()}
    json.dump(res, open(out_path, "w"), indent=1)
    for mo, d in res.items():
        print(mo, d)


if __name__ == "__main__":
    main(sys.argv[1])
