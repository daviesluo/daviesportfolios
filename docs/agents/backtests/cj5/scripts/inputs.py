"""CJ5's committed inputs (../inputs/), their loaders, and how they are built from the raw pulls.

Committed, derived from the raw pulls (each raw file's sha256 is in ../inputs/raw_manifest.json):
* cj_prints_<ID>.json.gz — every CoinJar print of the book before 2026-10-09 00:00 UTC, de-duplicated by `tid`, sorted by
  (time, tid), columnar: tid, time (µs), price (1e-8 pounds, as served; some auction prints sit between 0.0001 ticks), size (µ-units), value (pence), side (b / s / a).
* fx_gbpusd_1m.json.gz — interbank GBP/USD, one value a minute that quoted: EXN minute-close mids 2020-04-01 ->
  2026-09-30 (µ-units, exact: an Exness quote has 5 decimals), then Yahoo's 1-minute closes 2026-10-01 -> 10-09.
* usd_hourly.json.gz — the stablecoins' dollar value, hourly closes: USDC from Kraken's USDC/USD tape (the hour's last
  print, carried forward) until Bitstamp's USDC/USD OHLC begins (2020-10-19 09:00), then Bitstamp; USDT from Coinbase's
  USDT-USD candles (an hour with no candle has no row); Bitstamp's USDT/USD beside it, as a check only.
* config.json — the stop's costs: CoinJar's taker fee and half of each book's touch as the recorder measured it.
usage: python3 -I inputs.py build RAW_DIR
"""
import bisect, datetime, glob, gzip, hashlib, json, os, statistics as st, sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IN = os.path.join(HERE, "inputs")
PRODUCTS = ["USDCGBP", "USDTGBP"]
COIN = {"USDCGBP": "USDC", "USDTGBP": "USDT"}
TICK = 1e-4
M = 60000


def ms(s):
    return int(datetime.datetime.fromisoformat(s).replace(tzinfo=datetime.timezone.utc).timestamp() * 1000)


END_MS = ms("2026-10-09T00:00")
START_MS = {"USDCGBP": ms("2020-04-02T00:00"), "USDTGBP": ms("2021-08-27T00:00")}


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


# ------------------------------------------------------------------ loaders (what the simulation reads)
def load_prints_full(product):
    d = _gz_read(os.path.join(IN, f"cj_prints_{product}.json.gz"))
    tid, tus = _undelta(d["tid_d"]), _undelta(d["t_us_d"])
    side = {"b": "buy", "s": "sell", "a": "auction"}
    tk = [pu // 10000 if pu % 10000 == 0 else pu / 10000 for pu in d["price_e8"]]     # 0.0001 ticks; a print between ticks keeps its fraction
    return [(tid[i], tus[i], tk[i], d["size_u"][i] / 1e6, d["value_p"][i] / 100, side[d["side"][i]]) for i in range(len(tid))]


def load_prints(product):
    """[(ts_ms, ticks, qty, side)] as pr5_sim's books hold them."""
    return [(t_us // 1000, tk, q, s) for _, t_us, tk, q, _, s in load_prints_full(product)]


def load_fx():
    d = _gz_read(os.path.join(IN, "fx_gbpusd_1m.json.gz"))
    t = [m * M for m in _undelta(d["min_d"])]
    v = [x / 1e6 for x in _undelta(d["v_u_d"])]
    return t, v


def load_usd():
    d = _gz_read(os.path.join(IN, "usd_hourly.json.gz"))
    return {c: list(zip(_undelta(d[c]["h_d"]), [x / 1e6 for x in _undelta(d[c]["c_u_d"])])) for c in ("USDC", "USDT")} | \
           {"USDT_bitstamp": list(zip(_undelta(d["USDT_bitstamp"]["h_d"]), [x / 1e6 for x in _undelta(d["USDT_bitstamp"]["c_u_d"])]))}


def load_config():
    return json.load(open(os.path.join(IN, "config.json")))


# ------------------------------------------------------------------ build (from the raw pulls)
def sha(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


def build_prints(raw, man):
    for p in PRODUCTS:
        rows, pages, bad = {}, 0, 0
        for fn in sorted(glob.glob(os.path.join(raw, "coinjar", p, "pages*.jsonl"))):
            key = f"coinjar/{p}/{os.path.basename(fn)}"
            man[key] = {"sha256": sha(fn), "bytes": os.path.getsize(fn), "pages": 0}
            for line in open(fn):
                rec = json.loads(line)
                body = rec["body"].encode()
                if hashlib.sha256(body).hexdigest() != rec["sha256"]:
                    bad += 1
                pages += 1; man[key]["pages"] += 1
                for r in json.loads(body):
                    rows[r["tid"]] = r
        out = []
        for r in rows.values():
            t = datetime.datetime.strptime(r["timestamp"], "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=datetime.timezone.utc)
            t_us = int(t.timestamp()) * 10**6 + t.microsecond
            if t_us >= END_MS * 1000:
                continue
            pu = round(float(r["price"]) * 1e8)                 # 1e-8 pounds, as served: auction prints can sit between ticks
            assert abs(pu / 1e8 - float(r["price"])) < 1e-13, r
            su = round(float(r["size"]) * 1e6)
            assert abs(su / 1e6 - float(r["size"])) < 1e-9, r
            out.append((t_us, r["tid"], pu, su, round(float(r["value"]) * 100), r["taker_side"][0]))
        out.sort()
        man[f"coinjar/{p}"] = {"pages": pages, "pages_sha_mismatch": bad, "distinct_tids": len(rows), "prints_kept_before_cut": len(out)}
        _gz_write(os.path.join(IN, f"cj_prints_{p}.json.gz"), {
            "product": p, "source": f"https://data.exchange.coinjar.com/products/{p}/trades?after=<unix s>&limit=1000, keyless",
            "cut": "2026-10-09T00:00:00Z", "n": len(out), "tid_d": _delta([o[1] for o in out]), "t_us_d": _delta([o[0] for o in out]),
            "price_e8": [o[2] for o in out], "off_tick": sum(1 for o in out if o[2] % 10000), "size_u": [o[3] for o in out], "value_p": [o[4] for o in out], "side": "".join(o[5] for o in out)})
        print(p, len(out), "prints from", pages, "pages", flush=True)


def build_fx(raw, man):
    log = json.load(open(os.path.join(raw, "fx", "exness", "_log.json")))
    mins = {}
    for key in sorted(log):
        man[f"exness/Exness_GBPUSD_{key}.zip"] = log[key]
        for t, v in json.load(open(os.path.join(raw, "fx", "exness", f"GBPUSD_{key}.minutes.json"))):
            mins[t] = round(v * 1e6)
    cut = ms("2026-10-01T00:00")
    assert max(mins) < cut
    yh = {}
    for fn in sorted(glob.glob(os.path.join(raw, "fx", "yahoo", "GBPUSD_1m_*.json"))):
        man[f"yahoo/{os.path.basename(fn)}"] = {"sha256": sha(fn), "bytes": os.path.getsize(fn)}
        r = json.load(open(fn))["chart"]["result"][0]
        for ts, c in zip(r["timestamp"], r["indicators"]["quote"][0]["close"]):
            if c:
                yh[ts * 1000 // M * M] = c
    for t, c in yh.items():
        if cut <= t < END_MS:
            mins[t] = round(c * 1e6)
    ts = sorted(mins)
    _gz_write(os.path.join(IN, "fx_gbpusd_1m.json.gz"), {
        "source": "EXN (ticks.ex2archive.com monthly GBPUSD ticks, minute-close mid) 2020-04-01..2026-09-30; Yahoo GBPUSD=X 1m close 2026-10-01..10-08",
        "n": len(ts), "min_d": _delta([t // M for t in ts]), "v_u_d": _delta([mins[t] for t in ts])})
    print("fx minutes", len(ts), flush=True)
    return yh


def _hourly_from_kraken(raw):
    fn = os.path.join(raw, "usd", "kraken_USDCUSD_2020.jsonl")
    last = {}
    for line in open(fn):
        for r in json.loads(line)["rows"]:
            h = int(float(r[2])) // 3600 * 3600000
            last[h] = (float(r[2]), float(r[0])) if h not in last or float(r[2]) >= last[h][0] else last[h]
    return {h: v[1] for h, v in last.items()}, fn


def build_usd(raw, man):
    kr, kfn = _hourly_from_kraken(raw)
    man["usd/kraken_USDCUSD_2020.jsonl"] = {"sha256": sha(kfn), "bytes": os.path.getsize(kfn)}
    def bitstamp(pair):
        fn = os.path.join(raw, "usd", f"bitstamp_{pair}_3600.json.gz")
        man[f"usd/bitstamp_{pair}_3600.json.gz"] = {"sha256": sha(fn), "bytes": os.path.getsize(fn)}
        return {int(r["timestamp"]) * 1000: float(r["close"]) for pg in _gz_read(fn) for r in pg["body"]["data"]["ohlc"]}
    bc, bt = bitstamp("usdcusd"), bitstamp("usdtusd")
    fn = os.path.join(raw, "usd", "coinbase_USDT-USD_3600.json.gz")
    man["usd/coinbase_USDT-USD_3600.json.gz"] = {"sha256": sha(fn), "bytes": os.path.getsize(fn)}
    cb = {r[0] * 1000: float(r[4]) for pg in _gz_read(fn) for r in pg["body"]}
    b0 = min(bc)
    usdc = {}
    h, lastv = ms("2020-03-31T00:00"), None
    while h < b0:                       # Kraken: the hour's last print, carried forward through hours with none
        if h in kr:
            lastv = kr[h]
        if lastv is not None:
            usdc[h] = lastv
        h += 3600000
    for h, v in bc.items():
        if h < END_MS + 3600000:
            usdc[h] = v
    usdt = {h: v for h, v in cb.items() if h < END_MS + 3600000}
    def col(d):
        ks = sorted(d)
        return {"n": len(ks), "h_d": _delta(ks), "c_u_d": _delta([round(d[k] * 1e6) for k in ks])}
    _gz_write(os.path.join(IN, "usd_hourly.json.gz"), {
        "USDC": col(usdc) | {"source": f"Kraken USDC/USD hourly last print (carried forward) to {datetime.datetime.utcfromtimestamp(b0 / 1000).isoformat()}Z, then Bitstamp USDC/USD hourly close"},
        "USDT": col(usdt) | {"source": "Coinbase Exchange USDT-USD hourly close"},
        "USDT_bitstamp": col({h: v for h, v in bt.items() if h < END_MS + 3600000}) | {"source": "Bitstamp USDT/USD hourly close (check only)"}})
    print("usd hours", len(usdc), len(usdt), flush=True)


def half_spreads():
    """Half the median price gap between adjacent BUY and SELL prints within 60 s, as a fraction of price, per book."""
    out = {}
    for p in PRODUCTS:
        pr = load_prints(p)
        gaps = []
        for a, b in zip(pr, pr[1:]):
            if b[0] - a[0] <= 60000 and {a[3], b[3]} == {"buy", "sell"}:
                gaps.append(abs(a[1] - b[1]) / ((a[1] + b[1]) / 2))
        out[p] = {"pairs": len(gaps), "median_gap": round(st.median(gaps), 6), "half_spread": round(st.median(gaps) / 2, 6)}
    return out


def touch_half_spreads():
    """The stop crosses the book at a random time: half the touch CoinJar's book showed when the recorder was measured
    (backtests/cjrec/fixture_2026-10-09.json, read 18:31 UTC; reference §4 item 57). Adjacent BUY/SELL prints within 60 s
    sit 1-6 bps apart (`half_spreads`), far inside the 28-34 bps touch, so that measure would understate a stop's cost."""
    fx = json.load(open(os.path.normpath(os.path.join(HERE, "..", "cjrec", "fixture_2026-10-09.json"))))
    out = {}
    for p in PRODUCTS:
        b = fx["requests"][f"/products/{p}/book?level=2"]
        a, bb = float(b["asks"][0][0]), float(b["bids"][0][0])
        out[p] = {"best_ask": a, "best_bid": bb, "touch_bps": round((a - bb) / ((a + bb) / 2) * 1e4, 2),
                  "half_spread": round((a - bb) / ((a + bb) / 2) / 2, 6), "read_at": fx["read_at"]}
    return out


def build(raw):
    man = {}
    build_prints(raw, man)
    build_fx(raw, man)
    build_usd(raw, man)
    hs = half_spreads()
    touch = touch_half_spreads()
    json.dump({"taker_fee": 0.00001, "taker_fee_source": "coinjar.com/uk/fees (stablecoin<->fiat 0.001 % taker, 0.00 % maker), read 2026-10-09",
               "half_spread": {p: v["half_spread"] for p, v in touch.items()}, "half_spread_source": touch,
               "print_gap_measure_not_used": hs},
              open(os.path.join(IN, "config.json"), "w"), indent=1, sort_keys=True)
    fx = os.path.join(raw, "fx", "fxcm", "_log.json")
    if os.path.exists(fx):
        for e in json.load(open(fx)):
            man[f"fxcm/GBPUSD_{e['year']}_{e['week']:02d}.csv.gz"] = {k: e[k] for k in ("status", "bytes", "sha256")}
    fn = os.path.join(raw, "fx", "yahoo", "GBPUSD_1h_2y.json")
    man["yahoo/GBPUSD_1h_2y.json"] = {"sha256": sha(fn), "bytes": os.path.getsize(fn)}
    json.dump(man, open(os.path.join(IN, "raw_manifest.json"), "w"), indent=1, sort_keys=True)
    print(json.dumps(hs))


if __name__ == "__main__":
    if sys.argv[1] == "build":
        build(sys.argv[2])
