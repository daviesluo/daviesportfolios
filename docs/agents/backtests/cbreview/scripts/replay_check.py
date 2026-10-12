"""Bar 1's replay on the paper test's first lit day, run twice: on the minute record as the engine stored it (2026-10-12), and on
the same record with the four side extremes the stored record lost (`cbMinuteRow`'s `reduce(Math.min)` bug) put back from the
prints. `../../cbpaper/scripts/replay.py` is run unchanged, on an export built the way the pre-registration's Deviation 1 says:
the minutes' X is 1, each trip's P&L is in the book's own currency (pnl_gbp * qty * entry / notional_gbp).

Inputs (`../inputs/`): lit_window_lines.json.gz, the lit window 2026-10-11 23:01 -> 2026-10-12 23:00 of the four books, one line a
minute from `../sql/export_lit_window.sql` (minute offset from 23:01, fair, prints_n, volume, sells, buys, the true extremes,
last, last side); trips_lit_window.json, the engine's eight round trips (`cb_quote_trips`). A stored extreme is non-null
exactly when its side printed once that minute (measured on all 12,728 decided minutes: 0 mismatches), so "as stored" is rebuilt
from the true extremes and the counts.
usage: python3 -I replay_check.py  -> ../results/replay_check.json
"""
import datetime, gzip, json, os, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
REPLAY = os.path.normpath(os.path.join(ROOT, "..", "cbpaper", "scripts", "replay.py"))
START = 1791759660  # 2026-10-11 23:01:00 UTC


def iso(i):
    return datetime.datetime.fromtimestamp(START + 60 * i, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def minutes(lines, book):
    stored, repaired = [], []
    for line in lines.split(";"):
        p = line.split(",")
        i, fair, pn, vol = int(p[0]), float(p[1]), int(p[2]), float(p[3])
        base = dict(book=book, minute=iso(i), x=1, fair=fair, prints_n=pn, vol=vol, sell_lo=None, sell_hi=None, buy_lo=None, buy_hi=None, last=None, last_side=None)
        if pn == 0:
            stored.append(dict(base)); repaired.append(dict(base)); continue
        ns, nb, rest = int(p[4]), int(p[5]), p[6:]   # concat_ws leaves out a side that did not print
        ex, last, ls = rest[:-2], float(rest[-2]), {"s": "sell", "b": "buy"}[rest[-1]]
        e, k = {}, 0
        if ns > 0:
            e["sell_lo"], e["sell_hi"] = float(ex[k]), float(ex[k + 1]); k += 2
        if nb > 0:
            e["buy_lo"], e["buy_hi"] = float(ex[k]), float(ex[k + 1]); k += 2
        assert k == len(ex), line
        repaired.append(dict(base, last=last, last_side=ls, **e))
        s = dict(base, last=last, last_side=ls)
        if ns == 1:
            s["sell_lo"], s["sell_hi"] = e["sell_lo"], e["sell_hi"]
        if nb == 1:
            s["buy_lo"], s["buy_hi"] = e["buy_lo"], e["buy_hi"]
        stored.append(s)
    return stored, repaired


def main():
    lines = json.load(gzip.open(os.path.join(ROOT, "inputs", "lit_window_lines.json.gz"), "rt"))
    trips = json.load(open(os.path.join(ROOT, "inputs", "trips_lit_window.json")))
    eng = [{"book": t["book"], "pnl_gbp": t["pnl_gbp"] * t["qty"] * t["entry"] / t["notional_gbp"]} for t in trips]
    out = {}
    for name, idx in (("record_as_stored", 0), ("record_with_extremes_restored", 1)):
        ms = [r for b in sorted(lines) for r in minutes(lines[b], b)[idx]]
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
            json.dump({"minutes": ms, "trips": eng}, f)
        r = subprocess.run([sys.executable, "-I", REPLAY, f.name], capture_output=True, text=True, check=True)
        os.unlink(f.name)
        out[name] = json.loads(r.stdout)
    json.dump(out, open(os.path.join(ROOT, "results", "replay_check.json"), "w"), indent=1, sort_keys=True)
    for k, v in out.items():
        print(k, v["all"])


if __name__ == "__main__":
    main()
