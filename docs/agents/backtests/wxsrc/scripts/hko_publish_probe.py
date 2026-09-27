"""WXSRC A5b: when does the Hong Kong Observatory's since-midnight CSV actually change, against its Last-Modified?

The live poll (`poll_live.py`, conditional GETs every 5 s) first saw each new ten-minute version 60–80 s after the
file's own Last-Modified. This probe asks whether that is the file or the poll: for the minutes around one or more
publications it reads the CSV every 2 s with a plain GET and a query string no earlier read carried (so no cache can
answer), and records each read's instant, status, Last-Modified, ETag, the server's Date and the HK Observatory row.

usage: hko_publish_probe.py <out jsonl> <minutes>
"""
import csv
import io
import json
import sys
import time
import urllib.request

sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
import wxcommon as X  # noqa: E402

URL = "https://data.weather.gov.hk/weatherAPI/hko_data/regional-weather/latest_since_midnight_maxmin.csv"


def main():
    outp, minutes = sys.argv[1], float(sys.argv[2])
    end = time.time() + 60 * minutes
    with open(outp, "a", buffering=1) as f:
        while time.time() < end:
            t0 = time.time()
            row, st, hd = None, 0, {}
            try:
                req = urllib.request.Request(URL + "?_=" + str(int(t0 * 1000)), headers={"User-Agent": X.UA})
                with urllib.request.urlopen(req, timeout=15) as r:
                    st, hd = r.status, dict(r.headers)
                    for rr in csv.reader(io.StringIO(r.read().decode("utf-8", "replace"))):
                        if len(rr) >= 4 and rr[1].strip() == "HK Observatory":
                            row = [x.strip() for x in rr]
            except Exception as e:  # noqa: BLE001
                hd = {"error": repr(e)[:120]}
            t1 = time.time()
            f.write(json.dumps({"t0": round(t0, 3), "t1": round(t1, 3), "status": st, "lm": hd.get("Last-Modified"),
                                "etag": hd.get("ETag"), "date": hd.get("Date"), "row": row, "err": hd.get("error")},
                               sort_keys=True) + "\n")
            time.sleep(max(0.0, 2.0 - (time.time() - t0)))


if __name__ == "__main__":
    main()
