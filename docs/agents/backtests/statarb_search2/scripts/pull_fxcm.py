"""Pull FXCM's public weekly 1-minute bid/ask archive (keyless) and keep two compact derivations of it.

For FXW (weekend gaps) and FIX (the London 4 pm fix at month end). The raw weekly files are ~150 KB each and ~2,200 of
them are read, so they are NOT committed: what is committed is

  inputs/fx/fxcm_<PAIR>_weekends.csv.gz  one row a weekend: Friday's last minute (bid/ask close) and, from the Sunday
                                         open, the first minute's bid/ask open and the mid's path at +1 h, +4 h, +24 h,
                                         plus the first minute (from the open) at which the mid touched Friday's close
  inputs/fx/fxcm_<PAIR>_fix.csv.gz       one row a London weekday: the mid at London 14:00, 15:00, 15:55, 16:00, 16:05,
                                         17:00, 18:00 (the minute's close; missing minutes skipped, blank if none)
  inputs/fx/fxcm_pull_log.json           every URL read, its HTTP status and the sha256 of the bytes served

A re-run reads the same archive; FXCM has served these files unchanged for years, but the log's hashes are the check.
"""
import gzip, hashlib, io, json, os, sys, datetime as dt
from concurrent.futures import ThreadPoolExecutor
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from netget import get

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(HERE, "inputs", "fx")
os.makedirs(OUT, exist_ok=True)
PAIRS = ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD"]
YEARS = range(2016, 2027)
LON = ZoneInfo("Europe/London")
UTC = dt.timezone.utc
FIX_TIMES = [(14, 0), (15, 0), (15, 55), (16, 0), (16, 5), (17, 0), (18, 0)]


def fetch(pair, year, week):
    url = f"https://candledata.fxcorporate.com/m1/{pair}/{year}/{week}.csv.gz"
    st, body = get(url, tries=4, timeout=60, ua="daviesportfolios-research/1.0 (public market data)")
    rows = []
    if st == 200 and body:
        try:
            raw = gzip.decompress(body)
            txt = raw.decode("utf-16") if raw[:2] in (b"\xff\xfe", b"\xfe\xff") else raw.decode()
            for ln in txt.splitlines()[1:]:
                p = ln.split(",")
                if len(p) < 9:
                    continue
                t = dt.datetime.strptime(p[0][:19], "%m/%d/%Y %H:%M:%S").replace(tzinfo=UTC)
                bo, bh, bl, bc, ao, ah, al, ac = map(float, p[1:9])
                rows.append((int(t.timestamp()), bo, bh, bl, bc, ao, ah, al, ac))
        except Exception as e:  # a corrupt file is logged, not guessed at
            st = f"parse-error {e}"
    return url, st, hashlib.sha256(body or b"").hexdigest(), rows


def main():
    log = []
    for pair in PAIRS:
        jobs = [(pair, y, w) for y in YEARS for w in range(1, 54)]
        minutes = {}
        with ThreadPoolExecutor(6) as ex:
            for url, st, sha, rows in ex.map(lambda a: fetch(*a), jobs):
                log.append({"url": url, "status": st, "sha256": sha, "minutes": len(rows)})
                for r in rows:
                    minutes[r[0]] = r
        ts = sorted(minutes)
        print(pair, len(ts), "minutes", file=sys.stderr)
        mid = {t: ((minutes[t][4] + minutes[t][8]) / 2) for t in ts}
        # weekends: a gap of > 24 h between consecutive minutes
        wk = io.StringIO()
        wk.write("fri_utc,fri_bid,fri_ask,sun_utc,sun_bid_open,sun_ask_open,mid_1h,mid_4h,mid_24h,fill_min,hi_24h,lo_24h\n")
        idx = {t: i for i, t in enumerate(ts)}
        for i in range(1, len(ts)):
            if ts[i] - ts[i - 1] < 24 * 3600:
                continue
            f, s = minutes[ts[i - 1]], minutes[ts[i]]
            fri_mid = (f[4] + f[8]) / 2
            sun_mid = (s[1] + s[5]) / 2
            def at(sec):
                j = i
                while j + 1 < len(ts) and ts[j + 1] <= ts[i] + sec:
                    j += 1
                return mid[ts[j]]
            fill = ""
            hi, lo = -1e9, 1e9
            j = i
            while j < len(ts) and ts[j] < ts[i] + 24 * 3600:
                m = minutes[ts[j]]
                mh, ml = (m[2] + m[6]) / 2, (m[3] + m[7]) / 2
                hi, lo = max(hi, mh), min(lo, ml)
                if fill == "" and ((sun_mid > fri_mid and ml <= fri_mid) or (sun_mid < fri_mid and mh >= fri_mid)):
                    fill = (ts[j] - ts[i]) // 60
                j += 1
            wk.write(f"{ts[i-1]},{f[4]},{f[8]},{ts[i]},{s[1]},{s[5]},{at(3600)},{at(4*3600)},{at(24*3600)},{fill},{hi},{lo}\n")
        open(os.path.join(OUT, f"fxcm_{pair}_weekends.csv.gz"), "wb").write(gzip.compress(wk.getvalue().encode(), mtime=0))
        # the fix: London clock times on each London weekday present in the data
        days = sorted({dt.datetime.fromtimestamp(t, UTC).astimezone(LON).date() for t in ts})
        fx = io.StringIO()
        fx.write("date," + ",".join(f"l{h:02d}{m:02d}" for h, m in FIX_TIMES) + "\n")
        for d in days:
            if d.weekday() >= 5:
                continue
            vals = []
            for h, m in FIX_TIMES:
                t = int(dt.datetime(d.year, d.month, d.day, h, m, tzinfo=LON).timestamp())
                # the close of the minute that ends at t: the bar stamped t - 60
                v = mid.get(t - 60)
                vals.append("" if v is None else repr(v))
            if any(vals):
                fx.write(d.isoformat() + "," + ",".join(vals) + "\n")
        open(os.path.join(OUT, f"fxcm_{pair}_fix.csv.gz"), "wb").write(gzip.compress(fx.getvalue().encode(), mtime=0))
    log.sort(key=lambda r: r["url"])
    json.dump(log, open(os.path.join(OUT, "fxcm_pull_log.json"), "w"), indent=0, sort_keys=True)
    ok = sum(1 for r in log if r["status"] == 200)
    print(ok, "of", len(log), "files served", file=sys.stderr)


if __name__ == "__main__":
    main()
