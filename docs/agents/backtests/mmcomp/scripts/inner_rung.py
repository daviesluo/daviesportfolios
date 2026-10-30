# MMCOMP part 9: "queue competition with the other maker" on Revolut X alone. LIVE's rules (PR5-OPT's LIVE-realistic replay,
# docs/agents/backtests/pr5_opt/scripts/sim.py, imported unchanged; exits a tick beyond fair, the GBP 1 holding line), GBP 600,
# with one more rung inside the $5,000 maker's quote: 0.03 % or 0.05 % from fair, both sides, both books, the capital spread
# over all the rungs (so the outer rungs get less). Paired by UTC day against the same rules without it, in bps of capital a
# day, with REVX-FAIR's circular 3-day block bootstrap (10,000 resamples, seed 20261030; 90 % band and the share <= 0).
# Fill rules: 'through' (only prints strictly through), 'at' (a print at our price fills us fully: first in the queue) and
# 'at' with half the print (at_share 0.5, a queue we share). The maker quoted 5 ticks wide until 2026-10-12 and 12 ticks from
# 10-13 (part 3), so the FWD window is also split there. Windows: HIST 2026-08-26 -> 09-23 (the committed tape), FWD 09-26 ->
# 10-29 (REVX-FAIR's stored record; LIVE's own orders are NOT removed from the prints here).
# python3 -I docs/agents/backtests/mmcomp/scripts/inner_rung.py   -> results/inner_rung.json (about two minutes)
import collections, json, os, random, statistics as st, sys
HERE = os.path.dirname(os.path.abspath(__file__))
BT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.join(BT, "fair_price", "scripts"))
sys.path.insert(0, os.path.join(BT, "pr5_opt", "scripts"))
import fp_data as D
import sim

OUT = os.path.join(HERE, "..", "results", "inner_rung.json")
DAY = sim.DAY
CAP = 600.0
SEED, NB, BLOCK = 20261030, 10000, 3
LIVE = dict(capital=CAP, exit_off=1, hold_min_gbp=1.0)
FWD = (D.ms(2026, 9, 26), D.END); SPLIT = D.ms(2026, 10, 13)
HIST = (D.ms(2026, 8, 26), D.ms(2026, 9, 23)); HSPLIT = D.ms(2026, 9, 9)
VARIANTS = {"inner03": (0.0003, 0.001, 0.002, 0.003), "inner05": (0.0005, 0.001, 0.002, 0.003)}
FILLS = {"through": dict(fill="through"), "at": dict(fill="at"), "at_half": dict(fill="at", at_share=0.5)}


def daily(trips, t0, t1):
    d = collections.OrderedDict((t, 0.0) for t in range(t0, t1, DAY))
    for tr in trips:
        k = (min(max(tr["tExit"], t0), t1 - 1) - t0) // DAY * DAY + t0
        d[k] = d.get(k, 0.0) + tr["pnl"]
    return d


def boot(v):
    n = len(v)
    rnd = random.Random(SEED); out = []
    for _ in range(NB):
        s = []
        while len(s) < n:
            i = rnd.randrange(n)
            s.extend(v[(i + j) % n] for j in range(BLOCK))
        out.append(st.fmean(s[:n]))
    out.sort()
    return [round(out[int(0.05 * NB)], 3), round(out[int(0.95 * NB)], 3), round(sum(1 for x in out if x <= 0) / NB, 4)]


def compare(mins, prints, win, split):
    out = {}
    for fn, fkw in FILLS.items():
        base, _ = sim.run(mins, prints, win[0], win[1], **LIVE, **fkw)
        db = daily(base, *win)
        out[f"base|{fn}"] = {"bpsDay": round(sum(db.values()) / CAP * 1e4 / len(db), 3), "trips": len(base)}
        for vn, rungs in VARIANTS.items():
            tr, _ = sim.run(mins, prints, win[0], win[1], rungs=rungs, **LIVE, **fkw)
            dc = daily(tr, *win)
            diff = [(dc[k] - db[k]) / CAP * 1e4 for k in db]
            keys = list(db)
            inner = [t for t in tr if t["k"] == rungs[0]]
            out[f"{vn}|{fn}"] = {
                "bpsDay": round(sum(dc.values()) / CAP * 1e4 / len(dc), 3), "trips": len(tr), "inner_trips": len(inner),
                "inner_perTripBps": round(1e4 * sum(t["pnl"] for t in inner) / max(1e-9, sum(t["gbp"] for t in inner)), 2) if inner else None,
                "diffBpsDay": round(st.fmean(diff), 3), "boot90_pLe0": boot(diff),
                "before_split": round(st.fmean([x for k, x in zip(keys, diff) if k < split]), 3),
                "from_split": round(st.fmean([x for k, x in zip(keys, diff) if k >= split]), 3),
                "daysAhead": sum(1 for x in diff if x > 1e-9), "daysBehind": sum(1 for x in diff if x < -1e-9)}
            print(vn, fn, out[f"{vn}|{fn}"], flush=True)
    return out


mins = D.load_minutes(); prints = D.load_prints()
mins3 = {b: [(t, x, fu) for (t, x, fu, lag) in v] for b, v in mins.items()}
res = {"FWD": compare(mins3, prints, FWD, SPLIT)}
hm, hp = sim.load_hist(*HIST)
res["HIST"] = compare(hm, hp, HIST, HSPLIT)
json.dump(res, open(OUT, "w"), indent=1, sort_keys=True)
