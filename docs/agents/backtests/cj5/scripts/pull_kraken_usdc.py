"""Kraken's public USDC/USD trade tape, 2020-03-30 -> 2020-10-21: USDC's dollar value before Bitstamp's USDC/USD hourly
OHLC begins (2020-10-19 09:00 UTC). `/0/public/Trades?pair=USDCUSD&since=<ns>` pages 1,000 prints forward; one request
a second and a bit. Raw pages to RAW/usd/kraken_USDCUSD_2020.jsonl (resumable).
usage: python3 -I pull_kraken_usdc.py RAW_DIR
"""
import json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from netget import get

A, Z = 1585526400, 1603238400     # 2020-03-30T00:00Z, 2020-10-21T00:00Z
assert time.strftime("%Y-%m-%d", time.gmtime(A)) == "2020-03-30" and time.strftime("%Y-%m-%d", time.gmtime(Z)) == "2020-10-21"
fn = os.path.join(sys.argv[1], "usd", "kraken_USDCUSD_2020.jsonl")
since = A * 10**9
if os.path.exists(fn):
    for line in open(fn):
        since = int(json.loads(line)["last"])
out = open(fn, "a")
while True:
    st, body = get(f"https://api.kraken.com/0/public/Trades?pair=USDCUSD&since={since}&count=1000")
    time.sleep(1.2)
    if st != 200:
        raise SystemExit(f"HTTP {st}")
    d = json.loads(body)
    if d.get("error"):
        print("err", d["error"]); time.sleep(10); continue
    rows = d["result"].get("USDCUSD") or []
    last = int(d["result"]["last"])
    out.write(json.dumps({"since": since, "last": last, "rows": rows}) + "\n"); out.flush()
    if not rows or rows[-1][2] >= Z or last == since:
        break
    since = last
    print(time.strftime("%Y-%m-%d %H:%M", time.gmtime(rows[-1][2])), flush=True)
out.close()
