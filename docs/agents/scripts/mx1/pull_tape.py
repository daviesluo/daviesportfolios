"""MX-1's weekly tape pull (reviews/2026-09-28-mx1-maker-first-prereg.md §2, "The tape").

Input: statement A of `weekly.sql` saved as JSON rows (id, ts, symbol, strategy_id, rulebook, bar_start). A probe's
event counts only if its decision's bar closed at or after the freeze, so a probe whose bar close (bar_start plus its
rulebook's bar: 4 h, 1 h or 1 day) is earlier is left out, and so is one written less than 66 minutes ago. Every other
probe gets a window of Revolut X's public UK prints of its symbol over [ts − 1 s, ts + 64 min]: every c_T §3 can use lies
inside it (a mark R2 wrote at most 3 minutes late, or t0 + T). Windows of one symbol that overlap are pulled as one.

  GET https://revx.revolut.com/api/1.0/public/trades/all?symbol={BASE}-USD&start_date=<ms>&end_date=<ms>&limit=100
  following metadata.next_cursor to its end, UK rows only, one request each 1.1 s, five attempts with pauses of 2, 4, 8
  and 16 s. A window that still fails is written as failed and tried again at every later pull; a window whose probes an
  earlier file in OUT_DIR already holds is not pulled again.

Output: one gzipped JSON file a pull, OUT_DIR/YYYY-MM-DD.json.gz (the pull's UTC date; a second pull that day adds
"-2"), sorted keys, mtime 0. The reading reads these files, not the venue.

    python3 docs/agents/scripts/mx1/pull_tape.py windows.json docs/agents/backtests/mx1/tape
"""
import datetime, glob, gzip, hashlib, io, json, os, sys, time, urllib.error, urllib.parse, urllib.request

FREEZE_MS = 1790597672000                       # 2026-09-28 12:14:32 UTC, the freeze commit's committer time
BAR_MS = {"trend-4h": 4 * 3600000, "trend-1h": 3600000, "momentum-1d": 86400000}
BEFORE_MS, AFTER_MS, SETTLE_MS = 1000, 64 * 60000, 66 * 60000
PAUSES = [2, 4, 8, 16]                          # five attempts
UA = {"Accept": "application/json", "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) daviesportfolios-research/1.0"}
_last = [0.0]


def ms(v):
    if isinstance(v, (int, float)):
        return int(v)
    s = str(v).replace(" ", "T")
    if s.endswith("+00"):
        s += ":00"
    return int(datetime.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp() * 1000)


def get(url):
    """One request, paced at 1.1 s; None after five failed attempts."""
    for i in range(len(PAUSES) + 1):
        wait = _last[0] + 1.1 - time.time()
        if wait > 0:
            time.sleep(wait)
        _last[0] = time.time()
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
                return json.loads(r.read().decode())
        except (urllib.error.URLError, TimeoutError, ValueError) as e:
            print(f"attempt {i + 1}: {url[:120]} -> {e}", file=sys.stderr)
        if i < len(PAUSES):
            time.sleep(PAUSES[i])
    return None


def pull(symbol, start, end):
    rows, cursor, seen = [], "", set()
    for _ in range(500):
        url = (f"https://revx.revolut.com/api/1.0/public/trades/all?symbol={symbol}&start_date={start}&end_date={end}"
               f"&limit=100" + (f"&cursor={urllib.parse.quote(cursor, safe='')}" if cursor else ""))
        d = get(url)
        if d is None or "data" not in d:
            return None
        for p in d["data"]:
            if p.get("region") == "UK" and p["id"] not in seen:
                seen.add(p["id"])
                rows.append([p["id"], int(p["timestamp"]), p["price"], p["quantity"], p.get("side")])
        cursor = (d.get("metadata") or {}).get("next_cursor") or ""
        if not cursor:
            return sorted(rows, key=lambda r: (r[1], r[0]))
    return None


def windows(probes, now_ms):
    out = []
    for p in probes:
        bar = BAR_MS.get(p.get("rulebook") or "")
        if bar is None or p.get("bar_start") is None or ms(p["bar_start"]) + bar < FREEZE_MS:
            continue
        t0 = ms(p["ts"])
        if t0 > now_ms - SETTLE_MS:
            continue
        out.append({"symbol": p["symbol"].replace("/", "-"), "start": t0 - BEFORE_MS, "end": t0 + AFTER_MS, "probe_ids": [int(p["id"])]})
    out.sort(key=lambda w: (w["symbol"], w["start"]))
    merged = []
    for w in out:
        m = merged[-1] if merged else None
        if m and m["symbol"] == w["symbol"] and w["start"] <= m["end"]:
            m["end"], m["probe_ids"] = max(m["end"], w["end"]), m["probe_ids"] + w["probe_ids"]
        else:
            merged.append(dict(w))
    return merged


def held(out_dir):
    done = set()
    for f in sorted(glob.glob(os.path.join(out_dir, "*.json.gz"))):
        for w in json.load(gzip.open(f))["windows"]:
            if w["ok"]:
                done.update(w["probe_ids"])
    return done


def main():
    src, out_dir = sys.argv[1], sys.argv[2]
    os.makedirs(out_dir, exist_ok=True)
    now_ms = int(time.time() * 1000)
    todo = [w for w in windows(json.load(open(src)), now_ms) if not set(w["probe_ids"]) <= held(out_dir)]
    for w in todo:
        prints = pull(w["symbol"], w["start"], w["end"])
        w["ok"], w["prints"] = prints is not None, prints or []
        print(f"{w['symbol']} {w['start']}..{w['end']} probes {w['probe_ids']}: {'ok' if w['ok'] else 'FAILED'} {len(w['prints'])} prints")
    day = datetime.datetime.fromtimestamp(now_ms / 1000, datetime.timezone.utc).strftime("%Y-%m-%d")
    path, n = os.path.join(out_dir, f"{day}.json.gz"), 2
    while os.path.exists(path):
        path, n = os.path.join(out_dir, f"{day}-{n}.json.gz"), n + 1
    doc = {"pulled_at": now_ms, "freeze_ms": FREEZE_MS, "script_sha256": hashlib.sha256(open(__file__, "rb").read()).hexdigest(),
           "source_sha256": hashlib.sha256(open(src, "rb").read()).hexdigest(), "windows": todo,
           "print_fields": ["id", "timestamp_ms", "price", "quantity", "side"]}
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb", mtime=0) as g:
        g.write(json.dumps(doc, sort_keys=True).encode())
    open(path, "wb").write(buf.getvalue())
    print(f"wrote {path}: {len(todo)} windows, {sum(1 for w in todo if not w['ok'])} failed")


if __name__ == "__main__":
    main()
