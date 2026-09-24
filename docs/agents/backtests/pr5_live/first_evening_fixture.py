"""The fixture `quotes.test.ts` replays PR5's paper engine on: its first evening, 2026-09-23 15:09 → 18:30 UTC.

Cut from the public data the live design pulled into `inputs/` (prints, the USD books' hours, Yahoo's GBP/USD minutes),
which match what the engine stored hour by hour (reconcile_first_day.py), plus what the engine recorded over the same
minutes: each book's orders and refusals per minute, as a count and a sum of ticks. Every order the engine placed that
evening is inside the window (the last at 18:24, the next at 00:13), and the window has no fill.

The engine's side was read 2026-09-24 23:15:26 UTC (the database's clock) with
    select kind, book, to_char(minute, 'HH24:MI') m, count(*) n, sum(ticks) tk from public.agent_quote_events
    where kind in ('order', 'refused', 'withdraw', 'fill', 'exit', 'stop')
      and minute >= '2026-09-23 15:09' and minute <= '2026-09-23 18:30' group by 1, 2, 3;
It returned orders and refusals only.

usage: python3 docs/agents/backtests/pr5_live/first_evening_fixture.py   (writes first_evening_fixture.json beside it)
"""
import datetime, gzip, json, os

HERE = os.path.dirname(os.path.abspath(__file__))
IN = os.path.join(HERE, "inputs")
g = lambda n: json.load(gzip.open(os.path.join(IN, n + ".json.gz"), "rt"))
utc = lambda *a: int(datetime.datetime(*a, tzinfo=datetime.timezone.utc).timestamp() * 1000)
M, H = 60_000, 3_600_000

FROM, TO = utc(2026, 9, 23, 15, 9), utc(2026, 9, 23, 18, 30)
ENGINE = {
    "order": {
        "USDC-GBP": {"15:09": [6, 45245], "15:33": [6, 45268], "16:32": [6, 45292], "16:50": [6, 45318], "16:53": [6, 45342],
                     "17:07": [5, 37812], "17:23": [6, 45342], "17:43": [6, 45305], "17:47": [6, 45280], "18:24": [6, 45303]},
        "USDT-GBP": {"15:09": [6, 45231], "15:33": [6, 45253], "16:32": [6, 45277], "16:50": [6, 45305], "16:53": [5, 37782],
                     "17:07": [5, 37801], "17:23": [5, 37781], "17:43": [6, 45290], "17:47": [6, 45265], "18:24": [6, 45289]},
    },
    "refused": {
        "USDC-GBP": {"15:34": [1, 7537], "16:54": [1, 7549]},
        "USDT-GBP": {"16:51": [1, 7543], "17:08": [1, 7543]},
    },
}

prints = g("revx_gbp_prints")["prints"]
yahoo = g("yahoo_gbpusd_1m")["chart"]["chart"]["result"][0]
hours = g("revx_usd_hourly")["series"]
out = {
    "from": FROM, "to": TO,
    # Every UK print of the day up to the window's end: the engine's first run seeds each book with its last print before it.
    "prints": {b: [[r["id"], r["ts"], r["price"], r["qty"], r["side"]] for r in sorted(rows, key=lambda r: (r["ts"], r["id"]))
                   if r.get("region", "UK") == "UK" and utc(2026, 9, 23) <= r["ts"] < TO + M] for b, rows in prints.items()},
    # GBP/USD minute closes from 30 minutes before the window (X looks back ten) to its end.
    "fx": [[t * 1000, c] for t, c in zip(yahoo["timestamp"], yahoo["indicators"]["quote"][0]["close"]) if c is not None and FROM - 30 * M <= t * 1000 <= TO + M],
    # The USD books' hourly closes a day and a half back (fair is the median of the last 24 whole hours).
    "hours": {s: [[int(r["start"]), r["close"]] for r in rows if FROM - 36 * H <= int(r["start"]) <= TO] for s, rows in hours.items()},
    "engine": ENGINE,
}
json.dump(out, open(os.path.join(HERE, "first_evening_fixture.json"), "w"), separators=(",", ":"), sort_keys=True)
print({"prints": {b: len(v) for b, v in out["prints"].items()}, "fx": len(out["fx"]), "hours": {s: len(v) for s, v in out["hours"].items()}})
