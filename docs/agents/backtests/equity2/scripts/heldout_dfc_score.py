"""DFC held-out test, step 2 of 2: the scorer (`docs/agents/reviews/2026-10-01-dfc-prereg.md`). The only code that
reads a return dated after 2015-12-31. It refuses to run unless the frozen pre-registration and both DFC scripts are
committed and unmodified and the input is the frozen CRSP 202608 file; it checks the calendar from the date column
before it parses any return; it decides every condition of the pre-registration's §4 from unrounded values and writes
the verdict, the descriptive lines of §8, and the sha256 of everything it read, to ../results/heldout_dfc.json.
Written by the review of 2026-10-01 and adopted unchanged in its logic; never run on held-out data before the freeze.
Run from anywhere inside the repository: python3 docs/agents/backtests/equity2/scripts/heldout_dfc_score.py
"""
import gzip, hashlib, json, math, os, platform, random, subprocess, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
PREREG_REL = "docs/agents/reviews/2026-10-01-dfc-prereg.md"
FF_REL = "docs/agents/backtests/equity/inputs/F-F_Research_Data_Factors_daily.csv.gz"
FF_SHA = "ac244ddd12706212aaf6a0d6c958df9972addbb9c390ad149b8456160ae9288c"
FIRST, LAST, LAST_T = 20160104, 20260831, 20260731
EXPECTED = {3: 20, 2: 80, 1: 27}
SEED, B = 20261001, 10000
COST, COST2, ANN_MIN, SHARE_MAX = 0.0008, 0.0016, 0.01, 0.40
DESC_COSTS = (0.0003, 0.0004, 0.0008, 0.0016)


def sha(p):
    return hashlib.sha256(open(p, "rb").read()).hexdigest()


def regime(t):
    """Settlement cycle s by T's date (equal to the cycle on the deadline T-(s+1) for all 127 turns)."""
    return 1 if t >= 20240528 else (2 if t >= 20170905 else 3)


def windows(t, kind):
    s = regime(t) if kind == "H1" else 3
    return (-s, 3), (-(s + 5), -(s + 1))                     # PB, S as (first, last) offsets from T


def turn_index(dates, lo=20160101, hi=LAST_T):
    """Row of T (last row of its month that has a following row), for T in [lo, hi]."""
    ym = dates // 100
    return [i for i in range(len(dates) - 1) if ym[i] != ym[i + 1] and lo <= dates[i] <= hi]


def per_event(x, dates, T_idx, kind, rf=None):
    """Per event in T order: D (per-day PB mean minus per-day S mean) and the S, PB and TOM [0,+3] sums of the
    excess return, and RF summed over S (0 when rf is not given)."""
    out = []
    for k in T_idx:
        (a, b), (c, e) = windows(int(dates[k]), kind)
        pb, sw, tom = x[k + a:k + b + 1], x[k + c:k + e + 1], x[k:k + 4]
        assert len(pb) == b - a + 1 and len(sw) == 5 and len(tom) == 4
        rfs = 0.0 if rf is None else float(rf[k + c:k + e + 1].sum())
        out.append((float(pb.mean() - sw.mean()), float(sw.sum()), float(pb.sum()), float(tom.sum()), rfs))
    return out


def boot_p(v, seed=SEED, b=B):
    """Fresh Random(seed) per hypothesis; each resample is n draws rnd.randrange(n) over the events in T order."""
    rnd = random.Random(seed)
    n = len(v)
    le = sum(1 for _ in range(b) if np.mean([v[rnd.randrange(n)] for _ in range(n)]) <= 0)
    return (1 + le) / (1 + b)


def holm(p, alpha=0.05):
    """Holm across the family p = {name: unrounded p}: the j-th smallest (0-based) clears at alpha / (m - j) if every
    smaller one cleared. Equal p's are treated alike, at the stricter of their steps."""
    names = sorted(p, key=lambda h: (p[h], h))
    m, out, ok, j = len(names), {}, True, 0
    while j < m:
        grp = [g for g in names if p[g] == p[names[j]]]
        ok = ok and p[names[j]] <= alpha / (m - j)
        for g in grp:
            out[g] = ok
        j += len(grp)
    return out


def bar(ev, holm_ok):
    """Every condition of §4 for one hypothesis, from unrounded values; ev in T order."""
    n, h = len(ev), len(ev) // 2
    D = np.array([e[0] for e in ev]); act = -np.array([e[1] for e in ev])   # out over S, cash earning RF
    net = act - COST
    tot = float(net.sum())
    best = int(np.argmax(net))
    share = float(net[best] / tot) if tot > 0 else None
    c = {"1_holm": bool(holm_ok),
         "2_each_half_D": bool(D[:h].mean() > 0 and D[h:].mean() > 0),
         "3_dodge_total_and_halves_8bps": bool(tot > 0 and net[:h].sum() > 0 and net[h:].sum() > 0),
         "4_dodge_total_16bps": bool((act - COST2).sum() > 0),
         "5_not_one_month_8bps": bool(tot - net[best] > 0 and share is not None and share <= SHARE_MAX),
         "6_ann_at_least_1pct_8bps": bool(12 * net.mean() >= ANN_MIN)}
    c["pass"] = all(c.values())
    nums = {"n": n, "D_bps_day": 1e4 * D.mean(), "t": D.mean() / D.std(ddof=1) * math.sqrt(n),
            "D_first_half": 1e4 * D[:h].mean(), "D_second_half": 1e4 * D[h:].mean(),
            "dodge8_ann_pct": 100 * 12 * net.mean(), "dodge8_total_pct": 100 * tot,
            "dodge8_first_half_pct": 100 * net[:h].sum(), "dodge8_second_half_pct": 100 * net[h:].sum(),
            "dodge8_best_index": best, "dodge8_best_share": share, "dodge8_without_best_pct": 100 * (tot - net[best]),
            "dodge16_total_pct": 100 * (act - COST2).sum()}
    return c, nums


def descriptive(ev, x_window):
    """§8's lines on CRSP VW: the dodge at each cost (cash at RF) and at 8 bps with cash at 0; PB-only and TOM-only
    (in over the window, cash otherwise) against buy and hold, a year, with their volatilities."""
    S = np.array([e[1] for e in ev]); PB = np.array([e[2] for e in ev]); TOM = np.array([e[3] for e in ev])
    bh = 252 * float(np.mean(x_window))
    out = {"bh_excess_ann_pct": 100 * bh, "bh_vol_ann_pct": 100 * float(np.std(x_window, ddof=1)) * math.sqrt(252)}
    for c in DESC_COSTS:
        out[f"dodge_{round(c * 1e4)}bps_ann_pct"] = 100 * 12 * float((-S - c).mean())
        out[f"pb_only_{round(c * 1e4)}bps_minus_bh_ann_pct"] = 100 * (12 * float(PB.mean()) - 12 * c - bh)
        out[f"tom_only_{round(c * 1e4)}bps_minus_bh_ann_pct"] = 100 * (12 * float(TOM.mean()) - 12 * c - bh)
    out["dodge_8bps_cash_at_zero_ann_pct"] = 100 * 12 * float((-S - np.array([e[4] for e in ev]) - COST).mean())
    out["pb_only_vol_ann_pct"] = 100 * float(PB.std(ddof=1)) * math.sqrt(12)
    out["tom_only_vol_ann_pct"] = 100 * float(TOM.std(ddof=1)) * math.sqrt(12)
    return out


def git(*args, cwd=HERE):
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True)


def guard(repo):
    rel = [PREREG_REL, os.path.relpath(os.path.abspath(__file__), repo),
           os.path.relpath(os.path.join(HERE, "heldout_dfc_pull.py"), repo), FF_REL]
    for r in rel:
        if git("ls-files", "--error-unmatch", r, cwd=repo).returncode != 0:
            sys.exit(f"refusing: {r} is not committed")
    added = git("log", "--diff-filter=A", "--format=%H", "--", PREREG_REL, cwd=repo).stdout.split()
    if len(added) != 1 or git("rev-parse", "--verify", "--quiet", added[0] + "^", cwd=repo).returncode != 0:
        sys.exit("refusing: the commit that froze the pre-registration cannot be identified (a shallow clone: git fetch --deepen)")
    freeze = added[0]
    if git("diff", "--quiet", freeze, "--", *rel, cwd=repo).returncode != 0:
        sys.exit("refusing: a frozen file differs from the freeze commit")
    if sha(os.path.join(repo, FF_REL)) != FF_SHA:
        sys.exit("refusing: the input is not the frozen CRSP 202608 file")
    return {"freeze_commit": freeze, "head": git("rev-parse", "HEAD", cwd=repo).stdout.strip(),
            "sha256": {r: sha(os.path.join(repo, r)) for r in rel}}


def read_dates(path):
    out = []
    with gzip.open(path, "rt", encoding="latin-1") as f:
        started = False
        for line in f:
            s = line.strip()
            if not started:
                started = s.startswith(",") and "Mkt-RF" in s
                continue
            if not s or not s[0].isdigit():
                break
            out.append(int(s.split(",", 1)[0]))
    return np.array(out)


def read_returns(path, n_rows):
    mkt, rf = [], []
    with gzip.open(path, "rt", encoding="latin-1") as f:
        started = False
        for line in f:
            s = line.strip()
            if not started:
                started = s.startswith(",") and "Mkt-RF" in s
                continue
            if not s or not s[0].isdigit():
                break
            p = [v.strip() for v in s.split(",")]
            m_, r_ = float(p[1]), float(p[4])
            if not (math.isfinite(m_) and math.isfinite(r_)) or m_ <= -99.98 or r_ <= -99.98:
                sys.exit("stop: a missing code in the input; nothing is scored")    # no value is printed
            mkt.append(m_ / 100); rf.append(r_ / 100)
    assert len(mkt) == n_rows
    return np.array(mkt), np.array(rf)


def main():
    repo = git("rev-parse", "--show-toplevel").stdout.strip()
    prov = guard(repo)
    ff = os.path.join(repo, FF_REL)
    d = read_dates(ff)                                              # dates first; no return is parsed yet
    held = d[(d >= 20160101) & (d <= LAST)]
    if held[0] != FIRST or held[-1] != LAST:
        sys.exit(f"stop: held-out rows run {held[0]} .. {held[-1]}")
    T_idx = turn_index(d)
    counts = {s: sum(1 for k in T_idx if regime(int(d[k])) == s) for s in EXPECTED}
    if len(T_idx) != 127 or counts != EXPECTED:
        sys.exit(f"stop: {len(T_idx)} turns, by regime {counts}")
    x, rf = read_returns(ff, len(d))                                 # only now are returns read
    res = {"provenance": {**prov, "python": platform.python_version(), "numpy": np.__version__},
           "events": 127, "first_T": int(d[T_idx[0]]), "last_T": int(d[T_idx[-1]]),
           "halves": {"first": [int(d[T_idx[0]]), int(d[T_idx[62]])], "second": [int(d[T_idx[63]]), int(d[T_idx[-1]])]}}
    ev = {h: per_event(x, d, T_idx, h, rf) for h in ("H1", "H2")}
    p = {h: boot_p([e[0] for e in ev[h]]) for h in ev}
    ok = holm(p)                                                     # the family: H1 and H2 only (§3)
    sel = (d >= FIRST) & (d <= LAST)
    for h in ev:
        c, nums = bar(ev[h], ok[h])
        nums["dodge8_best_month"] = int(d[T_idx[nums.pop("dodge8_best_index")]] // 100)
        res[h] = {"p_boot": p[h], "conditions": c, "numbers": nums, "descriptive": descriptive(ev[h], x[sel])}
    passing = [h for h in ("H1", "H2") if res[h]["conditions"]["pass"]]
    res["verdict"] = {"passing": passing, "rule_that_runs": ("H1" if "H1" in passing else passing[0]) if passing else None}
    out = os.path.join(HERE, "..", "results", "heldout_dfc.json")
    json.dump(res, open(out, "w"), indent=1, sort_keys=True, default=float)
    print(json.dumps(res["verdict"]))


if __name__ == "__main__":
    main()
