"""PMLATE: which time-range parameters the data API's `/v2/trades` honours (exploration aid, keyless reads)."""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

EV = sys.argv[1] if len(sys.argv) > 1 else "1026310"
A, B = 1790300000, 1790310000
for pa, pb in (("start", "end"), ("start_ts", "end_ts"), ("after", "before"), ("from", "to"), ("startTime", "endTime"),
               ("min_timestamp", "max_timestamp"), ("start_time", "end_time")):
    d = C.pmnet.get(C.DATA_API + "/v2/trades", {"event_id": EV, "limit": 3, pa: A, pb: B, "_": str(int(time.time() * 1000))})
    rows = d.get("data") or []
    print(pa, pb, len(rows), [r.get("timestamp") for r in rows])
