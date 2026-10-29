"""FX-SPEED-LONG: Exness's public GBPUSD and EURUSD ticks over the Coinbase history window (2024-10 → 2026-10), as the
second-level FX of the long backtest (`cb_long.py`). Davies, 2026-10-29: "coinbase的所有策略用更多秒级数据更长时间再深度回测验证下".

Source (keyless, no login, plain GET): https://ticks.ex2archive.com/ticks/<PAIR>/<YYYY>/<MM>/Exness_<PAIR>_<YYYY>_<MM>.zip, one
CSV a month ("Exness","Symbol","Timestamp","Bid","Ask"; millisecond UTC stamps). The current month's file is rewritten nightly.

    python3 -I exness_long.py fetch EXN_DIR            # the 52 zips (2024-09 → 2026-10), each skipped when present
    python3 -I exness_long.py build EXN_DIR OUT.txt.gz # the derived file the replays read
    python3 -I exness_long.py manifest EXN_DIR OUT.json

The zips stay outside the repository (about 540 MB); `manifest` writes each one's URL, sha256, size and tick count. The derived
file has a row for every minute m in [FROM, TO) and pair with a tick in the minute or a value: the number of ticks stamped in
[m, m + 60 s), then for each s of OFFSETS the mid of the last tick at or before m + s seconds, in millionths, the first as it
is and the others as a difference from it ('=' before an absolute value where the first is missing); '-' when that tick is more
than STALE_MS old (the market closed, or a gap). Offsets: 0 (the price at the minute's start), 28 (where Yahoo's bar labelled
m sits, §7.2 of the review), 30, 45, 55, 57, 58 (60 is the next minute's 0).
"""
import csv, datetime, gzip, hashlib, io, json, os, sys, time, urllib.request, zipfile

M = 60_000
PAIRS = ("GBPUSD", "EURUSD")
MONTHS = [(2024, m) for m in range(9, 13)] + [(2025, m) for m in range(1, 13)] + [(2026, m) for m in range(1, 11)]
OFFSETS = (0, 28, 30, 45, 55, 57, 58)
STALE_MS = 10 * M
FROM = int(datetime.datetime(2024, 9, 29, tzinfo=datetime.timezone.utc).timestamp() * 1000)
TO = int(datetime.datetime(2026, 10, 29, tzinfo=datetime.timezone.utc).timestamp() * 1000)
N = (TO - FROM) // M


def url_of(pair, y, m):
    return f"https://ticks.ex2archive.com/ticks/{pair}/{y}/{m:02d}/Exness_{pair}_{y}_{m:02d}.zip"


def fetch(d):
    for pair in PAIRS:
        for y, m in MONTHS:
            p = os.path.join(d, f"Exness_{pair}_{y}_{m:02d}.zip")
            if os.path.exists(p) and os.path.getsize(p) > 0:
                continue
            for attempt in range(4):
                try:
                    body = urllib.request.urlopen(url_of(pair, y, m), timeout=120).read()
                    break
                except Exception as e:  # noqa: BLE001
                    print("retry", pair, y, m, e, file=sys.stderr)
                    time.sleep(5 * (attempt + 1))
            else:
                raise SystemExit(f"failed {pair} {y}-{m}")
            with open(p + ".part", "wb") as f:
                f.write(body)
            os.replace(p + ".part", p)
            print(pair, y, m, len(body), flush=True)
            time.sleep(1)


def month_ticks(pair, y, m, d):
    """(ms int64 array, mid float array, rows read, rows dropped) of one month's file, sorted by time; a tick whose ask is
    below its bid is dropped."""
    import numpy as np
    name = f"Exness_{pair}_{y}_{m:02d}"
    stamps, bids, asks = [], [], []
    with zipfile.ZipFile(os.path.join(d, name + ".zip")) as z:
        inner = [x for x in z.namelist() if x.endswith(".csv")][0]
        with z.open(inner) as f:
            r = csv.reader(io.TextIOWrapper(f, "utf-8"))
            next(r)
            for row in r:
                stamps.append(row[2].rstrip("Z")); bids.append(row[3]); asks.append(row[4])
    ts = np.array(stamps, dtype="datetime64[ms]").astype("int64")
    bid, ask = np.array(bids, dtype=float), np.array(asks, dtype=float)
    ok = ask >= bid
    ts, mid = ts[ok], ((bid + ask) / 2)[ok]
    o = np.argsort(ts, kind="stable")
    return ts[o], mid[o], len(stamps), int((~ok).sum())


def build(d, out_path):
    """Month by month (each month's ticks with the previous month's last one in front), so memory stays one month's."""
    import numpy as np
    with gzip.open(out_path, "wt", compresslevel=9) as out:
        out.write("pair\tminute\tn\t" + "\t".join(f"s{s}" for s in OFFSETS) + "\n")
        for pair in PAIRS:
            prev = None
            for y, mo in MONTHS:
                ts, mid, n, bad = month_ticks(pair, y, mo, d)
                if prev is not None:
                    ts, mid = np.concatenate(([prev[0]], ts)), np.concatenate(([prev[1]], mid))
                prev = (ts[-1], mid[-1])
                a = int(datetime.datetime(y, mo, 1, tzinfo=datetime.timezone.utc).timestamp() * 1000)
                ny, nm = (y + 1, 1) if mo == 12 else (y, mo + 1)
                b = int(datetime.datetime(ny, nm, 1, tzinfo=datetime.timezone.utc).timestamp() * 1000)
                mins = np.arange(max(a, FROM), min(b, TO), M, dtype="int64")
                print(pair, y, mo, n, "ticks,", bad, "dropped", file=sys.stderr, flush=True)
                if not len(mins):
                    continue
                cnt = np.searchsorted(ts, mins + M, side="left") - np.searchsorted(ts, mins, side="left")
                cols = []
                for s in OFFSETS:
                    at = mins + s * 1000
                    k = np.searchsorted(ts, at, side="right") - 1
                    kk = np.clip(k, 0, None)
                    good = (k >= 0) & (at - ts[kk] <= STALE_MS)
                    cols.append(np.where(good, np.round(mid[kk] * 1e6), np.nan))
                for j, m in enumerate(mins):
                    vals = [None if np.isnan(c[j]) else int(c[j]) for c in cols]
                    if cnt[j] == 0 and all(v is None for v in vals):
                        continue
                    base = vals[0]
                    cells = [str(int(cnt[j]))]
                    for i, v in enumerate(vals):
                        if v is None:
                            cells.append("-")
                        elif i == 0:
                            cells.append(str(v))
                        elif base is None:
                            cells.append("=" + str(v))
                        else:
                            cells.append(str(v - base))
                    out.write(f"{pair[0]}\t{int(m) // M}\t" + "\t".join(cells) + "\n")


class Long:
    """The derived file read back into arrays indexed by minute from FROM: `n[pair]` (ticks in the minute) and
    `v[pair][j]` (the mid at OFFSETS[j] seconds; NaN where there is none)."""

    def __init__(self, path):
        import numpy as np
        self.n = {p: np.zeros(N, dtype=np.int32) for p in PAIRS}
        self.v = {p: np.full((len(OFFSETS), N), np.nan) for p in PAIRS}
        name = {"G": "GBPUSD", "E": "EURUSD"}
        with gzip.open(path, "rt") as f:
            next(f)
            for l in f:
                p = l.rstrip("\n").split("\t")
                pair, i = name[p[0]], (int(p[1]) * M - FROM) // M
                self.n[pair][i] = int(p[2])
                cells = p[3:]
                base = None if cells[0] == "-" else int(cells[0])
                arr = self.v[pair]
                for j, c in enumerate(cells):
                    if c == "-":
                        continue
                    if j == 0:
                        arr[j, i] = base / 1e6
                    elif c[0] == "=":
                        arr[j, i] = int(c[1:]) / 1e6
                    else:
                        arr[j, i] = (base + int(c)) / 1e6

    @staticmethod
    def index(t_ms):
        return (t_ms - FROM) // M

    def col(self, pair, s):
        return self.v[pair][OFFSETS.index(s)]


def manifest(d, out):
    res = {"read": "2026-10-29 08:28-08:30 UTC, keyless GET, no login (the 2026-09 and 2026-10 files are FX-SPEED's of 07:54, same sha256)",
           "zips": {}}
    for pair in PAIRS:
        for y, m in MONTHS:
            name = f"Exness_{pair}_{y}_{m:02d}"
            p = os.path.join(d, name + ".zip")
            h = hashlib.sha256(open(p, "rb").read()).hexdigest()
            _, _, n, bad = month_ticks(pair, y, m, d)
            res["zips"][name + ".zip"] = {"url": url_of(pair, y, m), "sha256": h, "bytes": os.path.getsize(p), "ticks": n, "dropped_ask_below_bid": bad}
    json.dump(res, open(out, "w"), indent=1, sort_keys=True)


if __name__ == "__main__":
    if sys.argv[1] == "fetch":
        fetch(sys.argv[2])
    elif sys.argv[1] == "build":
        build(sys.argv[2], sys.argv[3])
    elif sys.argv[1] == "manifest":
        manifest(sys.argv[2], sys.argv[3])
