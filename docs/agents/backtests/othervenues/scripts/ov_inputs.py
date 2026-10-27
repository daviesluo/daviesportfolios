"""OTHERVENUES' committed inputs (../inputs/), their builder from the raw pulls, and their loaders.

Committed, derived from the raw pulls (each raw page's sha256 is in ../inputs/raw_pages.json.gz):
* bars_<venue>_<book>.json.gz — minute bars in SCQ-VENUES' committed encoding (scq_venues/scripts/sv_inputs.py, whose
  builder and loader are used here with this folder as the target): Coinbase EURC-USDC 2025-10-27 -> 2026-10-27,
  TGBP-USDC from its listing (2026-04-22), USDC-GBP and USDT-GBP 2026-09-29 -> 10-27; OKX EURC-USDC from its listing
  (2026-09-21) and USDG-EUR (SCQ-VENUES' second venue, re-read to 10-27); Bitstamp EURCV/USDC (candle-grade) 2025-10-27 -> 2026-10-27. Every window ends 2026-10-27 00:00 UTC.
* fx_db.json.gz — GBP/USD (PR5's stored minutes, `agent_quote_inputs` kind 'fx', 2026-10-01 -> 10-27) and EUR/USD (the
  Coinbase test's, `cb_quote_inputs` kind 'fx:EURUSD', 2026-10-08 23:00 -> 10-27), read SELECT-only through the connector
  (sql/fx.sql), each payload checked against the database's md5 by grab_text.py. Before 2026-10-09 00:00 the series are
  CJ5's committed GBP/USD and SCQ-VENUES' committed EUR/USD; from it, these.
* usd_hourly.json.gz — USDC: Bitstamp USDC/USD hourly close (hours with volume); USDT: Coinbase USDT-USD hourly close;
  EURC/EUR: Kraken's hour's last print (a check on EURC's peg only); 2025-09-01 -> 2026-10-27.
usage: python3 -I ov_inputs.py build RAW_DIR
"""
import glob, gzip, hashlib, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
IN = os.path.join(ROOT, "inputs")
SCQ = os.path.normpath(os.path.join(ROOT, "..", "scq_venues", "scripts"))
CJ5 = os.path.normpath(os.path.join(ROOT, "..", "cj5", "scripts"))
sys.path.insert(0, SCQ)
sys.path.insert(0, CJ5)
import sv_inputs as SI  # noqa: E402  (SCQ-VENUES' encoder and loaders, pointed at this folder below)
SCQ_IN = SI.IN
import inputs as CI  # noqa: E402  (CJ5's GBP/USD)

M, HOUR = 60000, 3600000
CUT = CI.ms("2026-10-09T00:00")
END = CI.ms("2026-10-27T00:00")
BOOKS = {   # key: (venue, raw name, quote ccy, coin, tick)
    "coinbase:EURC-USDC": ("coinbase", "EURC-USDC", "USDC", "EURC", 1e-4),
    "coinbase:TGBP-USDC": ("coinbase", "TGBP-USDC", "USDC", "TGBP", 1e-4),
    "coinbase:USDC-GBP": ("coinbase", "USDC-GBP", "GBP", "USDC", 1e-4),
    "coinbase:USDT-GBP": ("coinbase", "USDT-GBP", "GBP", "USDT", 1e-4),
    "okx:EURC-USDC": ("okx", "EURC-USDC", "USDC", "EURC", 1e-3),
    "okx:USDG-EUR": ("okx", "USDG-EUR", "EUR", "USDG", 1e-4),
    "bitstamp:eurcvusdc": ("bitstamp", "eurcvusdc", "USDC", "EURCV", 1e-4),
}


def _point():
    SI.IN, SI.BOOKS = IN, BOOKS


def load_bars(key):
    _point()
    return SI.load_bars(key)


def load_gbpusd():
    t, v = CI.load_fx()
    d = SI._gz_read(os.path.join(IN, "fx_db.json.gz"))["gbpusd"]
    keep = [(a, b) for a, b in zip(t, v) if a < CUT]
    keep += [(a, b) for a, b in d if a >= CUT]
    return [a for a, _ in keep], [b for _, b in keep]


def load_eurusd():
    SI.IN = SCQ_IN                       # SCQ-VENUES' committed EUR/USD, to 2026-10-09
    t, v = SI.load_eurusd()
    _point()
    d = SI._gz_read(os.path.join(IN, "fx_db.json.gz"))["eurusd"]
    keep = [(a, b) for a, b in zip(t, v) if a < CUT]
    keep += [(a, b) for a, b in d if a >= CUT]
    return [a for a, _ in keep], [b for _, b in keep]


def load_usd_hourly():
    d = SI._gz_read(os.path.join(IN, "usd_hourly.json.gz"))
    return {k: [(int(a), b) for a, b in v] for k, v in d.items() if isinstance(v, list)}


# ------------------------------------------------------------------ build
def _db(raw, name):
    out = []
    for line in open(os.path.join(raw, "db", f"{name}.txt")):
        if line.strip():
            a, b = line.strip().split("|")
            out.append((int(a), round(float(b), 7)))
    return out


def build(raw):
    _point()
    os.makedirs(IN, exist_ok=True)
    for key in BOOKS:
        venue, name = BOOKS[key][:2]
        if venue != "coinbase" and not os.path.exists(os.path.join(raw, venue, f"{name}.bars.json")):
            print("no raw bars yet:", key)
            continue
        SI.build_bars(raw, key)
    SI._gz_write(os.path.join(IN, "fx_db.json.gz"), {"gbpusd": _db(raw, "gbpusd"), "eurusd": _db(raw, "eurusd"),
                                                    "source": "agent_quote_inputs 'fx' (GBP/USD) and cb_quote_inputs 'fx:EURUSD', minute starts in ms"})
    u = os.path.join(raw, "usd")
    usdc = {}
    for pg in json.load(open(os.path.join(u, "bitstamp_usdcusd_3600.json"))):
        for r in pg["body"]["data"]["ohlc"]:
            if float(r["volume"]) > 0:
                usdc[int(r["timestamp"]) * 1000] = float(r["close"])
    usdt = {}
    for pg in json.load(open(os.path.join(u, "coinbase_usdtusd_3600.json"))):
        for r in pg["body"]:
            usdt[int(r[0]) * 1000] = float(r[4])
    eurc = {int(k) * 1000: v for k, v in json.load(open(os.path.join(u, "kraken_eurceur_hours.json")))["hours"].items()}
    lim = lambda d: sorted((k, v) for k, v in d.items() if k < END)
    SI._gz_write(os.path.join(IN, "usd_hourly.json.gz"), {"USDC": lim(usdc), "USDT": lim(usdt), "EURC_EUR": lim(eurc),
                                                         "source": "USDC Bitstamp USDC/USD hourly close (volume > 0); USDT Coinbase USDT-USD hourly close; EURC_EUR Kraken EURC/EUR hour's last print"})
    pages = {}
    for venue in ("coinbase", "bitstamp"):
        for fn in sorted(glob.glob(os.path.join(raw, venue, "*.pages.jsonl"))):
            pages[f"{venue}/{os.path.basename(fn)}"] = [json.loads(l) for l in open(fn)]
    pages["okx/_log.json"] = json.load(open(os.path.join(raw, "okx", "_log.json")))
    for fn in ("bitstamp_usdcusd_3600.json", "coinbase_usdtusd_3600.json"):
        pages[f"usd/{fn}"] = [{"url": p["url"], "sha256": p["sha256"]} for p in json.load(open(os.path.join(u, fn)))]
    for fn in ("gbpusd.txt", "eurusd.txt"):
        b = open(os.path.join(raw, "db", fn), "rb").read()
        pages[f"db/{fn}"] = {"sha256": hashlib.sha256(b).hexdigest(), "lines": b.count(b"\n")}
    SI._gz_write(os.path.join(IN, "raw_pages.json.gz"), pages)
    print("usd hours", len(usdc), len(usdt), len(eurc))


if __name__ == "__main__":
    if sys.argv[1] == "build":
        build(sys.argv[2])
