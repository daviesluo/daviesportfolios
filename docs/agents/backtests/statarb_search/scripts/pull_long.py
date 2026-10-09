"""S1b: the 13 weeks before S1's window, for the books S1 ranks first (window 2026-07-06 00:00 -> 2026-10-02 00:00 UTC,
fixed after S1's week was read and before any of these 88 days were).
  * FXCM's public 1-minute archive (bid/ask), GBPUSD and EURUSD, ISO-ish weeks 26..40 of 2026 (PR5's anchor source)
  * Coinbase 1-minute candles: USDC-GBP, USDT-GBP, USDC-EUR, USDT-USD
  * Revolut X public prints: EEA USDC-EUR, UK USDC-GBP and USDT-GBP
Writes inputs/long/. usage: python3 pull_long.py
"""
import gzip, json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from netget import get, get_json
import pull_fiat_stable as P

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(HERE, "inputs", "long")
A = 1783296000   # 2026-07-06T00:00Z
Z = 1791504000 - 7 * 86400   # 2026-10-02T00:00Z
assert time.strftime("%Y-%m-%dT%H:%M", time.gmtime(A)) == "2026-07-06T00:00"


def main():
    os.makedirs(OUT, exist_ok=True)
    P.OUT, P.A, P.Z = OUT, A, Z
    for pair in ("GBPUSD", "EURUSD"):
        for w in range(26, 41):
            fn = os.path.join(OUT, f"fxcm_{pair}_2026_{w:02d}.csv.gz")
            if os.path.exists(fn):
                continue
            st, body = get(f"https://candledata.fxcorporate.com/m1/{pair}/2026/{w}.csv.gz")
            print(pair, w, st, len(body), flush=True)
            if st == 200 and len(body) > 1000:
                open(fn, "wb").write(body)
            time.sleep(0.5)
    for p in ("USDT-USD", "USDC-GBP", "USDT-GBP", "USDC-EUR"):
        if not os.path.exists(os.path.join(OUT, f"coinbase_{p}.json.gz")):
            P.coinbase(p)
    for s in ("USDC-EUR", "USDC-GBP", "USDT-GBP"):
        if not os.path.exists(os.path.join(OUT, f"revx_{s}.json.gz")):
            P.revx(s)


if __name__ == "__main__":
    main()
