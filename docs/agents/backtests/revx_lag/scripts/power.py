"""REVX-LAG part 4, for variant-8's pre-registration (docs/agents/reviews/2026-10-29-revx-exit-tick-twin-prereg.md): how often
would a 28-day window of `exit1` against today's rule have passed that pre-registration's bar in the replay?

The replay is `robust.py`'s "at_share1" pair as run (the PR5-OPT engine unchanged, LIVE's "at" fill, £600, weekend held X):
today's rule and the same with every exit one tick beyond fair. Its daily difference, in bps of £600, over the out-of-sample
days (2026-05-12 → 10-29, the 09-23 → 09-26 gap between the tape and the recorded window left out), is cut into every 28-day
window starting on each day, and each window is read as the pre-registration reads its own: the mean, and a circular 3-day
block bootstrap of it, the share of resampled means at or below 0, PASS when the mean is above 0 and that share is under 0.10.
Here 2,000 resamples a window (the reading itself takes 10,000), seed 20261029.

Reported: the out-of-sample mean and standard deviation a day; the share of windows that pass, over all out-of-sample windows,
those wholly in May–August, and those that end in September or October (when LIVE's own fills are in the tape); and the same
for the in-sample half, for scale.
usage: python3 -I power.py OUT.json
"""
import collections, json, os, random, statistics as st, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import lag_data as L  # noqa: E402

CAP, WIN, BLOCK, NB, SEED = 600.0, 28, 3, 2000, 20261029


def boot_share(v, rnd):
    n, le = len(v), 0
    for _ in range(NB):
        s = []
        while len(s) < n:
            i = rnd.randrange(n); s.extend(v[(i + j) % n] for j in range(BLOCK))
        if st.fmean(s[:n]) <= 0: le += 1
    return le / NB


def windows(days, dv, rnd):
    out = []
    for i in range(len(days) - WIN + 1):
        w = dv[i:i + WIN]
        m = st.fmean(w)
        p = boot_share(w, rnd)
        out.append({"from": days[i], "to": days[i + WIN - 1], "mean_bps_day": round(m, 3), "p_le0": round(p, 4), "pass": m > 0 and p < 0.10})
    return out


def share(ws):
    return {"windows": len(ws), "pass_share": round(sum(1 for w in ws if w["pass"]) / len(ws), 3) if ws else None,
            "median_mean_bps_day": round(st.median(w["mean_bps_day"] for w in ws), 3) if ws else None}


def main(out):
    hm, hp, fm, fp = L.load_engine_inputs()
    runs = {}
    for arm, extra in (("base", {}), ("exit1", {"exit_off": 1})):
        d = collections.defaultdict(float)
        for mins, prints, win in ((hm, hp, L.HIST), (fm, fp, L.FWD)):
            tr, _ = L.sim.run(mins, prints, win[0], win[1], capital=CAP, xhold=True, fill="at", at_share=1.0, **extra)
            for x in tr: d[L.day(x["tExit"])] += x["pnl"]
        runs[arm] = d
        print(arm, round(sum(d.values()), 2), flush=True)
    span = lambda a, b: [L.day(t) for t in range(a, b, L.DAY)]
    split = L.day(L.SPLIT)
    alld = span(L.START["USDC-GBP"], L.HIST[1]) + span(L.FWD[0], L.FWD[1])
    dv = {x: (runs["exit1"].get(x, 0.0) - runs["base"].get(x, 0.0)) / CAP * 1e4 for x in alld}
    ins = [x for x in alld if x < split]; oos = [x for x in alld if x >= split]
    rnd = random.Random(SEED)
    w_oos = windows(oos, [dv[x] for x in oos], rnd)
    w_ins = windows(ins, [dv[x] for x in ins], rnd)
    res = {
        "oos_days": len(oos), "oos_mean_bps_day": round(st.fmean(dv[x] for x in oos), 3), "oos_sd_bps_day": round(st.pstdev(dv[x] for x in oos), 3),
        "is_days": len(ins), "is_mean_bps_day": round(st.fmean(dv[x] for x in ins), 3), "is_sd_bps_day": round(st.pstdev(dv[x] for x in ins), 3),
        "sep_oct_mean_bps_day": round(st.fmean(dv[x] for x in oos if x >= "2026-09-01"), 3),
        "windows_oos": share(w_oos), "windows_oos_may_aug": share([w for w in w_oos if w["to"] < "2026-09-01"]),
        "windows_oos_ending_sep_oct": share([w for w in w_oos if w["to"] >= "2026-09-01"]),
        "windows_is": share(w_ins), "windows_oos_each": w_oos,
    }
    print(json.dumps({k: v for k, v in res.items() if k != "windows_oos_each"}), flush=True)
    json.dump(res, open(out, "w"), indent=1, sort_keys=True)


if __name__ == "__main__":
    main(sys.argv[1])
