"""PMLATE: how many daily-temperature events Gamma's tag lists on a few dates (exploration aid)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

for d in sys.argv[1:]:
    page = C.pmnet.get(C.GAMMA + "/events", {"tag_id": "103040", "end_date_min": d + "T00:00:00Z",
                                             "end_date_max": d + "T23:59:59Z", "limit": 100, "offset": 0}) or []
    names = sorted({e["slug"].split("-on-")[0].replace("temperature-in-", "") for e in page})
    print(d, len(page), names[:10])
