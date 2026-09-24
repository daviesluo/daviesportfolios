"""WX, descriptive only (not a test, not pre-registered): would a fresher forecast out-score the market? (fp4)

The pre-registered model reads the 48-hour forecast because it is causal at the
decision time (noon UTC the day before) in every time zone. The 24-hour forecast
(`max1`/`min1`) was issued later than that for most of the day it forecasts, so it
knows more than the market could have known at the decision time: feeding it to
the same model FLATTERS the model. This script refits the same error model on the
same in-sample events with the 24-hour forecast (wx_test.py's own functions) and
scores it with the market's price on the same out-of-sample buckets. If even the
flattered model scores worse than the market, the market out-forecasts the free
forecast. Prints one JSON line; trades nothing.

usage: wx_day1_brier.py <inputs .json.gz>
"""
import gzip
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import wx_test  # noqa: E402


def forecast_day1(e):
    key = "max1" if e["hl"] == "highest" else "min1"
    c = (e.get("f") or {}).get(key)
    if c is None:
        return None
    return c * 9.0 / 5.0 + 32.0 if e["unit"] == "F" else c


def main():
    with gzip.open(sys.argv[1], "rb") as f:
        events = json.loads(f.read())["events"]
    out = {}
    for name, fc in (("48h, as tested", wx_test.forecast), ("24h, not causal", forecast_day1)):
        wx_test.forecast = fc
        fits = wx_test.fit_models(events)
        _, _, brier = wx_test.decide(events, fits, wx_test.EDGE, wx_test.STAKE)
        out[name] = {k: {"n": v[0], "brier": round(v[1] / v[0], 6) if v[0] else None} for k, v in brier.items()}
    print(json.dumps(out, sort_keys=True))


if __name__ == "__main__":
    main()
