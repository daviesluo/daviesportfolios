"""CBFAST: what a fast-move / news guard would have done for PR5's frozen rule on Coinbase's four books
(docs/agents/reviews/2026-10-15-coinbase-fast-move.md). Exploratory, with the parameters chosen on one span and read on the
other. It changes NOTHING in the running tests: it imports `cbk.py` (and through it the venue screen's `sv_sim.py` and PR5's
frozen `pr5_sim.py`) read-only, and its only simulator is `gsim`, a line-for-line copy of `pr5_sim.simulate`'s primary arm with
four hooks the guards need (entry rungs withdrawn on a side at a turn, a rung-width multiplier, the stop's length); with no
hook it must give `pr5_sim.simulate`'s trips exactly, which `main()` checks before anything else.

A guard is a decision made at the start of minute t on data up to t-1, as the engine's own turn is: it cannot see the minute
it is trying to avoid. It withdraws the entry rungs of a side (or both) for the turn and for `H-1` turns after the last
turn that tripped it; exit orders are never touched (a stale exit is the engine's own rule, and the stop still runs).

Families (signals at a turn, from the book's own tape and its fair; `up` endangers the asks, `dn` the bids):
* g1_dev    the last print (within 3 minutes) over the fair, less 1: up = print above fair, dn = print below; trips above X bp
* g2_tape   the tape alone: up = last print over the lowest low of the last Z minutes, dn = the highest high over the last print; above Y bp
* g4_fair   the fair's own move over m minutes (up when the fair rose); above X bp
* g3_cal    the scheduled releases of ../inputs/events.json (calendar_events.py): both sides' ENTRY rungs off from `a` minutes before to `b` after
* g3d_cal   the same minutes with the fair itself withheld (`dark`): entries off AND exit orders neither placed nor re-priced, which is all the
            frozen `stepMinute` can do as it stands (it is what a null `fairU` does), so the version a sibling arm could run
* g5_fx     the interbank EUR/USD and GBP/USD read `s` minutes sooner than the screen has them (an upper bound on a faster feed)
* g6_stop   the taker stop after `stop_min` minutes instead of 1,440
* wide      the entry rungs `w` times as far from fair while g1 (both sides) is tripped
* oracle    NOT a guard: the minute's own range (look-ahead) over Y bp withdraws that minute; the most any reactive rule could do
Modes: "side" withdraws asks on `up` and bids on `dn`; "both" withdraws both on either.

usage: python3 -I cbfast.py stage1   -> ../results/cbfast_grid.json (about 25 minutes on four cores); cbfast_events.py and cbfast_lit.py follow it
"""
import collections, datetime, gzip, json, multiprocessing as mp, os, random, sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import cbk  # noqa: E402  (read-only; imports sv_sim and pr5_sim through it)

S, P, M, DAY, KEYS = cbk.S, cbk.P, cbk.M, cbk.DAY, cbk.KEYS
CAP_GBP = 2400.0     # 4 books x 6 rungs x GBP 100: the venue screen's own capital for a % (the paper test holds GBP 1,200 + EUR 1,200)
END = S.END
SPANS = {"span_1_2024-10-09_to_2025-10-09": (S.CI.ms("2024-10-09T00:00"), S.CI.ms("2025-10-09T00:00")),
         "span_2_2025-10-09_to_2026-10-09": (S.CI.ms("2025-10-09T00:00"), END)}


# ------------------------------------------------------------------------------------------------ the simulator
def gsim(B, size=100.0, pb=None, pa=None, mult=None, stop_min=1440, dark=None):
    """pr5_sim.simulate (primary arm: not stress, not side_aware), with hooks. pb[i] / pa[i]: withdraw the bid / ask entry rungs at turn i.
    mult[i]: the entry rungs' offsets times this at turn i (a change re-places a resting rung). stop_min: the taker stop's age.
    dark[i]: the turn sees NO fair at all (entries withdrawn AND exit orders neither placed nor re-priced): what `stepMinute` does
    when `fairU` is null, so the one guard the frozen `stepMinute` can take as it stands, by darkening the minute's input."""
    taker = P.FEE + P.HALF_SPREAD
    rungs = [{"side": s, "k": k, "mode": "idle", "o": None, "m": 1.0} for s in ("bid", "ask") for k in P.RUNGS]
    trips = []
    lastX = None
    n = B.n
    for i in range(n):
        t = B.t0 + i * M
        x = B.X[i]
        if x:
            lastX = x
        f = None if (dark is not None and dark[i]) else B.F[i]
        m = 1.0 if mult is None else float(mult[i])
        lp_turn = None
        for r in rungs:
            if r["mode"] in ("idle", "quote"):
                o = r["o"]
                off = f is None or (pb is not None and r["side"] == "bid" and pb[i]) or (pa is not None and r["side"] == "ask" and pa[i])
                if off:
                    if r["mode"] == "quote":
                        r["mode"], r["o"] = "idle", None
                    continue
                if r["mode"] == "idle":
                    r["o"] = P.Order(r["side"], P.rt(f, r["k"] * m, r["side"]), f, i + 1); r["mode"] = "quote"; r["m"] = m
                    continue
                if o.state == "rejected":
                    if abs(f / o.fair_at - 1) > P.REPRICE or r["m"] != m:
                        o.price, o.fair_at = P.rt(f, r["k"] * m, r["side"]), f
                        r["m"] = m
                    if lp_turn is None:
                        lp_turn = [B.last_before(t)]
                    if not P.blocks(o.side, o.price, lp_turn[0]):
                        o.live, o.state = i + 1, "pending"
                    continue
                if abs(f / o.fair_at - 1) > P.REPRICE or r["m"] != m:
                    o.price, o.fair_at, o.live, o.state = P.rt(f, r["k"] * m, r["side"]), f, i + 1, "pending"
                    r["m"] = m
            elif r["mode"] == "position":
                o = r["o"]
                xs = "ask" if r["side"] == "bid" else "bid"
                if o is None:
                    if f is not None:
                        r["o"] = P.Order(xs, P.rt_exit(f, r["side"]), f, i + 1)
                elif o.state == "rejected":
                    if f is not None and abs(f / o.fair_at - 1) > P.REPRICE:
                        o.price, o.fair_at = P.rt_exit(f, r["side"]), f
                    if lp_turn is None:
                        lp_turn = [B.last_before(t)]
                    if not P.blocks(o.side, o.price, lp_turn[0]):
                        o.live, o.state = i + 1, "pending"
                elif f is not None and abs(f / o.fair_at - 1) > P.REPRICE:
                    o.price, o.fair_at, o.live, o.state = P.rt_exit(f, r["side"]), f, i + 1, "pending"
        lp_live = None
        for r in rungs:
            o = r["o"]
            if o is not None and o.state == "pending" and o.live == i:
                if lp_live is None:
                    lp_live = [B.last_before(t)]
                o.state = "rejected" if P.blocks(o.side, o.price, lp_live[0]) else "live"
        ps = B.by_min.get(i)
        if ps:
            for ts, q, qty, aggr in ps:
                for r in rungs:
                    o = r["o"]
                    if o is None or o.state != "live":
                        continue
                    if not P.through(o.side, o.price, q, 0):
                        continue
                    if r["mode"] == "quote":
                        if not lastX:
                            continue
                        usd = min(size, 0.10 * B.qvol[i] * lastX)
                        if usd <= 0:
                            continue
                        nq = usd / lastX
                        p = o.price * P.TICK
                        r.update(mode="position", o=None, entry=p, t_e=t, i_e=i, qty=nq / p, nq=nq, fill_ts=ts)
                    elif r["mode"] == "position":
                        P._close(r, trips, B.book, t, o.price * P.TICK, "maker", lastX)
        for r in rungs:
            if r["mode"] == "position" and r["i_e"] != i and (t >= r["t_e"] + stop_min * M or i == n - 1):
                c = B.last_at_or_before(t + M - 1) * P.TICK
                px = c * (1 - taker) if r["side"] == "bid" else c * (1 + taker)
                P._close(r, trips, B.book, t, px, "taker", lastX)
    return trips


def patched(key, B, rungs, touch, fn):
    saved = (P.TICK, P.FEE, P.HALF_SPREAD, P.RUNGS)
    try:
        P.TICK, P.HALF_SPREAD, P.FEE, P.RUNGS = B.meta["tick"], touch, S.taker_of(key), rungs
        return fn()
    finally:
        P.TICK, P.FEE, P.HALF_SPREAD, P.RUNGS = saved


# ------------------------------------------------------------------------------------------------ signals
def signals(B, tick):
    """Per-turn arrays (index i = the turn at the start of minute i, data up to i-1): the guards' up / dn measures, all as fractions."""
    n = B.n
    last = np.full(n, np.nan); hi = np.full(n, np.nan); lo = np.full(n, np.nan)
    for i, ps in B.by_min.items():
        if 0 <= i < n and ps:
            qs = [p[1] for p in ps]
            last[i], hi[i], lo[i] = ps[-1][1] * tick, max(qs) * tick, min(qs) * tick
    F = np.array([f if f else np.nan for f in B.F], dtype=float)
    # lastknown[i]: last print price of the newest minute j < i with prints and i - j <= 3
    lk = np.full(n, np.nan)
    for lag in (3, 2, 1):
        sh = np.full(n, np.nan); sh[lag:] = last[:-lag]
        lk = np.where(np.isnan(sh), lk, sh)            # the nearest (lag 1) is written last, so it wins
    sig = {"F": F, "last": last, "hi": hi, "lo": lo, "lk": lk}
    with np.errstate(all="ignore"):
        dev = lk / F - 1
        sig["g1"] = (np.where(dev > 0, dev, 0.0), np.where(dev < 0, -dev, 0.0))
        for Z in (1, 3):
            hiz = np.full(n, np.nan); loz = np.full(n, np.nan)
            for z in range(1, Z + 1):
                sh_h = np.full(n, np.nan); sh_l = np.full(n, np.nan); sh_h[z:] = hi[:-z]; sh_l[z:] = lo[:-z]
                hiz = np.fmax(hiz, sh_h); loz = np.fmin(loz, sh_l)
            sig[f"g2_{Z}"] = ((lk - loz) / lk, (hiz - lk) / lk)
        for mm in (1, 3):
            sh = np.full(n, np.nan); sh[mm:] = F[:-mm]
            mv = F / sh - 1
            sig[f"g4_{mm}"] = (np.where(mv > 0, mv, 0.0), np.where(mv < 0, -mv, 0.0))
        rng = (hi - lo) / last                                     # the minute's OWN range: look-ahead, for the oracle only
        sig["own_range"] = rng
    return sig


def hold_mask(trig, H):
    """True on a turn that tripped and on the H-1 turns after the last trip."""
    n = len(trig)
    ar = np.arange(n)
    idx = np.where(trig, ar, -10 ** 9)
    return (ar - np.maximum.accumulate(idx)) < H


def pauses(sig, spec, B, events):
    """(pb, pa, mult, stop_min, dark) for a config spec."""
    n = B.n
    fam = spec["fam"]
    pb = pa = mult = dark = None
    stop = 1440
    with np.errstate(all="ignore"):
        if fam in ("g1_dev", "g2_tape", "g4_fair", "wide"):
            key = {"g1_dev": "g1", "wide": "g1", "g2_tape": f"g2_{spec.get('Z')}", "g4_fair": f"g4_{spec.get('m')}"}[fam]
            up, dn = sig[key]
            x = spec["X"] * 1e-4
            tu, td = up > x, dn > x
            if fam == "wide":
                trig = hold_mask(tu | td, spec["H"])
                mult = np.where(trig, spec["w"], 1.0)
            elif spec["mode"] == "side":
                pa, pb = hold_mask(tu, spec["H"]), hold_mask(td, spec["H"])
            else:
                pa = pb = hold_mask(tu | td, spec["H"])
        elif fam == "g3_cal":
            m = np.zeros(n, dtype=bool)
            for e in events:
                if spec["kind"] == "us" and e["kind"] not in ("cpi", "nfp", "fomc"):
                    continue
                if spec["kind"] == "checked" and not e["stands_out"]:
                    continue
                i0 = -((-(e["t"] - spec["a"] * M - B.t0)) // M)       # ceil
                i1 = (e["t"] + spec["b"] * M - B.t0) // M
                if i1 >= 0 and i0 < n:
                    m[max(0, i0):min(n - 1, i1) + 1] = True
            if spec.get("dark"):
                dark = m
            else:
                pa = pb = m
        elif fam == "oracle":
            m = np.nan_to_num(sig["own_range"], nan=0.0) > spec["Y"] * 1e-4
            if spec.get("dark"):
                dark = m
            else:
                pa = pb = m
        elif fam == "g6_stop":
            stop = spec["stop_min"]
    return pb, pa, mult, stop, dark


def cfg_grid():
    c = {"base": {"fam": "base"}}
    for X in (3, 5, 8, 12, 20):
        for H in (2, 5, 10):
            for mode in ("side", "both"):
                c[f"g1_dev X{X} H{H} {mode}"] = {"fam": "g1_dev", "X": X, "H": H, "mode": mode}
    for Z in (1, 3):
        for Y in (5, 10, 20, 40):
            for H in (3, 10):
                for mode in ("side", "both"):
                    c[f"g2_tape Z{Z} Y{Y} H{H} {mode}"] = {"fam": "g2_tape", "Z": Z, "X": Y, "H": H, "mode": mode}
    for mm in (1, 3):
        for X in (3, 5, 10, 20):
            for H in (3, 10):
                c[f"g4_fair m{mm} X{X} H{H} side"] = {"fam": "g4_fair", "m": mm, "X": X, "H": H, "mode": "side"}
    for kind in ("all", "us", "checked"):
        for a in (0, 1, 3):
            for b in (2, 5, 15, 30, 60):
                c[f"g3_cal {kind} a{a} b{b}"] = {"fam": "g3_cal", "kind": kind, "a": a, "b": b}
    for kind in ("all", "us"):
        for a in (0, 1, 3):
            for b in (2, 5, 15, 30, 60):
                c[f"g3d_cal {kind} a{a} b{b}"] = {"fam": "g3_cal", "kind": kind, "a": a, "b": b, "dark": True}
    for stop in (120, 240, 480, 720):
        c[f"g6_stop {stop}"] = {"fam": "g6_stop", "stop_min": stop}
    for X in (5, 10):
        for w in (2, 3):
            c[f"wide X{X} w{w}"] = {"fam": "wide", "X": X, "H": 5, "w": w}
    for Y in (10, 20, 40):
        c[f"oracle Y{Y}"] = {"fam": "oracle", "Y": Y}
    return c


def load_events():
    return json.load(open(os.path.join(ROOT, "inputs", "events.json")))["events"]


# ------------------------------------------------------------------------------------------------ history
def build_shift(key, s):
    """cbk.build with the interbank GBP/USD and EUR/USD read `s` minutes sooner: every observation stamped s minutes earlier."""
    orig = (S.CI.load_fx, S.SI.load_eurusd)
    try:
        def sh(f):
            t, v = f()
            return [a - s * M for a in t], v
        S.CI.load_fx, S.SI.load_eurusd = (lambda: sh(orig[0])), (lambda: sh(orig[1]))
        return cbk.build(key, weekend=False)
    finally:
        S.CI.load_fx, S.SI.load_eurusd = orig


def pack(trips):
    return [(x["t_entry"], x["t_exit"], x["pnl_usd"], x["how"] == "taker") for x in trips]


def task_hist(args):
    key, weekend, shift = args
    touch = json.load(open(os.path.join(S.ROOT, "inputs", "touch.json")))[key]["half_spread"]
    B = build_shift(key, shift) if shift else cbk.build(key, weekend=weekend)
    S.META[key] = B.meta
    tick = B.meta["tick"]
    events = load_events()
    out = {}
    rungs = cbk.GRIDS["base"]
    if shift:
        out[f"g5_fx s{shift}"] = (pack(patched(key, B, rungs, touch, lambda: gsim(B))), {})
        return key, weekend, shift, B.meta["t0"], out
    sig = signals(B, tick)
    ref = patched(key, B, rungs, touch, lambda: P.simulate(B, size=100.0)[0])
    for name, spec in cfg_grid().items():
        pb, pa, mult, stop, dark = pauses(sig, spec, B, events)
        tr = patched(key, B, rungs, touch, lambda: gsim(B, pb=pb, pa=pa, mult=mult, stop_min=stop, dark=dark))
        valid = np.isfinite(sig["F"])
        info = {"paused_bid": float(np.mean(pb[valid])) if pb is not None else 0.0, "paused_ask": float(np.mean(pa[valid])) if pa is not None else 0.0,
                "dark": float(np.mean(dark[valid])) if dark is not None else 0.0}
        if name == "base":
            key_ = lambda z: (z["t_entry"], z["t_exit"], round(z["pnl_usd"], 9), z["how"], z["k"], z["side"])
            assert [key_(a) for a in ref] == [key_(a) for a in tr], f"gsim differs from pr5_sim.simulate on {key}"
            info["equals_pr5_sim"] = len(ref)
        out[name] = (pack(tr), info)
    return key, weekend, shift, B.meta["t0"], out


def span_stats(packs_by_book, span, days_start=None):
    """Totals for the trips EXITING in the span, all four books, and the exit-day series."""
    a, z = span
    days = (z - a) / DAY
    tr = [x for tr_ in packs_by_book for x in tr_ if a <= x[1] < z]
    pnl = sum(x[2] for x in tr)
    byday = collections.Counter()
    for x in tr:
        byday[(x[1] - a) // DAY] += x[2]
    nd = int(round(days))
    series = np.zeros(nd)
    for d, v in byday.items():
        if 0 <= d < nd:
            series[d] = v
    return {"trips": len(tr), "pnl_gbp": pnl, "gbp_per_year": pnl / days * 365, "pct_per_year_on_2400": 100 * pnl / (CAP_GBP * days / 365),
            "stops": sum(1 for x in tr if x[3]), "win_rate": (sum(1 for x in tr if x[2] > 0) / len(tr)) if tr else None,
            "worst_day_gbp": float(series.min()), "days": nd}, series


def boot(series_a, series_b=None, n=2000, seed=20261015):
    """Day-bootstrap, annualised: of the series (5th, 50th, 95th percentile); with series_b, of the paired difference b - a."""
    d = series_a if series_b is None else series_b - series_a
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, len(d), size=(n, len(d)))
    s = np.sort(d[idx].sum(axis=1)) / len(d) * 365
    return {"p5": float(s[int(0.05 * n)]), "p50": float(s[n // 2]), "p95": float(s[int(0.95 * n) - 1]), "share_gt_0": float(np.mean(s > 0))}


def summarise(res_by_cfg, base_name="base"):
    """{cfg: {span: stats, paired bootstrap vs base}} from {cfg: [packs per book]}."""
    out = {}
    base = {sp: span_stats(res_by_cfg[base_name], w) for sp, w in SPANS.items()}
    for cfg, packs in res_by_cfg.items():
        out[cfg] = {}
        for sp, w in SPANS.items():
            st_, ser = span_stats(packs, w)
            b_st, b_ser = base[sp]
            st_["trips_kept"] = st_["trips"] / b_st["trips"] if b_st["trips"] else None
            st_["delta_gbp_per_year"] = st_["gbp_per_year"] - b_st["gbp_per_year"]
            st_["delta_boot"] = boot(b_ser, ser) if cfg != base_name else None
            out[cfg][sp] = st_
    return out


def stage1():
    work = [(k, False, 0) for k in KEYS] + [(k, False, s) for k in KEYS for s in (1, 2)]
    with mp.Pool(4) as pool:
        res = pool.map(task_hist, work, chunksize=1)
    packs, info, t0 = collections.defaultdict(dict), collections.defaultdict(dict), {}
    for key, weekend, shift, t0k, out in res:
        t0[key] = t0k
        for name, (pk, inf) in out.items():
            packs[name][key] = pk
            info[name][key] = inf
    S.META.update({k: {"t0": v} for k, v in t0.items()})
    by_cfg = {name: [packs[name][k] for k in KEYS] for name in packs}
    summ = summarise(by_cfg)
    # the base arm against the screen's own compare.json (12 months, 90 days, since 08-24, 28 days), as cbk.py prints it
    chk = json.load(open(os.path.join(ROOT, "..", "cbpaper", "results", "compare.json")))["venues"]["coinbase"]
    base_check = {}
    for w, t0w in cbk.WINDOWS.items():
        tr = [x for p in by_cfg["base"] for x in p if x[0] >= t0w]
        days = (END - t0w) / DAY
        base_check[w] = {"here": round(sum(x[2] for x in tr) / days * 365, 2), "compare_json": chk[w]["100"]["gbp_per_year"]}
    json.dump({"about": "cbfast.py stage1: every config's trips by exit span, per book summed; deltas are against `base` in the same span (paired day bootstrap)",
               "spans": {k: [S.day_of(a), S.day_of(z)] for k, (a, z) in SPANS.items()}, "capital_gbp_for_pct": CAP_GBP, "base_check_vs_compare_json_by_entry": base_check,
               "paused_share_by_cfg_book": info, "configs": cfg_grid() | {n: {"fam": "g5_fx", "shift_min": int(n.split("s")[-1])} for n in by_cfg if n.startswith("g5_fx")},
               "stats": summ}, open(os.path.join(ROOT, "results", "cbfast_grid.json"), "w"), indent=1, sort_keys=True)
    # compact trips for stage 2 / lit (not committed: large), written next to the scratch
    return summ, base_check


def pick(summ, fam_prefix, sel_span, rep_span):
    """The config of the family with the most P&L on the selection span (ties: first), and its stats on both spans."""
    cands = [(c, v) for c, v in summ.items() if c.startswith(fam_prefix)]
    best = max(cands, key=lambda cv: cv[1][sel_span]["pnl_gbp"])
    return best[0], best[1][sel_span], best[1][rep_span]


def main(stage):
    if stage == "stage1":
        summ, chk = stage1()
        print(json.dumps(chk, indent=1))
        s1, s2 = list(SPANS)
        base = summ["base"]
        print("base", {sp: round(base[sp]["gbp_per_year"], 2) for sp in SPANS})
        for fam in ("g1_dev", "g2_tape", "g4_fair", "g3_cal", "g3d_cal", "g5_fx", "g6_stop", "wide", "oracle"):
            for sel, rep in ((s1, s2), (s2, s1)):
                try:
                    name, a, b = pick(summ, fam, sel, rep)
                except ValueError:
                    continue
                print("%-8s sel %s  %-34s sel d£/yr %+8.2f  rep d£/yr %+8.2f  kept %.3f  boot[p5 %+.1f p95 %+.1f]" % (
                    fam, sel[:6], name, a["delta_gbp_per_year"], b["delta_gbp_per_year"], b["trips_kept"], b["delta_boot"]["p5"] if b["delta_boot"] else 0, b["delta_boot"]["p95"] if b["delta_boot"] else 0))
    else:
        raise SystemExit("only stage1 is run from here; cbfast_events.py and cbfast_lit.py are the later stages")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "stage1")
