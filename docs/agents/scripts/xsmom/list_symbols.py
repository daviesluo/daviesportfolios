# Lists every symbol folder under data/spot/monthly/klines/ in Binance's public
# bulk archive, then the 1d monthly zip files of every *USDT symbol. The listing
# endpoint is the one data.binance.vision's own index page reads
# (BUCKET_URL = 'https://s3-ap-northeast-1.amazonaws.com/data.binance.vision').
# Keyless, read-only. Writes $S/binance_klines/listing_symbols.json and
# $S/binance_klines/listing_usdt_1d.json.
import urllib.request, urllib.parse, re, json, datetime, os, sys, concurrent.futures, time

S = os.environ.get("XSMOM_WORK") or sys.exit("set XSMOM_WORK to a working directory: binance_klines/ lives under it")
OUT = f"{S}/binance_klines"
BUCKET = "https://s3-ap-northeast-1.amazonaws.com/data.binance.vision"


def get(url, tries=6):
    for k in range(tries):
        try:
            return urllib.request.urlopen(url, timeout=60).read().decode()
        except Exception as e:  # noqa: BLE001
            if k == tries - 1:
                raise
            time.sleep(1.5 * (k + 1))


def list_prefix(prefix, want="keys"):
    keys, prefixes, marker = [], [], ""
    while True:
        url = f"{BUCKET}?delimiter=/&prefix={urllib.parse.quote(prefix)}" + (f"&marker={urllib.parse.quote(marker)}" if marker else "")
        x = get(url)
        ks = re.findall(r"<Key>([^<]+)</Key>", x)
        sz = [int(v) for v in re.findall(r"<Size>(\d+)</Size>", x)]
        ps = re.findall(r"<CommonPrefixes><Prefix>([^<]+)</Prefix></CommonPrefixes>", x)
        keys += list(zip(ks, sz))
        prefixes += ps
        trunc = "<IsTruncated>true</IsTruncated>" in x
        nm = re.findall(r"<NextMarker>([^<]+)</NextMarker>", x)
        if not trunc:
            break
        marker = nm[0] if nm else (ps[-1] if ps and (not ks or ps[-1] > ks[-1][0]) else ks[-1][0])
    return keys, prefixes


def main():
    fetched = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    _, prefixes = list_prefix("data/spot/monthly/klines/")
    symbols = sorted(p.split("/")[-2] for p in prefixes)
    json.dump({"fetched_at": fetched, "source": f"{BUCKET}?delimiter=/&prefix=data/spot/monthly/klines/", "n": len(symbols), "symbols": symbols},
              open(f"{OUT}/listing_symbols.json", "w"), indent=0)
    usdt = [s for s in symbols if s.endswith("USDT")]
    print(f"{len(symbols)} symbols, {len(usdt)} end in USDT", flush=True)

    def one(sym):
        keys, _ = list_prefix(f"data/spot/monthly/klines/{sym}/1d/")
        zips = [(k.split("/")[-1], s) for k, s in keys if k.endswith(".zip")]
        return sym, zips

    res = {}
    with concurrent.futures.ThreadPoolExecutor(16) as ex:
        for sym, zips in ex.map(one, usdt):
            res[sym] = zips
    fetched2 = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    json.dump({"fetched_at": fetched2, "interval": "1d", "n": len(res),
               "files": {s: [{"name": n, "size": z} for n, z in sorted(v)] for s, v in sorted(res.items())}},
              open(f"{OUT}/listing_usdt_1d.json", "w"), indent=0)
    nfiles = sum(len(v) for v in res.values())
    print(f"{len(res)} USDT symbols, {nfiles} monthly 1d zips", flush=True)


if __name__ == "__main__":
    main()
