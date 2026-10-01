"""Pull Revolut X's public UK 4h candles (keyless) for the live row's four coins, paged backwards with `until`,
spaced ~1.5 s apart (the public bucket is about a token a second, shared with the live tick). Writes {SYM}-USD_4h_revx.json
as [[start_ms, o, h, l, c, v], ...] sorted ascending, and a log of every request."""
import json, time, urllib.request, datetime
SYMS = ["BTC-USD", "ETH-USD", "SOL-USD", "AVAX-USD"]
BASE = "https://revx.revolut.com/api/1.0/public/candles/{sym}?interval=240&region=UK&since={since}&until={until}"
SPAN = 4 * 3600 * 1000
now_ms = int(time.time() * 1000)
until_end = (now_ms // SPAN) * SPAN            # exclude the forming bar's start? keep: filter closed bars below
log = []
for sym in SYMS:
    rows = {}
    until = now_ms
    for page in range(6):
        since = until - 1000 * SPAN
        url = BASE.format(sym=sym, since=since, until=until)
        for attempt in range(4):
            try:
                with urllib.request.urlopen(urllib.request.Request(url, headers={"Accept": "application/json"}), timeout=30) as r:
                    body = json.loads(r.read().decode()); status = r.status
                break
            except urllib.error.HTTPError as e:
                status = e.code; body = None
                time.sleep(3.0 * (attempt + 1))
        data = (body or {}).get("data", [])
        log.append({"sym": sym, "page": page, "since": since, "until": until, "status": status, "n": len(data),
                    "first": data[0]["start"] if data else None, "last": data[-1]["start"] if data else None,
                    "at": datetime.datetime.utcnow().isoformat() + "Z"})
        for c in data:
            rows[int(c["start"])] = [int(c["start"]), float(c["open"]), float(c["high"]), float(c["low"]), float(c["close"]), float(c["volume"])]
        time.sleep(1.5)
        if not data:
            break
        first = min(int(c["start"]) for c in data)
        if first >= until or len(data) < 10:
            break
        until = first - 1
    out = [rows[k] for k in sorted(rows) if k + SPAN <= now_ms]   # closed bars only
    json.dump(out, open(f"../inputs/revx_4h/{sym}_4h_revx.json", "w"))
    print(sym, len(out), datetime.datetime.utcfromtimestamp(out[0][0] / 1000).isoformat(), "->", datetime.datetime.utcfromtimestamp(out[-1][0] / 1000).isoformat())
json.dump({"pulled_at_ms": now_ms, "requests": log}, open("../inputs/revx_4h/pull_log.json", "w"), indent=1)
