#!/usr/bin/env python3
"""Download Bitget's public historical spot files (keyless), the ones its
"History data download" page serves: daily trade tapes (every print: id, ms time,
price, taker side, quote and base size) and daily level-1 depth snapshots.

The page asks  POST https://www.bitget.com/v1/statistics/public/download/getPublicDataV2
with {displaySymbol:[SYM], businessLine:1 (spot), businessType:2 (trades) | 3 (depth),
dateType:1 (day), beginTimeStr, endTimeStr, deptType:1 (level 1)} in windows of at most
7 days, and gets back file URLs on img.bitgetimg.com. Files land in hist/<type>/<SYM>/.

usage: python3 pull_history.py trades|depth START END SYM [SYM ...] [--weekdays 2,5]
"""
import json, os, sys, time, datetime, urllib.request
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
API = "https://www.bitget.com/v1/statistics/public/download/getPublicDataV2"


def post(body):
    req = urllib.request.Request(API, data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "User-Agent": "Mozilla/5.0"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read())
        except Exception as e:
            time.sleep(1 + attempt)
    return {"code": "ERR"}


def fetch(url, path):
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return "cached"
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=60) as r:
                b = r.read()
            with open(path, "wb") as f:
                f.write(b)
            return "ok"
        except Exception as e:
            err = repr(e)
            time.sleep(1 + attempt)
    return "fail " + err[:120]


def main():
    kind, start, end = sys.argv[1], sys.argv[2], sys.argv[3]
    args = sys.argv[4:]
    weekdays = None
    if "--weekdays" in args:
        i = args.index("--weekdays")
        weekdays = {int(x) for x in args[i + 1].split(",")}
        args = args[:i] + args[i + 2:]
    syms = args
    btype = {"trades": 2, "depth": 3}[kind]
    d0 = datetime.date.fromisoformat(start)
    d1 = datetime.date.fromisoformat(end)
    manifest = []
    for sym in syms:
        outdir = os.path.join(HERE, "hist", kind, sym)
        os.makedirs(outdir, exist_ok=True)
        jobs = []
        a = d0
        while a <= d1:
            b = min(a + datetime.timedelta(days=6), d1)
            body = {"displaySymbol": [sym], "businessLine": 1, "businessType": btype, "dateType": 1,
                    "beginTimeStr": a.isoformat(), "endTimeStr": b.isoformat()}
            if kind == "depth":
                body["deptType"] = 1
            r = post(body)
            for item in (r.get("data") or []):
                day = datetime.date.fromisoformat(item["dateTimeStr"])
                if weekdays is not None and day.weekday() not in weekdays:
                    continue
                fn = f"{sym}_{item['dateTimeStr']}_{os.path.basename(item['fileUrl'])}"
                jobs.append((item["fileUrl"], os.path.join(outdir, fn), item["dateTimeStr"]))
            time.sleep(0.25)
            a = b + datetime.timedelta(days=1)
        with ThreadPoolExecutor(max_workers=4) as ex:
            res = list(ex.map(lambda j: (j, fetch(j[0], j[1])), jobs))
        fails = [j for j, s in res if s.startswith("fail")]
        manifest.append({"sym": sym, "kind": kind, "files": len(jobs), "failed": len(fails),
                         "first": min((j[2] for j in jobs), default=None), "last": max((j[2] for j in jobs), default=None)})
        print(json.dumps(manifest[-1]), flush=True)
    with open(os.path.join(HERE, "hist", f"manifest_{kind}_{start}_{end}.json"), "a") as f:
        f.write(json.dumps(manifest) + "\n")


if __name__ == "__main__":
    main()
