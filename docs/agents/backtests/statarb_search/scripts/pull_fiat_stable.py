"""S1: pull the tapes and minute bars of every stablecoin-against-currency book that might host PR5's mechanism.

Window: 2026-10-02 00:00 -> 2026-10-09 00:00 UTC (seven days, chosen before any of it was read).
Writes gzipped JSON under inputs/fiat_stable/ exactly as the sources served them (pages concatenated):
  * Revolut X public prints (UK USDC-GBP, USDT-GBP for calibration against PR5; EEA USDC-EUR), region on every print
  * Coinbase Exchange 1-minute candles (trade-built) for the fx_stablecoin books and USDT-USD
  * Bitstamp 1-minute OHLC for usdceur / usdteur
  * CoinJar's last 500 prints of USDCGBP / USDTGBP / USDCAUD / USDTAUD
  * Yahoo 1-minute FX (GBPUSD=X, EURUSD=X, AUDUSD=X, CAD=X, SGD=X), the interbank anchor
usage: python3 pull_fiat_stable.py   (from scripts/)
"""
import gzip, json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from netget import get_json

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(HERE, "inputs", "fiat_stable")
A = 1791504000 - 7 * 86400  # 2026-10-02T00:00Z
Z = 1791504000              # 2026-10-09T00:00Z
assert time.strftime("%Y-%m-%dT%H:%M", time.gmtime(A)) == "2026-10-02T00:00"
assert time.strftime("%Y-%m-%dT%H:%M", time.gmtime(Z)) == "2026-10-09T00:00"


def save(name, obj):
    os.makedirs(OUT, exist_ok=True)
    with gzip.open(os.path.join(OUT, name + ".json.gz"), "wt") as f:
        json.dump(obj, f, sort_keys=True)
    print("saved", name, flush=True)


def revx(sym):
    rows = []
    for d0 in range(A * 1000, Z * 1000, 86400000):
        cursor = ""
        while True:
            u = f"https://revx.revolut.com/api/1.0/public/trades/all?symbol={sym}&start_date={d0}&end_date={d0 + 86400000}&limit=100"
            if cursor:
                u += f"&cursor={cursor}"
            st, d = get_json(u)
            time.sleep(1.1)
            if st != 200 or not d:
                raise SystemExit(f"revx {sym} {st}")
            rows += d["data"]
            cursor = (d.get("metadata") or {}).get("next_cursor") or ""
            if not cursor:
                break
    uniq = {r["id"]: r for r in rows}
    save(f"revx_{sym.replace('/', '-')}", sorted(uniq.values(), key=lambda r: (r["timestamp"], r["id"])))


def coinbase(pid):
    rows = []
    for s in range(A, Z, 300 * 60):
        e = min(s + 300 * 60, Z)
        u = f"https://api.exchange.coinbase.com/products/{pid}/candles?granularity=60&start={time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(s))}&end={time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(e - 60))}"
        st, d = get_json(u)
        time.sleep(0.35)
        if st != 200:
            raise SystemExit(f"coinbase {pid} {st}")
        rows += d
    uniq = {r[0]: r for r in rows if A <= r[0] < Z}
    save(f"coinbase_{pid}", [uniq[k] for k in sorted(uniq)])


def bitstamp(p):
    rows = []
    for s in range(A, Z, 1000 * 60):
        st, d = get_json(f"https://www.bitstamp.net/api/v2/ohlc/{p}/?step=60&limit=1000&start={s}")
        time.sleep(0.5)
        if st != 200:
            raise SystemExit(f"bitstamp {p} {st}")
        rows += d["data"]["ohlc"]
    uniq = {int(r["timestamp"]): r for r in rows if A <= int(r["timestamp"]) < Z}
    save(f"bitstamp_{p}", [uniq[k] for k in sorted(uniq)])


def coinjar(p):
    st, d = get_json(f"https://data.exchange.coinjar.com/products/{p}/trades?limit=500")
    if st != 200:
        raise SystemExit(f"coinjar {p} {st}")
    save(f"coinjar_{p}", d)


def yahoo(sym):
    st, d = get_json(f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}?interval=1m&range=8d", ua="Mozilla/5.0")
    if st != 200:
        raise SystemExit(f"yahoo {sym} {st}")
    r = d["chart"]["result"][0]
    q = r["indicators"]["quote"][0]
    save(f"yahoo_{sym.replace('=', '')}", {"t": r["timestamp"], "close": q["close"], "meta_symbol": r["meta"]["symbol"]})


if __name__ == "__main__":
    for s in ("GBPUSD=X", "EURUSD=X", "AUDUSD=X", "CAD=X", "SGD=X"):
        yahoo(s)
    for p in ("USDCGBP", "USDTGBP", "USDCAUD", "USDTAUD"):
        coinjar(p)
    for p in ("usdceur", "usdteur"):
        bitstamp(p)
    for p in ("USDT-USD", "USDC-GBP", "USDT-GBP", "USDC-EUR", "USDT-EUR", "EURC-USDC", "TGBP-USDC", "USDC-AUD", "USDC-CAD", "USDC-SGD"):
        coinbase(p)
    for s in ("USDC-GBP", "USDT-GBP", "USDC-EUR", "USDT-EUR"):
        revx(s)
