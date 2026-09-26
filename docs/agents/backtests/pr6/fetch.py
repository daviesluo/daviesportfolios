"""PR6 fetcher: Revolut X's PUBLIC UK trade tape and UK hourly candles for USDC-USD and USDT-USD. No key, no signed call.

Trades: GET https://revx.revolut.com/api/1.0/public/trades/all?symbol=SYM&start_date=<ms>&end_date=<ms>&limit=100&region=UK
        [&cursor=..]. One UTC day a window, [D 00:00:00.000, D 23:59:59.999], both bounds inclusive, so consecutive windows
        do not overlap; pages run newest first; follow metadata.next_cursor until it is empty. `region=UK` filters on the
        server; the extractor still drops any row whose region is not UK and reports how many it dropped.
Candles: GET https://revx.revolut.com/api/1.0/public/candles/SYM?interval=60&since=<ms>&until=<ms>&region=UK, at most 1,000 a
        call. Used only to check the tape's completeness (hourly volume); the rule never reads a candle.

One process, at least 1.1 s between request starts (the public bucket is one token a second); a 429 waits for its
Retry-After (milliseconds). Raw pages are written as returned, with the request that made them, so a rerun resumes and the
extraction can be audited.

Layout under PR6_DATA (default: ./data beside this file):
  raw/<SYM>.trades.pages.jsonl, raw/<SYM>.trades.days.jsonl, raw/<SYM>.candles60.pages.jsonl
  trades/<SYM>.jsonl   one print a line: {"id","ts","price","qty","side","region"} (price and qty the venue's strings),
                       de-duplicated by id, sorted by (ts, id)
  candles/<SYM>_60.json {"rows": [{"start","open","high","low","close","volume"}...]} de-duplicated by start, sorted
  audit/extract_<SYM>.json
usage:
  fetch.py trades SYM FIRST_DAY END_DAY_EXCLUSIVE
  fetch.py candles SYM SINCE_DAY UNTIL_DAY_EXCLUSIVE
  fetch.py extract SYM
"""
import collections, datetime, json, os, sys, time, urllib.error, urllib.request

D = os.environ.get("PR6_DATA") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
BASE = "https://revx.revolut.com/api/1.0/public"
UA = {"User-Agent": "daviesportfolios-research/1.0 (public market data)"}
DAY, HOUR = 86400000, 3600000
GAP = 1.1
_last = [0.0]


def ms(day):
    return int(datetime.datetime.fromisoformat(day + "T00:00").replace(tzinfo=datetime.timezone.utc).timestamp() * 1000)


def iso_day(t):
    return datetime.datetime.fromtimestamp(t / 1000, datetime.timezone.utc).strftime("%Y-%m-%d")


def get_json(url, tries=8):
    for attempt in range(tries):
        wait = _last[0] + GAP - time.time()
        if wait > 0:
            time.sleep(wait)
        _last[0] = time.time()
        t0 = time.time()
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=90) as f:
                return 200, json.loads(f.read()), t0
        except urllib.error.HTTPError as e:
            if e.code == 429:
                ra = e.headers.get("Retry-After")
                w = 2.0 * (attempt + 1)
                try:
                    if ra:
                        w = max(w, float(ra) / 1000.0)
                except ValueError:
                    pass
                time.sleep(min(120.0, w))
                continue
            if e.code in (400, 401, 403, 404):
                return e.code, None, t0
            time.sleep(3.0 * (attempt + 1))
        except Exception:
            time.sleep(3.0 * (attempt + 1))
    return -1, None, time.time()


def _done(fn):
    out = set()
    if os.path.exists(fn):
        for line in open(fn):
            r = json.loads(line)
            if r.get("ok"):
                out.add(r["day"])
    return out


def pull_trades(sym, d0, d1):
    os.makedirs(os.path.join(D, "raw"), exist_ok=True)
    pfn = os.path.join(D, "raw", f"{sym}.trades.pages.jsonl")
    dfn = os.path.join(D, "raw", f"{sym}.trades.days.jsonl")
    have = _done(dfn)
    pf, df = open(pfn, "a"), open(dfn, "a")
    a, z = ms(d0), ms(d1)
    while a < z:
        day = iso_day(a)
        if day not in have:
            for attempt in range(4):
                ok, pages, rows, err, cursor = True, 0, 0, "", ""
                buf = []
                while True:
                    url = f"{BASE}/trades/all?symbol={sym}&start_date={a}&end_date={a + DAY - 1}&limit=100&region=UK" + (f"&cursor={cursor}" if cursor else "")
                    st, d, t0 = get_json(url)
                    if st != 200 or not isinstance(d, dict) or "data" not in d:
                        ok, err = False, f"status {st}"
                        break
                    meta = d.get("metadata") or {}
                    buf.append({"sym": sym, "start_date": a, "end_date": a + DAY - 1, "page": pages, "cursor_in": cursor,
                                "t_req": round(t0, 3), "n": len(d["data"]), "metadata": meta, "data": d["data"]})
                    rows += len(d["data"])
                    pages += 1
                    cursor = meta.get("next_cursor") or ""
                    if not cursor:
                        break
                    if pages > 400:
                        ok, err = False, "too many pages"
                        break
                if ok:
                    for p in buf:
                        pf.write(json.dumps(p, sort_keys=True) + "\n")
                    pf.flush()
                df.write(json.dumps({"sym": sym, "day": day, "start_date": a, "ok": ok, "pages": pages, "rows": rows,
                                     "attempt": attempt, "err": err, "t": round(time.time(), 3)}) + "\n")
                df.flush()
                if ok:
                    break
                time.sleep(10 * (attempt + 1))
            print(f"{sym} {day} done", flush=True) if a % (30 * DAY) == 0 else None
        a += DAY
    pf.close(); df.close()
    print(f"DONE trades {sym}", flush=True)


def pull_candles(sym, d0, d1):
    os.makedirs(os.path.join(D, "raw"), exist_ok=True)
    pfn = os.path.join(D, "raw", f"{sym}.candles60.pages.jsonl")
    with open(pfn, "a") as pf:
        a, z = ms(d0), ms(d1)
        while a < z:
            b = min(z, a + 1000 * HOUR)
            url = f"{BASE}/candles/{sym}?interval=60&since={a}&until={b}&region=UK"
            st, d, t0 = get_json(url)
            pf.write(json.dumps({"sym": sym, "since": a, "until": b, "status": st, "t_req": round(t0, 3),
                                 "data": (d or {}).get("data") if isinstance(d, dict) else None}, sort_keys=True) + "\n")
            pf.flush()
            a = b
    print(f"DONE candles {sym}", flush=True)


def extract(sym):
    os.makedirs(os.path.join(D, "trades"), exist_ok=True)
    os.makedirs(os.path.join(D, "candles"), exist_ok=True)
    os.makedirs(os.path.join(D, "audit"), exist_ok=True)
    pages = [json.loads(l) for l in open(os.path.join(D, "raw", f"{sym}.trades.pages.jsonl"))]
    days = [json.loads(l) for l in open(os.path.join(D, "raw", f"{sym}.trades.days.jsonl"))]
    seen, rows = {}, []
    dup_same = dup_diff = outside = not_uk = sym_mismatch = 0
    for p in pages:
        a, b = p["start_date"], p["end_date"]
        for r in p["data"]:
            ts = int(r["timestamp"])
            if not (a <= ts <= b):
                outside += 1
            if r.get("symbol") != sym.replace("-", "/"):
                sym_mismatch += 1
            if r.get("region") != "UK":
                not_uk += 1
                continue
            rec = {"id": r["id"], "ts": ts, "price": r["price"], "qty": r["quantity"], "side": r["side"], "region": r["region"]}
            if rec["id"] in seen:
                if seen[rec["id"]] != rec:
                    dup_diff += 1
                else:
                    dup_same += 1
                continue
            seen[rec["id"]] = rec
            rows.append(rec)
    rows.sort(key=lambda x: (x["ts"], x["id"]))
    with open(os.path.join(D, "trades", f"{sym}.jsonl"), "w") as f:
        for r in rows:
            f.write(json.dumps(r, sort_keys=True) + "\n")
    ok_days = sorted({d["day"] for d in days if d["ok"]})
    failed = sorted({d["day"] for d in days if not d["ok"]} - set(ok_days))
    audit = {"symbol": sym, "pages": len(pages), "raw_rows": sum(len(p["data"]) for p in pages), "unique_prints": len(rows),
             "dup_identical": dup_same, "dup_with_different_fields": dup_diff, "rows_outside_request_window": outside,
             "rows_not_uk_dropped": not_uk, "symbol_mismatch": sym_mismatch, "days_ok": len(ok_days), "days_failed": failed,
             "first_day": ok_days[0] if ok_days else None, "last_day": ok_days[-1] if ok_days else None,
             "sides": dict(collections.Counter(r["side"] for r in rows)),
             "max_pages_a_day": max((d["pages"] for d in days if d["ok"]), default=0)}
    cfn = os.path.join(D, "raw", f"{sym}.candles60.pages.jsonl")
    if os.path.exists(cfn):
        by = {}
        bad = 0
        for l in open(cfn):
            p = json.loads(l)
            if p["status"] != 200 or p["data"] is None:
                bad += 1
                continue
            for c in p["data"]:
                by[int(c["start"])] = {k: c[k] for k in ("start", "open", "high", "low", "close", "volume")}
        crow = [by[k] for k in sorted(by)]
        json.dump({"rows": crow}, open(os.path.join(D, "candles", f"{sym}_60.json"), "w"), sort_keys=True)
        audit["candle_hours"] = len(crow)
        audit["candle_pages_failed"] = bad
    json.dump(audit, open(os.path.join(D, "audit", f"extract_{sym}.json"), "w"), indent=1, sort_keys=True)
    print(json.dumps(audit, sort_keys=True))


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "trades":
        pull_trades(sys.argv[2], sys.argv[3], sys.argv[4])
    elif cmd == "candles":
        pull_candles(sys.argv[2], sys.argv[3], sys.argv[4])
    elif cmd == "extract":
        extract(sys.argv[2])
    else:
        raise SystemExit(__doc__)
