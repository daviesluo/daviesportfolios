"""GROKPM zero-trades study (2026-10-20), step 4: base rates of price-to-outcome gaps on resolved markets.

Run from the repository root:
  python3 -I docs/agents/backtests/grokpm_zero/scripts/base_rates.py docs/agents/backtests/grokpm/data      (the cadence study's
      pull: closed 2026-08-15 to 10-15, 7 days of prices)
  python3 -I docs/agents/backtests/grokpm_zero/scripts/base_rates.py docs/agents/backtests/grokpm_zero/data (the week closed
      2026-10-13 to 10-20, 4 days of prices)

Reads only the committed public data (markets.json, prices.json.gz: each market's YES price every five minutes before its
close). Three readings per attention stratum (thin under $10k lifetime volume, low $10k-$50k, high $50k and over):

  1. HINDSIGHT GAPS. N hours before the close, the winning token's price w; the gap 1 - w is what a buyer of the winner
     would have made. Counted only where w is a price category B may buy (0.05 <= w < 0.90). This is an upper bound with
     perfect foresight: it says how much room there was, not that anyone could know which side wins.
  2. CALIBRATION. The YES price N hours before the close, in ten-point buckets, against how often YES won. A bucket whose
     realised frequency differs from its mean price by 8 points or more over 20 or more markets is a systematic mispricing
     a rule could aim at; anything else is noise at these sizes.
  3. A's LAG BAND. In the last 24 hours, whether the winner traded for 30 minutes or more at a gap of 8 to 20 points
     (0.80 <= w <= 0.92) and, separately, 5 to 20 points: the most category A could find if the outcome were confirmed at
     the start of that stretch. The data cannot say when an outcome became known.
Per-day counts scale the sample's share to the stratum's candidates over the window's days.
"""
import gzip, json, sys
from datetime import datetime

BARS = [0.05, 0.08, 0.10, 0.12]
HOURS = [1, 4, 24]


def ts(s):
    s = s.replace(" ", "T")
    if s.endswith("+00"):
        s += ":00"
    return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()


def at(series, t):
    """The last price at or before t, or None when the series starts after t or the last point is over 3 hours old."""
    last = None
    for x, p in series:
        if x > t:
            break
        last = (x, p)
    return None if last is None or t - last[0] > 3 * 3600 else last[1]


def main(path):
    meta = json.load(open(f"{path}/markets.json"))
    prices = json.load(gzip.open(f"{path}/prices.json.gz", "rt"))
    p = meta["meta"]
    lo, hi = (ts(x) for x in p["params"]["window"])
    days = (hi - lo) / 86400
    print(f"data {path}: pulled {p['pulled_at']}, window {p['params']['window'][0]} to {p['params']['window'][1]} ({days:.0f} days), "
          f"candidates thin {p['thin_candidates']} / low {p['low_candidates']} / high {p['high_candidates']}, {p['params']['lookback_days']} days of prices")
    for stratum in ["thin", "low", "high"]:
        ms = [m for m in meta["markets"] if m["stratum"] == stratum and len(prices.get(m["cond"], [])) >= 20]
        pop = p[f"{stratum}_candidates"]
        print(f"\n== {stratum}: {len(ms)} markets with prices (of {pop} candidates; {pop / days:.1f} closing a day)")
        for N in HOURS:
            ws = []
            for m in ms:
                s = sorted(prices[m["cond"]])
                yes = at(s, ts(m["closed"]) - N * 3600)
                if yes is None:
                    continue
                ws.append(yes if m["y"] == 1 else 1 - yes)
            if not ws:
                continue
            row = []
            for b in BARS:
                k = sum(1 for w in ws if 0.05 <= w < 0.90 and 1 - w >= b)
                row.append(f">= {round(b * 100):>2} pts {100 * k / len(ws):5.1f} % ({k / len(ws) * pop / days:5.1f}/day)")
            print(f"  hindsight, {N:>2} h before close ({len(ws)} priced): " + "  ".join(row))
        for N in [24, 4]:
            buckets = {}
            for m in ms:
                yes = at(sorted(prices[m["cond"]]), ts(m["closed"]) - N * 3600)
                if yes is None:
                    continue
                b = min(9, int(yes * 10))
                buckets.setdefault(b, []).append((yes, m["y"]))
            cells = []
            for b in sorted(buckets):
                xs = buckets[b]
                mp, fy = sum(x for x, _ in xs) / len(xs), sum(y for _, y in xs) / len(xs)
                flag = " *" if len(xs) >= 20 and abs(fy - mp) >= 0.08 else ""
                cells.append(f"{b * 10:>2}-{b * 10 + 10}: n {len(xs):>3} price {mp:.2f} won {fy:.2f}{flag}")
            print(f"  calibration {N:>2} h before close: " + " | ".join(cells))
        for band_lo, band_hi, label in [(0.80, 0.92, "8 to 20"), (0.80, 0.95, "5 to 20")]:
            hit = 0
            for m in ms:
                s = sorted(prices[m["cond"]])
                t1 = ts(m["closed"])
                run, best, prev = 0.0, 0.0, None
                for x, yes in s:
                    if x < t1 - 86400:
                        continue
                    w = yes if m["y"] == 1 else 1 - yes
                    if band_lo <= w <= band_hi:
                        run += (x - prev) if prev is not None and run > 0 else 1
                    else:
                        run = 0.0
                    best = max(best, run)
                    prev = x
                if best >= 1800:
                    hit += 1
            print(f"  A's lag band, winner at a gap of {label} points for 30 min or more in the last 24 h: {hit} of {len(ms)} ({100 * hit / len(ms):.1f} %, {hit / len(ms) * pop / days:.1f}/day)")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "docs/agents/backtests/grokpm/data")
