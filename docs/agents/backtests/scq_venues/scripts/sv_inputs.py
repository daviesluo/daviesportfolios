"""The venue screen's committed inputs (../inputs/), their builder from the raw pulls, and their loaders.

Committed, derived from the raw pulls (each raw page's or file's sha256 is in ../inputs/raw_pages/ or raw_manifest.json):
* bars_<venue>_<book>.json.gz — minute bars (bars.py) from 2024-10-01 to 2026-10-09 00:00 UTC, columnar: minute (delta),
  last price (1e-8 of the quote currency, delta), the four side extremes as offsets from the last price (null where that
  side did not print), the last print's aggressor (b / s / u = unknown, candles) and the quote volume (1e-2 units).
  The last print's time inside its minute and the minute's print count are not kept: the simulator reads prints only
  at minute boundaries (bars.py), so a bar's prints sit at its minute's first ms; the book's print total is kept. Coinbase, OKX and Kraken bars come from every print; Bitstamp's from 1-minute
  candles (candle-grade, pull_bitstamp.py).
* fx_eurusd_1m.json.gz — interbank EUR/USD, one value a minute that quoted: EXN minute-close mids 2024-09-01 -> 2026-09-30,
  then Yahoo's EURUSD=X 1-minute closes 2026-10-01 -> 10-09 (as CJ5's GBP/USD). GBP/USD is CJ5's committed series.
* usd_hourly_extra.json.gz — USDG's and USDe's dollar value (Kraken USDG/USD and USDE/USD: the hour's last print) and
  RLUSD's (Bitstamp RLUSD/USD hourly close). USDC's and USDT's are CJ5's committed series.
* touch.json — each book's touch, read 2026-10-09 (read_touch.py); config.json — the books, fees and their sources.
usage: python3 -I sv_inputs.py build RAW_DIR
"""
import datetime, glob, gzip, hashlib, json, os, sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IN = os.path.join(HERE, "inputs")
CJ5 = os.path.normpath(os.path.join(HERE, "..", "cj5", "scripts"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, CJ5)
import bars as BR  # noqa: E402
import inputs as CI  # noqa: E402,F401  (CJ5's loaders: GBP/USD and the USDC/USDT hourly series)
M = 60000

BOOKS = {   # key: (venue, raw name, quote ccy, coin, tick)
    "coinbase:USDC-GBP": ("coinbase", "USDC-GBP", "GBP", "USDC", 1e-4),
    "coinbase:USDT-GBP": ("coinbase", "USDT-GBP", "GBP", "USDT", 1e-4),
    "coinbase:USDC-EUR": ("coinbase", "USDC-EUR", "EUR", "USDC", 1e-4),
    "coinbase:USDT-EUR": ("coinbase", "USDT-EUR", "EUR", "USDT", 1e-5),
    "okx:USDC-EUR": ("okx", "USDC-EUR", "EUR", "USDC", 1e-5),
    "okx:USDT-EUR": ("okx", "USDT-EUR", "EUR", "USDT", 1e-4),
    "okx:USDG-EUR": ("okx", "USDG-EUR", "EUR", "USDG", 1e-4),
    "kraken:USDEEUR": ("kraken", "USDEEUR", "EUR", "USDE", 1e-4),
    "kraken:USDGUSD": ("kraken", "USDGUSD", "USD", "USDG", 1e-4),
    "bitstamp:usdceur": ("bitstamp", "usdceur", "EUR", "USDC", 1e-5),
    "bitstamp:usdteur": ("bitstamp", "usdteur", "EUR", "USDT", 1e-5),
    "bitstamp:rlusdeur": ("bitstamp", "rlusdeur", "EUR", "RLUSD", 1e-5),
}


def _gz_write(path, obj):
    with gzip.GzipFile(path, "wb", mtime=0) as f:
        f.write(json.dumps(obj, sort_keys=True, separators=(",", ":")).encode())


def _gz_read(path):
    with gzip.open(path, "rt") as f:
        return json.load(f)


def _delta(a):
    return [a[0]] + [a[i] - a[i - 1] for i in range(1, len(a))] if a else []


def _undelta(d):
    out, s = [], 0
    for x in d:
        s += x; out.append(s)
    return out


def fname(key):
    return os.path.join(IN, "bars_" + key.replace(":", "_") + ".json.gz")


# ------------------------------------------------------------------ loaders
def load_bars(key):
    d = _gz_read(fname(key))
    mins, lp = _undelta(d["m_d"]), _undelta(d["lp_d"])
    side = {"b": "buy", "s": "sell", "u": "unknown"}
    out = {}
    for i, m in enumerate(mins):
        ex = [None if d[c][i] is None else lp[i] + d[c][i] for c in ("smin", "smax", "bmin", "bmax")]
        out[m] = ex + [m * M, lp[i], side[d["sd"][i]], -1, d["v"][i] / 1e2, 0]
    return out, d


def load_eurusd():
    d = _gz_read(os.path.join(IN, "fx_eurusd_1m.json.gz"))
    return [m * M for m in _undelta(d["min_d"])], [x / 1e6 for x in _undelta(d["v_u_d"])]


def load_usd_extra():
    d = _gz_read(os.path.join(IN, "usd_hourly_extra.json.gz"))
    return {c: list(zip(_undelta(v["h_d"]), [x / 1e6 for x in _undelta(v["c_u_d"])])) for c, v in d.items()}


def load_config():
    return json.load(open(os.path.join(IN, "config.json")))


# ------------------------------------------------------------------ build
def sha(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


def raw_bars(raw, venue, name):
    if venue == "coinbase":
        merged = {}
        for fn in sorted(glob.glob(os.path.join(raw, "coinbase", f"{name}_*.bars.json"))):
            for k, b in json.load(open(fn))["bars"].items():
                merged[k] = BR.merge(merged[k], b) if k in merged else b
        return merged
    return json.load(open(os.path.join(raw, venue, f"{name}.bars.json")))["bars"]


def build_bars(raw, key):
    venue, name, q, coin, tick = BOOKS[key]
    bars = raw_bars(raw, venue, name)
    ks = sorted(int(k) for k in bars)
    rows = [bars[str(k)] for k in ks]
    lp = [b[5] for b in rows]
    obj = {"book": key, "tick": tick, "quote": q, "coin": coin, "minutes": len(ks), "prints": sum(b[9] for b in rows),
           "m_d": _delta(ks), "lp_d": _delta(lp),
           "smin": [None if b[0] is None else b[0] - b[5] for b in rows], "smax": [None if b[1] is None else b[1] - b[5] for b in rows],
           "bmin": [None if b[2] is None else b[2] - b[5] for b in rows], "bmax": [None if b[3] is None else b[3] - b[5] for b in rows],
           "sd": "".join({"buy": "b", "sell": "s"}.get(b[6], "u") for b in rows),
           "v": [round(b[8] * 1e2) for b in rows]}
    _gz_write(fname(key), obj)
    print(key, len(ks), "minutes", obj["prints"], "prints", os.path.getsize(fname(key)), "bytes", flush=True)


def build_fx(raw, man):
    d = os.path.join(raw, "fx_eur")
    log = json.load(open(os.path.join(d, "_log.json")))
    mins = {}
    for key in sorted(log):
        man[f"exness/Exness_EURUSD_{key}.zip"] = log[key]
        for t, v in json.load(open(os.path.join(d, f"EURUSD_{key}.minutes.json"))):
            mins[t] = round(v * 1e6)
    cut, end = CI.ms("2026-10-01T00:00"), CI.ms("2026-10-09T00:00")
    for fn in sorted(glob.glob(os.path.join(d, "EURUSD_1m_*.json"))):
        man[f"yahoo/{os.path.basename(fn)}"] = {"sha256": sha(fn), "bytes": os.path.getsize(fn)}
        r = json.load(open(fn))["chart"]["result"][0]
        for ts, c in zip(r["timestamp"], r["indicators"]["quote"][0]["close"]):
            t = ts * 1000 // M * M
            if c and cut <= t < end:
                mins[t] = round(c * 1e6)
    ts = sorted(mins)
    _gz_write(os.path.join(IN, "fx_eurusd_1m.json.gz"), {
        "source": "EXN (ticks.ex2archive.com monthly EURUSD ticks, minute-close mid) 2024-09-01..2026-09-30; Yahoo EURUSD=X 1m close 2026-10-01..10-08",
        "n": len(ts), "min_d": _delta([t // M for t in ts]), "v_u_d": _delta([mins[t] for t in ts])})
    print("eurusd minutes", len(ts))


def build_usd(raw, man):
    out = {}
    for coin, name in (("USDG", "USDGUSD"), ("USDE", "USDEUSD")):
        bars = json.load(open(os.path.join(raw, "kraken", f"{name}.bars.json")))["bars"]
        last = {}
        for k in sorted(bars, key=int):
            b = bars[k]
            last[int(k) * M // 3600000 * 3600000] = b[5] / 1e8
        ks = sorted(last)
        out[coin] = {"source": f"Kraken {name[:4]}/USD, the hour's last print (no row for an hour with none)", "n": len(ks),
                     "h_d": _delta(ks), "c_u_d": _delta([round(last[k] * 1e6) for k in ks])}
    fn = os.path.join(raw, "usd", "bitstamp_rlusdusd_3600.json")
    man["usd/bitstamp_rlusdusd_3600.json"] = {"sha256": sha(fn), "bytes": os.path.getsize(fn)}
    h = {}
    for pg in json.load(open(fn)):
        for r in pg["body"]["data"]["ohlc"]:
            if float(r["volume"]) > 0:
                h[int(r["timestamp"]) * 1000] = float(r["close"])
    ks = sorted(h)
    out["RLUSD"] = {"source": "Bitstamp RLUSD/USD hourly close (hours with volume)", "n": len(ks), "h_d": _delta(ks), "c_u_d": _delta([round(h[k] * 1e6) for k in ks])}
    _gz_write(os.path.join(IN, "usd_hourly_extra.json.gz"), out)
    print("usd extra", {c: v["n"] for c, v in out.items()})


def build_page_logs(raw, man):
    """Every raw page's / file's sha256, gzipped, per venue (the raw bodies are not committed)."""
    d = os.path.join(IN, "raw_pages"); os.makedirs(d, exist_ok=True)
    for venue in ("coinbase", "kraken", "bitstamp"):
        lines = []
        for fn in sorted(glob.glob(os.path.join(raw, venue, "*.pages.jsonl"))):
            for l in open(fn):
                lines.append(os.path.basename(fn)[:-len(".pages.jsonl")] + " " + l.strip())
        with gzip.GzipFile(os.path.join(d, f"{venue}_pages.txt.gz"), "wb", mtime=0) as f:
            f.write(("\n".join(lines) + "\n").encode())
        man[f"{venue}_pages"] = len(lines)
    log = json.load(open(os.path.join(raw, "okx", "_log.json")))
    with gzip.GzipFile(os.path.join(d, "okx_files.json.gz"), "wb", mtime=0) as f:
        f.write(json.dumps(log, sort_keys=True).encode())
    man["okx_files_200"] = sum(1 for v in log.values() if v["status"] == 200)


def build(raw):
    man = {}
    for key in BOOKS:
        build_bars(raw, key)
    build_fx(raw, man)
    build_usd(raw, man)
    build_page_logs(raw, man)
    json.dump(man, open(os.path.join(IN, "raw_manifest.json"), "w"), indent=1, sort_keys=True)


if __name__ == "__main__":
    if sys.argv[1] == "build":
        build(sys.argv[2])
