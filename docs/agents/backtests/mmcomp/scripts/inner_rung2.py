# MMCOMP-2 part B: the 0.05 % inner rung again, on the stored record (FWD, 2026-09-26 -> 10-29) with LIVE's own fills taken
# out of the prints (sql/live_fill_prints.sql: 813 prints, their ids handed in as $MM_LIVE_PRINTS and never committed),
# each book alone and both, 'through' / 'at' / 'at, half the print', split at 10-13 (the maker 5 ticks wide before, 12 from).
# The engine is PR5-OPT's (`pr5_opt/scripts/sim.py`, unchanged) with LIVE's rules: £600, exits a tick beyond fair, the £1
# holding line. Paired by UTC day, bps of capital a day, circular 3-day block bootstrap, 10,000 resamples, seed 20261030.
#   MM_LIVE_PRINTS=<file of print ids> python3 -I docs/agents/backtests/mmcomp/scripts/inner_rung2.py -> results/inner_rung2.json
import collections, json, os, random, statistics as st, sys
HERE = os.path.dirname(os.path.abspath(__file__))
BT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.join(BT, "fair_price", "scripts"))
sys.path.insert(0, os.path.join(BT, "pr5_opt", "scripts"))
import fp_data as D
import sim

OUT = os.path.join(HERE, "..", "results", "inner_rung2.json")
DAY = sim.DAY
SEED, NB, BLOCK = 20261030, 10000, 3
FWD = (D.ms(2026, 9, 26), D.END); SPLIT = D.ms(2026, 10, 13)
FILLS = {"through": dict(fill="through"), "at": dict(fill="at"), "at_half": dict(fill="at", at_share=0.5)}
INNER = (0.0005, 0.001, 0.002, 0.003)


def daily(trips, t0, t1):
    d = collections.OrderedDict((t, 0.0) for t in range(t0, t1, DAY))
    for tr in trips:
        k = (min(max(tr["tExit"], t0), t1 - 1) - t0) // DAY * DAY + t0
        d[k] = d.get(k, 0.0) + tr["pnl"]
    return d


def boot(v):
    n = len(v); rnd = random.Random(SEED); out = []
    for _ in range(NB):
        s = []
        while len(s) < n:
            i = rnd.randrange(n); s.extend(v[(i + j) % n] for j in range(BLOCK))
        out.append(st.fmean(s[:n]))
    out.sort()
    return [round(out[int(0.05 * NB)], 3), round(out[int(0.95 * NB)], 3), round(sum(1 for x in out if x <= 0) / NB, 4)]


ids = set(l.strip() for l in open(os.environ["MM_LIVE_PRINTS"]) if l.strip())
mins = D.load_minutes(); prints = D.load_prints()
mins3 = {b: [(t, x, fu) for (t, x, fu, lag) in v] for b, v in mins.items()}
clean = {b: [p for p in v if p[4] not in ids] for b, v in prints.items()}
res = {"live_prints_removed": {b: len(prints[b]) - len(clean[b]) for b in prints}, "runs": {}}
print(res["live_prints_removed"], flush=True)
for books_name, books in (("both", ("USDC-GBP", "USDT-GBP")), ("USDT-GBP", ("USDT-GBP",)), ("USDC-GBP", ("USDC-GBP",))):
    m = {b: mins3[b] for b in books}
    cap = 600.0
    for fn, fkw in FILLS.items():
        base, _ = sim.run(m, clean, FWD[0], FWD[1], capital=cap, exit_off=1, hold_min_gbp=1.0, **fkw)
        inner, _ = sim.run(m, clean, FWD[0], FWD[1], capital=cap, exit_off=1, hold_min_gbp=1.0, rungs=INNER, **fkw)
        db, dc = daily(base, *FWD), daily(inner, *FWD)
        diff = [(dc[k] - db[k]) / cap * 1e4 for k in db]
        keys = list(db)
        h1 = [x for k, x in zip(keys, diff) if k < SPLIT]; h2 = [x for k, x in zip(keys, diff) if k >= SPLIT]
        it = [t for t in inner if t["k"] == INNER[0]]
        r = {"base_bpsDay": round(sum(db.values()) / cap * 1e4 / len(db), 3), "inner_bpsDay": round(sum(dc.values()) / cap * 1e4 / len(dc), 3),
             "diff": round(st.fmean(diff), 3), "boot": boot(diff), "before_10_13": round(st.fmean(h1), 3), "boot_before": boot(h1),
             "from_10_13": round(st.fmean(h2), 3), "boot_from": boot(h2), "inner_trips": len(it),
             "inner_bps_per_trip": round(1e4 * sum(t["pnl"] for t in it) / max(1e-9, sum(t["gbp"] for t in it)), 2) if it else None,
             "days_ahead": sum(1 for x in diff if x > 1e-9), "days_behind": sum(1 for x in diff if x < -1e-9)}
        res["runs"][f"{books_name}|{fn}"] = r
        print(books_name, fn, r, flush=True)
json.dump(res, open(OUT, "w"), indent=1, sort_keys=True)
