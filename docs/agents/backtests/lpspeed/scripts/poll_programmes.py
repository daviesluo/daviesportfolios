"""LP-SPEED (e): how fast do Polymarket's reward programmes change, and how fast do the public endpoints show it?

Usage: python3 -I poll_programmes.py <seconds> <out.jsonl> <condition id> [<condition id> ...]

Keyless GETs only. Every second, for each market, the CLOB's own programme (`/rewards/markets/{id}`, the read live-prep's
check makes every minute) as any caller sees it (through Cloudflare's cache) and with a cache-busting query (the origin);
every five seconds the sponsored listing (`/rewards/markets/current?sponsored=true`, the check's other read) and Gamma's
`clobRewards` for the same markets. Each answer is one line: time, which read, status, Cloudflare's cache status and
Age, and the programme reduced to what the check uses (the native rates in force today, the maximum spread, the minimum
size; the sponsored rate; Gamma's rate). Nothing is authenticated, nothing is written anywhere but <out.jsonl>.
"""
import json
import ssl
import sys
import threading
import time
import urllib.request
from datetime import datetime, timezone

secs, out_path, conds = int(sys.argv[1]), sys.argv[2], sys.argv[3:]
CTX = ssl.create_default_context(cafile="/root/.ccr/ca-bundle.crt")
CLOB, GAMMA = "https://clob.polymarket.com", "https://gamma-api.polymarket.com"
lock = threading.Lock()
out = open(out_path, "a", encoding="utf-8")


def get(url):
    t0 = time.time()
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "daviesportfolios-lpspeed/1.0 (public data, research)"})
        with urllib.request.urlopen(req, timeout=10, context=CTX) as r:
            body = r.read()
            h = {k.lower(): v for k, v in r.headers.items()}
            return r.status, h, body, time.time() - t0
    except Exception as e:  # noqa: BLE001 - a failed read is recorded as such
        return None, {}, str(e).encode()[:200], time.time() - t0


def today():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def programme(body, cond):
    try:
        d = json.loads(body)
        rows = [x for x in d.get("data", []) if x.get("condition_id") == cond]
        if not rows:
            return {"listed": False}
        x = rows[0]
        day = today()
        native = sum(float(c.get("rate_per_day") or 0) for c in x.get("rewards_config") or []
                     if (c.get("start_date") or "") <= day <= (c.get("end_date") or "9999"))
        return {"listed": True, "native": native, "v": x.get("rewards_max_spread"), "min": x.get("rewards_min_size"),
                "configs": [[c.get("id"), c.get("rate_per_day"), c.get("start_date"), c.get("end_date")] for c in x.get("rewards_config") or []]}
    except Exception as e:  # noqa: BLE001
        return {"error": str(e)[:100]}


def emit(rec):
    with lock:
        out.write(json.dumps(rec) + "\n")


def one(cond, bust):
    url = f"{CLOB}/rewards/markets/{cond}" + (f"?_={time.time_ns()}" if bust else "")
    t = time.time()
    st, h, body, dt = get(url)
    emit({"t": round(t, 3), "read": "clob_bust" if bust else "clob", "cond": cond[:12], "status": st, "dt": round(dt, 3),
          "cf": h.get("cf-cache-status"), "age": h.get("age"), "cc": h.get("cache-control"), "lm": h.get("last-modified"),
          **(programme(body, cond) if st == 200 else {"body": body[:120].decode("utf-8", "replace")})})


def listing():
    t = time.time()
    rows, cursor, pages, h0 = [], "MA==", 0, {}
    while cursor and cursor != "LTE=" and pages < 5:
        st, h, body, dt = get(f"{CLOB}/rewards/markets/current?sponsored=true&next_cursor={cursor}")
        pages += 1
        h0 = h0 or h
        if st != 200:
            emit({"t": round(t, 3), "read": "sponsored", "status": st})
            return
        d = json.loads(body)
        rows += d.get("data", [])
        cursor = d.get("next_cursor")
    sp = {}
    for r in rows:
        c = r.get("condition_id")
        if c in conds:
            sp[c[:12]] = sum(float(x.get("rate_per_day") or 0) for x in r.get("sponsored_rewards") or r.get("rewards_config") or [])
    emit({"t": round(t, 3), "read": "sponsored", "status": 200, "rows": len(rows), "cf": h0.get("cf-cache-status"),
          "age": h0.get("age"), "cc": h0.get("cache-control"), "ours": sp})


def gamma():
    t = time.time()
    q = "&".join(f"condition_ids={c}" for c in conds)
    st, h, body, dt = get(f"{GAMMA}/markets?{q}&limit={len(conds)}")
    rec = {"t": round(t, 3), "read": "gamma", "status": st, "dt": round(dt, 3), "cf": h.get("cf-cache-status"),
           "age": h.get("age"), "cc": h.get("cache-control"), "x-cache": h.get("x-cache")}
    if st == 200:
        try:
            rec["ours"] = {m.get("conditionId", "")[:12]: [[r.get("id"), r.get("rewardsDailyRate"), r.get("startDate"), r.get("endDate")]
                                                           for r in (m.get("clobRewards") or [])] for m in json.loads(body)}
        except Exception as e:  # noqa: BLE001
            rec["error"] = str(e)[:100]
    emit(rec)


end = time.time() + secs
n = 0
while time.time() < end:
    t0 = time.time()
    ths = [threading.Thread(target=one, args=(c, b)) for c in conds for b in (False, True)]
    if n % 5 == 0:
        ths += [threading.Thread(target=listing), threading.Thread(target=gamma)]
    for th in ths:
        th.start()
    for th in ths:
        th.join()
    n += 1
    time.sleep(max(0.0, 1.0 - (time.time() - t0)))
out.close()
print("cycles", n)
