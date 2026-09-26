"""fp6: pull every input the fp6 pre-registrations name, keylessly, check it, and store it gzipped.

    python3 docs/agents/backtests/fp6/fetch.py <stage> [<stage> ...]

Stages (each writes inputs/<name>.json.gz and its rows in manifest.json):

  perps       daily klines of every USDⓈ-M perpetual quoted in USDT or USDC that the archive holds
              (delisted ones included), 2022-06 -> 2026-08 from data.binance.vision's monthly zips,
              each checked against its published sha256; 2026-09 from www.binance.com/fapi/v1/klines
              for the contracts still listed, and the archive's daily zips for the rest
  spot        daily klines of the Binance spot USDT pairs that match a perpetual (same base, or the
              base with a 1000/1000000/1M multiplier stripped), same months and sources
              (data-api.binance.vision for 2026-09)
  funding     every funding settlement of the perpetuals in `perps`, 2022-06-01 -> 2026-09-26, from
              the archive's monthly zips (calc_time, funding_interval_hours, last_funding_rate), and
              www.binance.com/fapi/v1/fundingRate for 2026-09; COIN-M BTCUSD_PERP and ETHUSD_PERP from
              the COIN-M archive and www.binance.com/dapi/v1/fundingRate
  quarterly   daily klines of every USDⓈ-M BTC and ETH quarterly delivered or listed 2022-09 -> 2026-12
              from the archive (monthly zips of each contract)
  announce    the titles, codes and release times of Binance's "Delisting" (161) and "New
              Cryptocurrency Listing" (48) announcement catalogues, and the body text of every
              "Binance Futures Will Delist" and "Binance Futures Will Launch" announcement
  books       twenty bookTicker samples, sixty seconds apart, of every USDT perpetual and spot pair
              (their half-spreads), from www.binance.com and data-api.binance.vision
  qbooks      the same for the listed BTC and ETH quarterlies
  exchangeinfo  the USDⓈ-M and COIN-M contract lists and filters, 2026-09-26
  freeze      writes inputs/symbols_frozen.json: the perpetuals, spot pairs and quarterlies this
              pull used. With it present, `perps`, `spot` and `quarterly` ask for exactly those
              (the archive's listing grows as Binance lists contracts), so a re-pull of the
              deterministic stages rebuilds the same files byte for byte
  merge       joins the per-stage fragments in manifest.d/ into manifest.json and checks every
              stored input against its recorded sha256

Public reads only: no key is read, nothing is signed, no order exists anywhere in this file.
It computes no return of any rule. Each stage writes manifest.d/<stage>.json: every source URL
with the sha256 of what came back (archive zips are also checked against the sha256 the archive
publishes), and each stored input with its sha256. The snapshots (books, qbooks, exchangeinfo,
announce) cannot be re-pulled identically and are kept as committed; perps, spot, funding and
quarterly can, from the frozen lists.
"""

from __future__ import annotations

import concurrent.futures as cf
import hashlib
import json
import sys
import time
from datetime import date, datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import vision as V  # noqa: E402

HERE = Path(__file__).resolve().parent
INPUTS = HERE / "inputs"
MANIFEST = HERE / "manifest.json"

FIRST_MONTH = (2022, 6)
LAST_ARCHIVE_MONTH = (2026, 8)
REST_FROM_MS = int(datetime(2026, 9, 1, tzinfo=timezone.utc).timestamp() * 1000)
REST_TO_MS = int(datetime(2026, 9, 26, tzinfo=timezone.utc).timestamp() * 1000)  # exclusive: last full day 09-25
DAY = 86_400_000
MULTIPLIERS = ("1000000", "10000", "1000", "100", "1M")
STABLE_BASES = {"USDC", "BUSD", "TUSD", "FDUSD", "USDP", "DAI", "USDE", "EURI", "EUR", "XUSD", "BFUSD", "RLUSD", "U",
                "USD1", "PYUSD", "USDS", "AEUR", "UST", "USTC", "SUSD", "GUSD", "PAX", "USDB", "USDD"}


def months() -> list[str]:
    y, m = FIRST_MONTH
    out = []
    while (y, m) <= LAST_ARCHIVE_MONTH:
        out.append(f"{y:04d}-{m:02d}")
        m += 1
        if m == 13:
            y, m = y + 1, 1
    return out


FRAGMENTS = HERE / "manifest.d"


def load_manifest() -> dict:
    return {"inputs": {}, "sources": {}}


def save_manifest(man: dict, stage: str) -> None:
    """Each stage writes its own fragment (stages may run at the same time); `merge` joins them."""
    frag = {"inputs": dict(sorted(man["inputs"].items())),
            "sources": {k: dict(sorted(v.items())) for k, v in sorted(man["sources"].items())}}
    FRAGMENTS.mkdir(exist_ok=True)
    (FRAGMENTS / f"{stage}.json").write_text(json.dumps(frag, indent=1, sort_keys=True) + "\n")


def merge_manifest() -> None:
    """manifest.json = every fragment, plus the sha256 of every stored input as it is on disk now."""
    out = {"inputs": {}, "sources": {}}
    for f in sorted(FRAGMENTS.glob("*.json")):
        frag = json.loads(f.read_text())
        out["inputs"].update(frag["inputs"])
        out["sources"].update(frag["sources"])
    for name, row in out["inputs"].items():
        on_disk = V.sha256_file(INPUTS / name)
        if on_disk != row["sha256"]:
            raise SystemExit(f"{name} on disk is {on_disk}, its fragment says {row['sha256']}")
    out["inputs"] = dict(sorted(out["inputs"].items()))
    out["sources"] = {k: dict(sorted(v.items())) for k, v in sorted(out["sources"].items())}
    MANIFEST.write_text(json.dumps(out, indent=1, sort_keys=True) + "\n")


# ─────────────────────────────────────────────────────────── archive klines


def kline_zip_paths(market: str, symbol: str, interval: str) -> list[str]:
    """The monthly kline zips the archive holds for a symbol, in FIRST_MONTH..LAST_ARCHIVE_MONTH."""
    prefix = f"data/{market}/monthly/klines/{symbol}/{interval}/"
    keys = [k for k, _ in V.s3_keys(prefix) if k.endswith(".zip")]
    wanted = set(months())
    return sorted(k for k in keys if k[-11:-4] in wanted)


def parse_klines(rows: list[list[str]]) -> list[list]:
    out = []
    for r in rows:
        if not r or not r[0].strip().lstrip("-").isdigit():
            continue  # a header row (the futures archive added one in 2022)
        t = V.ms_stamp(r[0])
        out.append([t, float(r[1]), float(r[2]), float(r[3]), float(r[4]), float(r[5]), float(r[7])])
    return out


def pull_archive_klines(market: str, symbols: list[str], interval: str, threads: int = 24):
    """{symbol: rows} from the monthly archive, plus {zip path: sha256}."""
    paths: dict[str, list[str]] = {}
    with cf.ThreadPoolExecutor(threads) as ex:
        for sym, ps in zip(symbols, ex.map(lambda s: kline_zip_paths(market, s, interval), symbols)):
            paths[sym] = ps
    jobs = [(sym, p) for sym, ps in paths.items() for p in ps]
    rows: dict[str, list] = {s: [] for s in symbols}
    shas: dict[str, str] = {}

    def one(job):
        sym, p = job
        r, digest = V.vision_zip(p)
        return sym, p, parse_klines(r), digest

    done = 0
    with cf.ThreadPoolExecutor(threads) as ex:
        for sym, p, parsed, digest in ex.map(one, jobs):
            rows[sym] += parsed
            shas[f"{V.VISION}/{p}"] = digest
            done += 1
            if done % 2000 == 0:
                print(f"  {market} {interval}: {done}/{len(jobs)} zips", file=sys.stderr)
    return rows, shas


def rest_klines(url_base: str, symbol: str) -> tuple[list[list] | None, str | None]:
    url = f"{url_base}?symbol={symbol}&interval=1d&startTime={REST_FROM_MS}&endTime={REST_TO_MS - 1}&limit=1000"
    try:
        raw = V.get(url, gap=0.12)
    except Exception:  # noqa: BLE001 - an unlisted symbol answers 400; the daily archive covers it
        return None, None
    data = json.loads(raw)
    if not isinstance(data, list):
        return None, None
    out = [[int(k[0]), float(k[1]), float(k[2]), float(k[3]), float(k[4]), float(k[5]), float(k[7])] for k in data]
    return out, hashlib.sha256(raw).hexdigest()


def daily_archive_klines(market: str, symbol: str) -> tuple[list[list], dict[str, str]]:
    out, shas = [], {}
    d = date(2026, 9, 1)
    while d < date(2026, 9, 26):
        p = f"data/{market}/daily/klines/{symbol}/1d/{symbol}-1d-{d.isoformat()}.zip"
        r, digest = V.vision_zip(p, allow404=True)
        if r is not None:
            out += parse_klines(r)
            shas[f"{V.VISION}/{p}"] = digest
        d = date.fromordinal(d.toordinal() + 1)
    return out, shas


def finish_rows(rows: list[list]) -> list[list]:
    """Sorted, one row per UTC day, and only whole days before 2026-09-26."""
    by_t = {}
    for r in rows:
        if r[0] % DAY != 0:
            raise SystemExit(f"a daily kline opens off midnight: {r[0]}")
        if r[0] < REST_TO_MS:
            by_t[r[0]] = r
    return [by_t[t] for t in sorted(by_t)]


FROZEN = INPUTS / "symbols_frozen.json"


def frozen() -> dict | None:
    """The symbol lists of the 2026-09-26 pull. A re-pull reads them instead of the archive's listing, which grows as
    Binance lists contracts, so that it rebuilds the same files byte for byte."""
    return json.loads(FROZEN.read_text()) if FROZEN.exists() else None


def stage_perps(man: dict) -> None:
    fz = frozen()
    if fz:
        symbols = fz["perps"]
    else:
        lists = {p.split("/")[-2] for p in V.s3_prefixes("data/futures/um/monthly/klines/")}
        symbols = sorted(s for s in lists if (s.endswith("USDT") or s.endswith("USDC")) and "_" not in s)
    print(f"perps: {len(symbols)} USDⓈ-M perpetuals quoted in USDT or USDC", file=sys.stderr)
    rows, shas = pull_archive_klines("futures/um", symbols, "1d")
    rest_shas = {}
    for s in symbols:
        rr, digest = rest_klines(f"{V.WWW}/fapi/v1/klines", s)
        if rr is not None:
            rows[s] += rr
            rest_shas[f"{V.WWW}/fapi/v1/klines?symbol={s}&interval=1d&startTime={REST_FROM_MS}&endTime={REST_TO_MS - 1}&limit=1000"] = digest
        elif rows[s] and rows[s][-1][0] >= int(datetime(2026, 8, 31, tzinfo=timezone.utc).timestamp() * 1000):
            dr, dsh = daily_archive_klines("futures/um", s)
            rows[s] += dr
            shas.update(dsh)
    out = {s: finish_rows(r) for s, r in rows.items() if r}
    sha = V.write_gz(INPUTS / "perp_1d.json.gz", out)
    man["inputs"]["perp_1d.json.gz"] = {"sha256": sha, "symbols": len(out),
                                         "rows": sum(len(v) for v in out.values()),
                                         "columns": "[open time ms, open, high, low, close, base volume, quote volume]"}
    man["sources"]["perp_1d"] = {**shas, **rest_shas}


def spot_pair_for(perp: str, spot: set[str]) -> str | None:
    base = perp[:-4]
    cands = [base] + [base[len(p):] for p in MULTIPLIERS if base.startswith(p) and len(base) > len(p)]
    for c in cands:
        if f"{c}USDT" in spot:
            return f"{c}USDT"
    return None


def stage_spot(man: dict) -> None:
    fz = frozen()
    if fz:
        pairs = fz["pairs"]
    else:
        perps = V.read_gz(INPUTS / "perp_1d.json.gz")
        spot_all = {p.split("/")[-2] for p in V.s3_prefixes("data/spot/monthly/klines/")}
        pairs = {}
        for s in perps:
            if not s.endswith("USDT"):
                continue
            sp = spot_pair_for(s, spot_all)
            if sp:
                pairs[s] = sp
    symbols = sorted(set(pairs.values()))
    print(f"spot: {len(symbols)} USDT pairs match a USDⓈ-M perpetual", file=sys.stderr)
    rows, shas = pull_archive_klines("spot", symbols, "1d")
    rest_shas = {}
    for s in symbols:
        rr, digest = rest_klines("https://data-api.binance.vision/api/v3/klines", s)
        if rr is not None:
            rows[s] += rr
            rest_shas[f"https://data-api.binance.vision/api/v3/klines?symbol={s}&interval=1d&startTime={REST_FROM_MS}&endTime={REST_TO_MS - 1}&limit=1000"] = digest
        elif rows[s] and rows[s][-1][0] >= int(datetime(2026, 8, 31, tzinfo=timezone.utc).timestamp() * 1000):
            dr, dsh = daily_archive_klines("spot", s)
            rows[s] += dr
            shas.update(dsh)
    out = {s: finish_rows(r) for s, r in rows.items() if r}
    sha = V.write_gz(INPUTS / "spot_1d.json.gz", out)
    sha2 = V.write_gz(INPUTS / "perp_spot_pairs.json.gz", dict(sorted(pairs.items())))
    man["inputs"]["spot_1d.json.gz"] = {"sha256": sha, "symbols": len(out), "rows": sum(len(v) for v in out.values()),
                                         "columns": "[open time ms, open, high, low, close, base volume, quote volume]"}
    man["inputs"]["perp_spot_pairs.json.gz"] = {"sha256": sha2, "pairs": len(pairs),
                                                 "rule": "same base, or the base with 1000000/10000/1000/100/1M stripped, quoted in USDT"}
    man["sources"]["spot_1d"] = {**shas, **rest_shas}


# ─────────────────────────────────────────────────────────────── funding


def funding_zip_paths(market: str, symbol: str) -> list[str]:
    prefix = f"data/futures/{market}/monthly/fundingRate/{symbol}/"
    keys = [k for k, _ in V.s3_keys(prefix) if k.endswith(".zip")]
    wanted = set(months())
    return sorted(k for k in keys if k[-11:-4] in wanted)


def parse_funding(rows: list[list[str]]) -> list[list]:
    out = []
    for r in rows:
        if not r or not r[0].strip().isdigit():
            continue
        # calc_time, funding_interval_hours, last_funding_rate
        out.append([V.ms_stamp(r[0]), int(r[1]), r[2].strip()])
    return out


def rest_funding(base: str, symbol: str) -> tuple[list[list], str | None]:
    url = f"{base}?symbol={symbol}&startTime={REST_FROM_MS}&endTime={REST_TO_MS - 1}&limit=1000"
    try:
        raw = V.get(url, gap=0.7)
    except Exception:  # noqa: BLE001
        return [], None
    data = json.loads(raw)
    if not isinstance(data, list):
        return [], None
    return [[int(x["fundingTime"]), None, x["fundingRate"]] for x in data], hashlib.sha256(raw).hexdigest()


def stage_funding(man: dict, symbols: list[str] | None = None) -> None:
    perps = V.read_gz(INPUTS / "perp_1d.json.gz")
    um = sorted(symbols or perps.keys())
    cm = ["BTCUSD_PERP", "ETHUSD_PERP"]
    jobs = [("um", s) for s in um] + [("cm", s) for s in cm]
    with cf.ThreadPoolExecutor(24) as ex:
        path_lists = list(ex.map(lambda j: funding_zip_paths(*j), jobs))
    zips = [(j, p) for j, ps in zip(jobs, path_lists) for p in ps]
    rows: dict[str, list] = {s: [] for _, s in jobs}
    shas = {}

    def one(z):
        (mk, s), p = z
        r, digest = V.vision_zip(p)
        return s, p, parse_funding(r), digest

    with cf.ThreadPoolExecutor(24) as ex:
        for s, p, parsed, digest in ex.map(one, zips):
            rows[s] += parsed
            shas[f"{V.VISION}/{p}"] = digest
    rest_shas = {}
    for mk, s in jobs:
        base = f"{V.WWW}/fapi/v1/fundingRate" if mk == "um" else f"{V.WWW}/dapi/v1/fundingRate"
        rr, digest = rest_funding(base, s)
        if digest:
            rest_shas[f"{base}?symbol={s}&startTime={REST_FROM_MS}&endTime={REST_TO_MS - 1}&limit=1000"] = digest
        rows[s] += rr
    out = {}
    for s, rr in rows.items():
        by_t = {}
        for t, ih, rate in rr:
            if t >= REST_TO_MS:
                continue
            prev = by_t.get(t)
            by_t[t] = [t, ih if ih is not None else (prev[1] if prev else None), rate]
        seq = [by_t[t] for t in sorted(by_t)]
        # the REST rows carry no interval: take it from the gap to the previous settlement
        for i, r in enumerate(seq):
            if r[1] is None and i > 0:
                r[1] = round((r[0] - seq[i - 1][0]) / 3_600_000)
        if seq:
            out[s] = seq
    sha = V.write_gz(INPUTS / "funding.json.gz", out)
    man["inputs"]["funding.json.gz"] = {"sha256": sha, "symbols": len(out), "rows": sum(len(v) for v in out.values()),
                                         "columns": "[settlement time ms as published, interval hours, rate as published (string)]"}
    man["sources"]["funding"] = {**shas, **rest_shas}


# ───────────────────────────────────────────────────────────── quarterlies


def stage_quarterly(man: dict) -> None:
    fz = frozen()
    if fz:
        contracts = fz["quarterlies"]
    else:
        lists = {p.split("/")[-2] for p in V.s3_prefixes("data/futures/um/monthly/klines/")}
        contracts = sorted(s for s in lists if (s.startswith("BTCUSDT_") or s.startswith("ETHUSDT_")) and s[-6:] >= "220930")
    rows, shas = pull_archive_klines("futures/um", contracts, "1d", threads=8)
    rest_shas = {}
    for s in contracts:
        rr, digest = rest_klines(f"{V.WWW}/fapi/v1/klines", s)
        if rr is not None:
            rows[s] += rr
            rest_shas[f"{V.WWW}/fapi/v1/klines?symbol={s}&interval=1d&startTime={REST_FROM_MS}&endTime={REST_TO_MS - 1}&limit=1000"] = digest
    out = {s: finish_rows(r) for s, r in rows.items() if r}
    sha = V.write_gz(INPUTS / "quarterly_1d.json.gz", out)
    man["inputs"]["quarterly_1d.json.gz"] = {"sha256": sha, "contracts": sorted(out),
                                              "columns": "[open time ms, open, high, low, close, base volume, quote volume]"}
    man["sources"]["quarterly_1d"] = {**shas, **rest_shas}


# ─────────────────────────────────────────────────────────── announcements


def cms_list(catalog: int) -> list[dict]:
    rows, page = [], 1
    while True:
        d = V.get_json(f"{V.WWW}/bapi/composite/v1/public/cms/article/list/query?type=1&catalogId={catalog}"
                       f"&pageNo={page}&pageSize=50", gap=0.6)
        cs = d["data"]["catalogs"]
        arts = cs[0]["articles"] if cs else []
        if not arts:
            break
        rows += [{"code": a["code"], "title": a["title"], "releaseDate": a["releaseDate"]} for a in arts]
        page += 1
    return rows


def cms_text(code: str) -> tuple[str, int | None]:
    d = V.get_json(f"{V.WWW}/bapi/composite/v1/public/cms/article/detail/query?articleCode={code}", gap=0.6)["data"]
    parts: list[str] = []

    def walk(node):
        if isinstance(node, dict):
            if node.get("node") == "text" and "text" in node:
                parts.append(node["text"])
            for k in ("child", "children"):
                if k in node:
                    walk(node[k])
            if node.get("tag") in ("p", "li", "h1", "h2", "h3", "h4", "tr", "br"):
                parts.append("\n")
        elif isinstance(node, list):
            for x in node:
                walk(x)
    try:
        walk(json.loads(d.get("body") or "{}"))
    except json.JSONDecodeError:
        parts.append(d.get("body") or "")
    return "".join(parts), d.get("publishDate")


def stage_announce(man: dict) -> None:
    cats = {161: cms_list(161), 48: cms_list(48)}
    texts = {}
    for cat, rows in cats.items():
        for r in rows:
            t = r["title"]
            if t.startswith("Binance Futures Will Delist") or t.startswith("Binance Futures Will Launch") \
                    or t.startswith("Binance Will Delist"):
                body, pub = cms_text(r["code"])
                texts[r["code"]] = {"title": t, "publishDate": pub, "text": body}
    out = {"catalogs": {str(k): sorted(v, key=lambda x: (x["releaseDate"], x["code"])) for k, v in cats.items()},
           "texts": dict(sorted(texts.items()))}
    sha = V.write_gz(INPUTS / "announcements.json.gz", out)
    man["inputs"]["announcements.json.gz"] = {"sha256": sha, "catalog161": len(cats[161]), "catalog48": len(cats[48]),
                                               "texts": len(texts)}
    man["sources"]["announcements"] = {
        f"{V.WWW}/bapi/composite/v1/public/cms/article/list/query?type=1&catalogId=161": "paged, pageSize=50",
        f"{V.WWW}/bapi/composite/v1/public/cms/article/list/query?type=1&catalogId=48": "paged, pageSize=50",
        f"{V.WWW}/bapi/composite/v1/public/cms/article/detail/query?articleCode=<code>": f"{len(texts)} texts",
    }


# ───────────────────────────────────────────────────────────────── books


def stage_books(man: dict, perp_symbols: list[str], spot_symbols: list[str], samples: int = 20) -> None:
    snaps = []
    for k in range(samples):
        t0 = time.time()
        fp = V.get_json(f"{V.WWW}/fapi/v1/ticker/bookTicker", gap=0.2)
        sp = V.get_json("https://data-api.binance.vision/api/v3/ticker/bookTicker", gap=0.2)
        fsel = {x["symbol"]: [x["bidPrice"], x["askPrice"]] for x in fp if x["symbol"] in perp_symbols}
        ssel = {x["symbol"]: [x["bidPrice"], x["askPrice"]] for x in sp if x["symbol"] in spot_symbols}
        snaps.append({"sample": k, "utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                      "perp": fsel, "spot": ssel})
        if k < samples - 1:
            time.sleep(max(0.0, 60.0 - (time.time() - t0)))
    sha = V.write_gz(INPUTS / "books.json.gz", snaps)
    man["inputs"]["books.json.gz"] = {"sha256": sha, "samples": samples, "perps": len(perp_symbols),
                                       "spot": len(spot_symbols), "first": snaps[0]["utc"], "last": snaps[-1]["utc"]}
    man["sources"]["books"] = {f"{V.WWW}/fapi/v1/ticker/bookTicker": f"{samples} samples, 60 s apart",
                               "https://data-api.binance.vision/api/v3/ticker/bookTicker": f"{samples} samples, 60 s apart"}


def stage_qbooks(man: dict, samples: int = 20) -> None:
    """Twenty bookTicker samples of the listed BTC and ETH USDⓈ-M quarterlies (the `books` stage keeps USDT names only)."""
    snaps = []
    for k in range(samples):
        t0 = time.time()
        fp = V.get_json(f"{V.WWW}/fapi/v1/ticker/bookTicker", gap=0.2)
        sel = {x["symbol"]: [x["bidPrice"], x["askPrice"]] for x in fp
               if x["symbol"].startswith("BTCUSDT_") or x["symbol"].startswith("ETHUSDT_")}
        snaps.append({"sample": k, "utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "quarterly": sel})
        if k < samples - 1:
            time.sleep(max(0.0, 60.0 - (time.time() - t0)))
    sha = V.write_gz(INPUTS / "qbooks.json.gz", snaps)
    man["inputs"]["qbooks.json.gz"] = {"sha256": sha, "samples": samples, "first": snaps[0]["utc"], "last": snaps[-1]["utc"]}
    man["sources"]["qbooks"] = {f"{V.WWW}/fapi/v1/ticker/bookTicker": f"{samples} samples, 60 s apart"}


def stage_exchangeinfo(man: dict) -> None:
    """The USDⓈ-M and COIN-M contract lists with their filters (min notional, PERCENT_PRICE, onboard dates)."""
    out, src = {}, {}
    for key, url in (("um", f"{V.WWW}/fapi/v1/exchangeInfo"), ("cm", f"{V.WWW}/dapi/v1/exchangeInfo")):
        raw = V.get(url, gap=1.0)
        d = json.loads(raw)
        d.pop("serverTime", None)  # the one clock in the reply; the pull date is in the file name
        out[key] = d
        src[url] = hashlib.sha256(raw).hexdigest()
    sha = V.write_gz(INPUTS / "exchangeinfo_2026-09-26.json.gz", out)
    man["inputs"]["exchangeinfo_2026-09-26.json.gz"] = {"sha256": sha, "um_symbols": len(out["um"]["symbols"]),
                                                          "cm_symbols": len(out["cm"]["symbols"])}
    man["sources"]["exchangeinfo"] = src


if __name__ == "__main__":
    stages = [a for a in sys.argv[1:] if not a.startswith("--")]
    for st in stages:
        man = load_manifest()
        print(f"== {st}", file=sys.stderr)
        if st == "merge":
            merge_manifest()
            continue
        if st == "freeze":
            # the lists this pull used, so that a re-pull asks for exactly the same contracts and pairs
            fz = {"perps": sorted(V.read_gz(INPUTS / "perp_1d.json.gz")),
                  "pairs": dict(sorted(V.read_gz(INPUTS / "perp_spot_pairs.json.gz").items())),
                  "quarterlies": sorted(V.read_gz(INPUTS / "quarterly_1d.json.gz"))}
            FROZEN.write_text(json.dumps(fz, indent=1, sort_keys=True) + "\n")
            continue
        if st == "perps":
            stage_perps(man)
        elif st == "spot":
            stage_spot(man)
        elif st == "funding":
            stage_funding(man)
        elif st == "quarterly":
            stage_quarterly(man)
        elif st == "announce":
            stage_announce(man)
        elif st == "exchangeinfo":
            stage_exchangeinfo(man)
        elif st == "qbooks":
            stage_qbooks(man)
        elif st == "books":
            # every USDT-quoted perpetual and spot pair the two endpoints list at the first sample
            fp0 = V.get_json(f"{V.WWW}/fapi/v1/ticker/bookTicker", gap=0.2)
            sp0 = V.get_json("https://data-api.binance.vision/api/v3/ticker/bookTicker", gap=0.2)
            stage_books(man, sorted({x["symbol"] for x in fp0 if x["symbol"].endswith("USDT")}),
                        sorted({x["symbol"] for x in sp0 if x["symbol"].endswith("USDT")}))
        else:
            raise SystemExit(f"unknown stage {st}")
        save_manifest(man, st)
