"""Revolut X's UK USD-book hourly candles (PR5's fair proxy F3) for 2026-09-16 -> 2026-10-09, keyless, so PR5 can be
run beside CJ5 to 2026-10-09: PR5's committed candles end with its study (2026-09-23). Revolut X's prints after
2026-09-23 are read from the stat-arb search's committed tapes (statarb_search/inputs/long and fiat_stable).
Public endpoint, one request a book, a second apart.
usage: python3 -I pull_revx.py   -> ../inputs/revx_usd_hours_2026-09-16_10-09.json.gz
"""
import gzip, json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from netget import get

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
A, Z = 1789516800000, 1791504000000      # 2026-09-16T00:00Z, 2026-10-09T00:00Z
assert time.strftime("%Y-%m-%d", time.gmtime(A / 1000)) == "2026-09-16"
out = {}
for b in ("USDC-USD", "USDT-USD"):
    url = f"https://revx.revolut.com/api/1.0/public/candles/{b}?interval=60&since={A}&until={Z}&region=UK"
    st, body = get(url)
    if st != 200:
        raise SystemExit(f"{b}: HTTP {st}")
    out[b] = {"url": url, "body": json.loads(body)}
    print(b, len(out[b]["body"]["data"]))
    time.sleep(1.2)
with gzip.GzipFile(os.path.join(HERE, "inputs", "revx_usd_hours_2026-09-16_10-09.json.gz"), "wb", mtime=0) as f:
    f.write(json.dumps(out, sort_keys=True).encode())
