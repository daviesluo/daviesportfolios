"""WX data step 3: every bucket's price at the decision time (fp4, test WX).

For every event of $PM_DATA/wx/events.json whose target date D falls in the
test windows: T_d = 12:00 UTC on the day before D. Each bucket whose market was
open then gets the last hourly point of its YES token at or before T_d (the CLOB's
public batch price history, the event's buckets in one request of up to 20
tokens, window [T_d - 6 h, T_d]). Nothing after T_d is requested. Writes
$PM_DATA/wx/prices.json: {cond: [t, p] | null}.
"""
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(__file__))
import pmnet  # noqa: E402

CLOB = "https://clob.polymarket.com"
LO, HI = "2025-01-01", "2026-09-10"


def t_decision(d):
    day = datetime.fromisoformat(d).replace(tzinfo=timezone.utc) - timedelta(days=1)
    return int(day.replace(hour=12).timestamp())


def main():
    ev = pmnet.load(os.path.join(pmnet.DATA, "wx", "events.json"))
    path = os.path.join(pmnet.DATA, "wx", "prices.json")
    have = pmnet.load(path) if os.path.exists(path) else {}
    n = 0
    for e in ev["events"]:
        if not (LO <= e["date"] < HI) or not e.get("station"):
            continue
        td = t_decision(e["date"])
        mk = [m for m in e["markets"] if m["cond"] not in have and m["start"] and m["closed"] and m["start"] < td < m["closed"]]
        for i in range(0, len(mk), 20):
            chunk = mk[i:i + 20]
            body = {"markets": [m["tokens"][0] for m in chunk], "start_ts": td - 6 * 3600, "end_ts": td, "fidelity": 60}
            try:
                d = pmnet.post(CLOB + "/batch-prices-history", body)
            except RuntimeError as err:
                print("error", e["date"], e["city"], str(err)[:120], flush=True)
                continue
            hist = d.get("history") or {}
            for m in chunk:
                pts = [p for p in (hist.get(m["tokens"][0]) or []) if p.get("t") is not None and p["t"] <= td]
                have[m["cond"]] = [pts[-1]["t"], pts[-1]["p"]] if pts else None
            n += 1
            if n % 300 == 0:
                pmnet.dump(path, have)
                print("requests", n, flush=True)
    pmnet.dump(path, have)
    print("done", n, "priced", sum(1 for v in have.values() if v), "of", len(have))


if __name__ == "__main__":
    main()
