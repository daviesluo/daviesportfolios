"""Screen of Revolut X UK coin/USDC books against Binance's coin/USDC 1-minute closes, 2026-09-24 -> 10-01 (7 days).
A print's deviation is signed so POSITIVE means the taker paid worse than fair (a resting maker on that side would
have earned it). Fair = Binance close of the minute before the print (no look-ahead). Markout = Binance close 5 and
60 minutes after the print's minute, signed so POSITIVE is against the maker who filled it.
Ceiling = every non-dust print whose deviation exceeds k fills a $100-capped maker quote at fair +/- k."""
import json, gzip, bisect, statistics as st
BOOKS = ["SOL-USDC", "PEPE-USDC", "HBAR-USDC", "LINK-USDC"]
DUST = 1.0  # USD notional below which a print is the dust bot
for sym in BOOKS:
    pr = json.load(gzip.open(f"samples/usdc/prints_{sym}.json.gz", "rt"))["rows"]
    kl = json.load(gzip.open(f"samples/usdc/binance_{sym.replace('-','')}_1m.json.gz", "rt"))["rows"]
    close = {k[0]: k[1] for k in kl}
    out = []
    for p in pr:
        m = p["ts"] // 60000 * 60000
        f = close.get(m - 60000)
        if not f: continue
        notional = p["price"] * p["qty"]
        side = p["side"].upper()  # taker side
        dev = (p["price"] - f) / f * 1e4 * (1 if side == "BUY" else -1)
        f5, f60 = close.get(m + 5 * 60000), close.get(m + 60 * 60000)
        # maker sold to a taker BUY: maker is short; adverse if price rises
        mk5 = None if f5 is None else (f5 - f) / f * 1e4 * (1 if side == "BUY" else -1)
        mk60 = None if f60 is None else (f60 - f) / f * 1e4 * (1 if side == "BUY" else -1)
        out.append((notional, dev, mk5, mk60, side))
    real = [o for o in out if o[0] >= DUST]
    dust = [o for o in out if o[0] < DUST]
    vol = sum(o[0] for o in real)
    print(f"\n{sym}: prints {len(pr)}, matched {len(out)}, dust (<$1) {len(dust)}, non-dust {len(real)}, non-dust $ {vol:,.0f} in 7 d (${vol/7:,.0f}/day)")
    if not real: continue
    devs = sorted(o[1] for o in real)
    q = lambda a, x: a[min(len(a)-1, int(x*len(a)))]
    print(f"  deviation bps (taker worse than fair = +): p10 {q(devs,.1):.1f} p50 {q(devs,.5):.1f} p90 {q(devs,.9):.1f}; $-weighted mean {sum(o[0]*o[1] for o in real)/vol:.1f}")
    mk5 = [o[2] for o in real if o[2] is not None]; mk60 = [o[3] for o in real if o[3] is not None]
    print(f"  markout vs a maker (+ = against): 5 min mean {st.mean(mk5):.1f} median {st.median(mk5):.1f}; 60 min mean {st.mean(mk60):.1f} median {st.median(mk60):.1f}")
    for k in (10, 20, 30):
        fills = [o for o in real if o[1] > k]
        cap = [min(o[0], 100.0) for o in fills]
        edge = sum(c * k / 1e4 for c in cap)
        adv5 = sum(c * (o[2] or 0) / 1e4 for c, o in zip(cap, fills))
        print(f"  k={k:>2} bps: {len(fills):>4} prints through, ${sum(cap):>8,.0f} capped notional, ceiling edge ${edge:6.2f} in 7 d (${edge/7:.3f}/day); 5-min markout on those ${-adv5:+.2f}")
