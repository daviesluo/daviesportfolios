# Downloads Binance spot DAILY klines for every *USDT symbol the public bulk
# archive has ever held (delisted pairs included: the archive keeps their
# folders), keyless and read-only:
#
#   listing  https://s3-ap-northeast-1.amazonaws.com/data.binance.vision?delimiter=/&prefix=...
#            (the bucket data.binance.vision's own index page lists from:
#             BUCKET_URL = 'https://s3-ap-northeast-1.amazonaws.com/data.binance.vision')
#   files    https://data.binance.vision/data/spot/monthly/klines/{SYM}/1d/{SYM}-1d-{YYYY}-{MM}.zip
#            https://data.binance.vision/data/spot/daily/klines/{SYM}/1d/{SYM}-1d-2026-09-{DD}.zip
#
# Every zip is checked against the bucket's ETag (the MD5 of a single-part
# upload) and kept under $S/binance_klines/raw/. Each symbol's rows are then
# parsed into $S/binance_klines/daily/{SYM}.json as
#   [[open_time_sec, open, high, low, close, base_volume, quote_volume, trades], ...]
# (timestamps in the archive are milliseconds before 2025-01-01 and
# microseconds after; both are normalised to seconds). A manifest with the
# sha256 of every raw zip and every derived file is written last:
# $S/binance_klines/manifest.json.
#
#   python3 fetch_klines.py            # list + download + parse + manifest
#   python3 fetch_klines.py --verify   # re-hash everything against the manifest, download nothing
import urllib.request, urllib.parse, re, json, datetime, os, sys, hashlib, zipfile, io, concurrent.futures, time

S = os.environ.get("XSMOM_WORK") or sys.exit("set XSMOM_WORK to a working directory: binance_klines/ lives under it")
K = f"{S}/binance_klines"
RAW, DAILY = f"{K}/raw", f"{K}/daily"
BUCKET = "https://s3-ap-northeast-1.amazonaws.com/data.binance.vision"
FILES = "https://data.binance.vision"
SEPT_MONTH = "2026-09"


def get(url, binary=False, tries=8):
    for k in range(tries):
        try:
            b = urllib.request.urlopen(url, timeout=60).read()
            return b if binary else b.decode()
        except Exception:  # noqa: BLE001
            if k == tries - 1:
                raise
            time.sleep(1.0 * (k + 1))


def list_keys(prefix):
    out, marker = [], ""
    while True:
        url = f"{BUCKET}?delimiter=/&prefix={urllib.parse.quote(prefix)}" + (f"&marker={urllib.parse.quote(marker)}" if marker else "")
        x = get(url)
        for blk in re.findall(r"<Contents>(.*?)</Contents>", x, flags=re.S):
            key = re.search(r"<Key>([^<]+)</Key>", blk).group(1)
            etag = re.search(r"<ETag>([^<]+)</ETag>", blk).group(1).replace("&quot;", "").strip('"')
            size = int(re.search(r"<Size>(\d+)</Size>", blk).group(1))
            if key.endswith(".zip"):
                out.append({"key": key, "etag": etag, "size": size})
        if "<IsTruncated>true</IsTruncated>" not in x:
            break
        ks = re.findall(r"<Key>([^<]+)</Key>", x)
        marker = ks[-1]
    return out


def sha256_bytes(b):
    return hashlib.sha256(b).hexdigest()


def sha256_file(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def local_path(key):
    return f"{RAW}/{key[len('data/spot/'):]}"


def download(item):
    p = local_path(item["key"])
    if os.path.exists(p):
        b = open(p, "rb").read()
        if "-" in item["etag"] or hashlib.md5(b).hexdigest() == item["etag"]:
            return item["key"], "cached"
    b = get(f"{FILES}/{urllib.parse.quote(item['key'])}", binary=True)
    if "-" not in item["etag"] and hashlib.md5(b).hexdigest() != item["etag"]:
        raise RuntimeError(f"MD5 mismatch for {item['key']}")
    if len(b) != item["size"]:
        raise RuntimeError(f"size mismatch for {item['key']}")
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p + ".part", "wb") as f:
        f.write(b)
    os.replace(p + ".part", p)
    return item["key"], "downloaded"


def to_sec(t):
    t = int(t)
    if t > 10**14:  # microseconds (archive files from 2025-01-01 on)
        return t // 1_000_000
    return t // 1000


def parse_zip(p):
    rows = []
    with zipfile.ZipFile(p) as z:
        for name in z.namelist():
            for line in z.read(name).decode().splitlines():
                parts = line.strip().split(",")
                if len(parts) < 9 or not parts[0].strip().isdigit():
                    continue  # a header line
                rows.append([to_sec(parts[0]), float(parts[1]), float(parts[2]), float(parts[3]), float(parts[4]),
                             float(parts[5]), float(parts[7]), int(parts[8])])
    return rows


def main_fetch():
    os.makedirs(RAW, exist_ok=True)
    os.makedirs(DAILY, exist_ok=True)
    listed_at = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    syms = json.load(open(f"{K}/listing_symbols.json"))["symbols"]
    usdt = [s for s in syms if s.endswith("USDT")]

    def lst(sym):
        monthly = list_keys(f"data/spot/monthly/klines/{sym}/1d/")
        daily = []
        if any(m["key"].endswith("-2026-08.zip") for m in monthly) or not monthly:
            daily = list_keys(f"data/spot/daily/klines/{sym}/1d/{sym}-1d-{SEPT_MONTH}")
        return sym, monthly, daily

    listing = {}
    with concurrent.futures.ThreadPoolExecutor(24) as ex:
        for sym, monthly, daily in ex.map(lst, usdt):
            listing[sym] = {"monthly": monthly, "daily": daily}
    items = [it for v in listing.values() for it in v["monthly"] + v["daily"]]
    print(f"listed {len(listing)} symbols, {len(items)} zips", flush=True)
    json.dump({"listed_at": listed_at, "bucket": BUCKET, "files_host": FILES, "symbols": listing},
              open(f"{K}/listing_full.json", "w"), indent=0)

    counts = {"cached": 0, "downloaded": 0}
    with concurrent.futures.ThreadPoolExecutor(32) as ex:
        for i, (key, how) in enumerate(ex.map(download, items)):
            counts[how] += 1
            if (i + 1) % 2000 == 0:
                print(f"  {i + 1}/{len(items)} {counts}", flush=True)
    print(f"downloads: {counts}", flush=True)
    build_daily_and_manifest(listing, listed_at)


def build_daily_and_manifest(listing, listed_at):
    manifest = {"listed_at": listed_at, "bucket": BUCKET, "files_host": FILES,
                "row_format": "[open_time_sec, open, high, low, close, base_volume, quote_volume, trades]",
                "raw": {}, "daily": {}}
    for sym in sorted(listing):
        rows = {}
        for it in listing[sym]["monthly"] + listing[sym]["daily"]:
            p = local_path(it["key"])
            manifest["raw"][it["key"]] = {"sha256": sha256_file(p), "md5_etag": it["etag"], "size": it["size"]}
            for r in parse_zip(p):
                rows[r[0]] = r  # a daily file overlapping a monthly one (none expected) keeps one row per day
        series = [rows[t] for t in sorted(rows)]
        if not series:
            continue
        txt = json.dumps(series, separators=(",", ":"))
        dp = f"{DAILY}/{sym}.json"
        with open(dp, "w") as f:
            f.write(txt)
        manifest["daily"][sym] = {"sha256": sha256_bytes(txt.encode()), "rows": len(series),
                                   "first": datetime.datetime.fromtimestamp(series[0][0], datetime.timezone.utc).strftime("%Y-%m-%d"),
                                   "last": datetime.datetime.fromtimestamp(series[-1][0], datetime.timezone.utc).strftime("%Y-%m-%d"),
                                   "zips": len(listing[sym]["monthly"]) + len(listing[sym]["daily"])}
    txt = json.dumps(manifest, indent=0, sort_keys=True)
    with open(f"{K}/manifest.json", "w") as f:
        f.write(txt)
    print(f"manifest: {len(manifest['raw'])} zips, {len(manifest['daily'])} daily series, sha256 {sha256_bytes(txt.encode())}", flush=True)


def main_verify():
    m = json.load(open(f"{K}/manifest.json"))
    bad = 0
    for key, v in m["raw"].items():
        if sha256_file(local_path(key)) != v["sha256"]:
            bad += 1
            print("raw mismatch", key)
    for sym, v in m["daily"].items():
        if sha256_file(f"{DAILY}/{sym}.json") != v["sha256"]:
            bad += 1
            print("daily mismatch", sym)
    print(f"verify: {len(m['raw'])} zips, {len(m['daily'])} daily series, {bad} mismatches; manifest sha256 {sha256_file(f'{K}/manifest.json')}")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    if "--verify" in sys.argv:
        main_verify()
    else:
        main_fetch()
