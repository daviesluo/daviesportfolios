"""S1a's input: the `fxw` pulls exported from public.ig_price_pulls with the read-only connector, checked against the
sha256 the database computed for the same text, and turned into ig_parse.py's normalized CSV.

The export (inputs/ig/fxw_sb_bars.csv) is one line a bar, written by this query on 2026-10-16:
  with b as (select p.id, e->>'snapshotTimeUTC' t, concat_ws(',', p.id, p.window_key, p.epic, e->>'snapshotTimeUTC',
    e->'openPrice'->>'bid', e->'highPrice'->>'bid', e->'lowPrice'->>'bid', e->'closePrice'->>'bid',
    e->'openPrice'->>'ask', e->'highPrice'->>'ask', e->'lowPrice'->>'ask', e->'closePrice'->>'ask',
    coalesce(e->'openPrice'->>'lastTraded',''), coalesce(e->>'lastTradedVolume','')) line
    from ig_price_pulls p, jsonb_array_elements(p.raw->'prices') e where p.plan='fxw' and p.account_kind='sb' and p.ok)
  select 'pull_id,…,volume' || E'\\n' || string_agg(line, E'\\n' order by id, t) || E'\\n'
and the database's sha256 of that text is EXPORT_SHA256 below. Run:
  python3 -I docs/agents/backtests/ig_deepdive/scripts/s1a_export.py
then s1a_transfer.py on the CSV it writes.
"""
import csv
import hashlib
import importlib.util
import os

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXPORT = os.path.join(HERE, "inputs", "ig", "fxw_sb_bars.csv")
EXPORT_SHA256 = "e6bddfabbfe5695381b8080f1768efd9ead69a8797156efbdbff22f83ecdc59e"


def main():
    raw = open(EXPORT, "rb").read()
    got = hashlib.sha256(raw).hexdigest()
    assert got == EXPORT_SHA256, f"export changed: {got}"
    pulls = {}
    for r in csv.DictReader(raw.decode().splitlines()):
        num = lambda k: float(r[k]) if r[k] != "" else None  # noqa: E731
        p = pulls.setdefault(r["pull_id"], {"epic": r["epic"], "window_key": r["window_key"], "raw": {"prices": []}})
        p["raw"]["prices"].append({
            "snapshotTimeUTC": r["snapshotTimeUTC"],
            "openPrice": {"bid": num("bid_open"), "ask": num("ask_open"), "lastTraded": num("last_open")},
            "highPrice": {"bid": num("bid_high"), "ask": num("ask_high"), "lastTraded": None},
            "lowPrice": {"bid": num("bid_low"), "ask": num("ask_low"), "lastTraded": None},
            "closePrice": {"bid": num("bid_close"), "ask": num("ask_close"), "lastTraded": None},
            "lastTradedVolume": num("volume"),
        })
    spec = importlib.util.spec_from_file_location("ig_parse", os.path.join(HERE, "scripts", "ig_parse.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    by_epic, counts = mod.parse([pulls[k] for k in sorted(pulls, key=int)], os.path.relpath(EXPORT, HERE), "start")
    os.makedirs(os.path.join(HERE, "data"), exist_ok=True)
    for epic, rows in by_epic.items():
        with open(os.path.join(HERE, "data", f"fxw_sb_{epic}.csv"), "w") as fh:
            fh.write(mod.to_csv(rows))
    print({e: c["rows"] for e, c in counts.items()}, "windows", len(pulls))


if __name__ == "__main__":
    main()
