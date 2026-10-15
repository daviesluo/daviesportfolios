"""G2's parser: IG's raw /prices answers (as the `ig` function stored them in public.ig_price_pulls) to one CSV per epic.

Input: a JSON array exported with
    select json_agg(json_build_object('id', id, 'at', at, 'account_kind', account_kind, 'epic', epic,
        'window_key', window_key, 'from_param', from_param, 'to_param', to_param, 'points', points,
        'remaining_allowance', remaining_allowance, 'raw', raw) order by id)
      from public.ig_price_pulls where ok and plan = '<plan>' and account_kind = '<sb|cfd>';
saved as inputs/ig/<plan>_<account>.json. Output: data/<plan>_<account>_<epic>.csv with exactly the spec's columns
  epic, bar_start_utc, bar_end_utc, bid_open, bid_high, bid_low, bid_close, ask_open, ask_high, ask_low, ask_close,
  last_open, last_high, last_low, last_close, volume, source_file
and data/<plan>_<account>_counts.json (rows and duplicates per epic and window). A field absent from the raw answer is
empty, never made from another field. Bars are placed by `snapshotTimeUTC`; `--stamp end` reads it as the bar's end
(the probe decides which; s1a_transfer.py checks it against IG's documented Sunday open, fact F11). Re-running on the
same input writes the same bytes.

Run: python3 -I docs/agents/backtests/ig_deepdive/scripts/ig_parse.py inputs/ig/fxw_sb.json [--stamp start|end]
"""
import csv
import datetime as dt
import io
import json
import os
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COLS = ["epic", "bar_start_utc", "bar_end_utc", "bid_open", "bid_high", "bid_low", "bid_close", "ask_open", "ask_high",
        "ask_low", "ask_close", "last_open", "last_high", "last_low", "last_close", "volume", "source_file"]


def num(x):
    return "" if x is None else repr(float(x)) if isinstance(x, (int, float)) else ""


def parse(pulls, source_file, stamp="start"):
    """Rows by epic, sorted by bar start, and counts. A bar stamped twice keeps its first pull's values."""
    by_epic, counts = {}, {}
    for p in pulls:
        epic = p["epic"]
        c = counts.setdefault(epic, {"rows": 0, "duplicates": 0, "windows": 0, "empty_windows": []})
        c["windows"] += 1
        prices = (p.get("raw") or {}).get("prices") or []
        if not prices:
            c["empty_windows"].append(p["window_key"])
        for b in prices:
            t = dt.datetime.fromisoformat(b["snapshotTimeUTC"]).replace(tzinfo=dt.timezone.utc)
            start = t if stamp == "start" else t - dt.timedelta(hours=1)
            key = start.isoformat()
            rows = by_epic.setdefault(epic, {})
            if key in rows:
                c["duplicates"] += 1
                continue
            g = lambda side, f: num((b.get(side) or {}).get(f))  # noqa: E731
            rows[key] = {
                "epic": epic, "bar_start_utc": start.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "bar_end_utc": (start + dt.timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "bid_open": g("openPrice", "bid"), "bid_high": g("highPrice", "bid"), "bid_low": g("lowPrice", "bid"), "bid_close": g("closePrice", "bid"),
                "ask_open": g("openPrice", "ask"), "ask_high": g("highPrice", "ask"), "ask_low": g("lowPrice", "ask"), "ask_close": g("closePrice", "ask"),
                "last_open": g("openPrice", "lastTraded"), "last_high": g("highPrice", "lastTraded"), "last_low": g("lowPrice", "lastTraded"),
                "last_close": g("closePrice", "lastTraded"), "volume": num(b.get("lastTradedVolume")), "source_file": source_file,
            }
            c["rows"] += 1
    return {e: [r[k] for k in sorted(r)] for e, r in by_epic.items()}, counts


def to_csv(rows):
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=COLS, lineterminator="\n")
    w.writeheader()
    w.writerows(rows)
    return buf.getvalue()


def selftest():
    """A two-bar answer in IG's documented shape (labs /prices v3), worked by hand; a missing side stays empty."""
    raw = {"prices": [
        {"snapshotTime": "2026/10/11 22:00:00", "snapshotTimeUTC": "2026-10-11T20:00:00",
         "openPrice": {"bid": 0.695, "ask": 0.6952, "lastTraded": None}, "closePrice": {"bid": 0.6955, "ask": 0.6957, "lastTraded": None},
         "highPrice": {"bid": 0.696, "ask": 0.6962, "lastTraded": None}, "lowPrice": {"bid": 0.694, "ask": 0.6942, "lastTraded": None},
         "lastTradedVolume": 120},
        {"snapshotTimeUTC": "2026-10-11T20:00:00", "openPrice": {"bid": 9.9}},
        {"snapshotTimeUTC": "2026-10-11T21:00:00", "openPrice": {"bid": 0.699}, "closePrice": {"bid": 0.6995, "ask": 0.6997}},
    ], "metadata": {"allowance": {"remainingAllowance": 9990}}}
    rows, counts = parse([{"epic": "CS.D.AUDUSD.TODAY.IP", "window_key": "fxw:fx_audusd:2026-10-09", "raw": raw}], "inputs/ig/x.json")
    r = rows["CS.D.AUDUSD.TODAY.IP"]
    assert [x["bar_start_utc"] for x in r] == ["2026-10-11T20:00:00Z", "2026-10-11T21:00:00Z"], r
    assert r[0]["bid_open"] == "0.695" and r[0]["ask_close"] == "0.6957" and r[0]["last_open"] == "" and r[0]["volume"] == "120.0"
    assert r[1]["ask_open"] == "" and r[1]["bid_high"] == "", r[1]
    assert counts["CS.D.AUDUSD.TODAY.IP"]["duplicates"] == 1
    end, _ = parse([{"epic": "E.E.E.E", "window_key": "k", "raw": raw}], "x", stamp="end")
    assert end["E.E.E.E"][0]["bar_start_utc"] == "2026-10-11T19:00:00Z"
    assert to_csv(r).splitlines()[0] == ",".join(COLS)
    print("selftest ok")


def main():
    if "--selftest" in sys.argv:
        selftest()
        return
    src = sys.argv[1]
    stamp = sys.argv[sys.argv.index("--stamp") + 1] if "--stamp" in sys.argv else "start"
    path = src if os.path.isabs(src) else os.path.join(HERE, src)
    rel = os.path.relpath(path, HERE)
    base = os.path.splitext(os.path.basename(path))[0]
    by_epic, counts = parse(json.load(open(path)), rel, stamp)
    os.makedirs(os.path.join(HERE, "data"), exist_ok=True)
    for epic, rows in by_epic.items():
        with open(os.path.join(HERE, "data", f"{base}_{epic}.csv"), "w") as fh:
            fh.write(to_csv(rows))
    with open(os.path.join(HERE, "data", f"{base}_counts.json"), "w") as fh:
        json.dump({"stamp": stamp, "counts": counts}, fh, indent=1, sort_keys=True)
        fh.write("\n")
    print(json.dumps({"stamp": stamp, "counts": counts}, indent=1))


if __name__ == "__main__":
    main()
