"""Probe the public trade endpoint: field names, counts, regions, paging. Never prints a price."""
import json, time, urllib.request, urllib.error, collections

UA = {"User-Agent": "daviesportfolios-research/1.0 (public market data)"}
BASE = "https://revx.revolut.com/api/1.0/public/trades/all"


def get(url):
    time.sleep(1.2)
    req = urllib.request.Request(url, headers=UA)
    try:
        with urllib.request.urlopen(req, timeout=60) as f:
            return f.status, json.loads(f.read())
    except urllib.error.HTTPError as e:
        return e.code, e.read()[:300]


DAY = 86400000
a = 1790294400000  # 2026-09-25 00:00 UTC
for sym in ("USDC-USD", "USDT-USD"):
    for extra in ("", "&region=UK"):
        st, d = get(f"{BASE}?symbol={sym}&start_date={a}&end_date={a + DAY}&limit=100{extra}")
        if st != 200:
            print(sym, repr(extra), "status", st, d)
            continue
        rows = d.get("data", [])
        meta = d.get("metadata")
        keys = sorted(rows[0].keys()) if rows else []
        reg = collections.Counter(r.get("region") for r in rows)
        ts = [int(r["timestamp"]) for r in rows]
        order = "desc" if ts == sorted(ts, reverse=True) else ("asc" if ts == sorted(ts) else "mixed")
        print(sym, repr(extra), "status", st, "rows", len(rows), "keys", keys, "regions", dict(reg),
              "meta_keys", sorted(meta.keys()) if isinstance(meta, dict) else meta,
              "has_cursor", bool((meta or {}).get("next_cursor")), "ts_order", order,
              "ts_span_h", round((max(ts) - min(ts)) / 3.6e6, 2) if ts else None)
