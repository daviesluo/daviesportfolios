# MMCOMP-3 (2026-10-30): can today's Revolut X live strategies earn more by learning from the $5,000 maker?
#
# The two strategies as they run today: LIVE (USDT-GBP alone at £600, £100 on each 0.1 / 0.2 / 0.3 % rung a side) and RXU
# (USDC-GBP alone at £120, £30 on each 0.1 / 0.2 % rung a side, the 0.3 % rungs quoting nothing); both exit a tick beyond
# fair and hold a rung from £1. Each change is replayed against them one at a time, then in combination, on the stored
# record 2026-09-26 -> 10-29 00:00 UTC with LIVE's own 813 fill prints taken out (their 8-character id prefixes handed in as
# $MM_LIVE_P8, a file never committed; the full list is sql/live_fill_prints.sql's answer), fills 'at' (LIVE's rule) and
# 'through', split at 10-13 (the maker 5 ticks wide before, 12 from). Paired by UTC day in bps of capital, circular 3-day
# block bootstrap, 10,000 resamples, seed 20261030 (inner_rung2.py's convention).
#
# The executor is PR5-OPT's (`pr5_opt/scripts/sim.py`, imported unchanged: its paper engine and helpers); `run2` below is a
# copy of its `run` with hooks, and with no hook switched on it gives the same trips as `sim.run` (checked first, written to
# the results as `engine_check`). The hooks:
#   inside   an extra slot a side resting `off` ticks from the maker's own order (+1 one tick inside it, 0 joining it, -1 behind
#            it), read from the last fresh book snapshot (stamped at or before the turn, seen within 75 s), only while that is
#            at least `k_bps` from fair and does not cross the touch; nothing while the maker is not seen. The maker's order is
#            the best level of 4,999.5-5,010.5 coins in one order, or a level of several orders holding 4,999.5-6,000 coins
#            (maker_pnl.py's 'sure' and 'shared').
#   exit     'rule' (today: fair and one tick), 'maker' (one tick inside the maker's other side, never nearer fair than the
#            rule), 'mirror' (the rung's own distance on the other side, never nearer than the rule): the full-spread capture.
#   cbpull   (w bps, look-back ms): no new bid while Coinbase's mid has fallen w bps or more over the look-back, no ask while
#            it has risen as much (Coinbase's record starts 2026-10-10; before it the gate passes).
# Counted on the way: placements a UTC day (the executor's governor withdraws entries at 900), the share of turns with every
# bid (or every ask) slot holding, the worst day.
#   MM_LIVE_P8=<file> python3 -I docs/agents/backtests/mmcomp/scripts/inside.py  -> results/inside.json
import bisect, collections, gzip, json, math, os, random, statistics as st, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
BT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.dont_write_bytecode = True
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(BT, "fair_price", "scripts"))
sys.path.insert(0, os.path.join(BT, "pr5_opt", "scripts"))
import fp_data as D
import sim
import load as LD
from sim import TICK, FEE, HALF, MIN_GBP, DAY, M, H, et, qt, blocks, through, at_fill

OUT = os.path.join(HERE, "..", "results", "inside.json")
SEED, NB, BLOCK = 20261030, 10000, 3
FWD = (D.ms(2026, 9, 26), D.END); SPLIT = D.ms(2026, 10, 13); CB_FROM = D.ms(2026, 10, 10)
FRESH = 75_000


class Ref:
    """One book's snapshots as-of readable: the maker's bid and ask, and the touch, in ticks."""

    def __init__(self, bk):
        seen = LD.book_seen(bk)
        self.t, self.u, self.mb, self.ma, self.bb, self.ba = [], [], [], [], [], []
        widths = collections.defaultdict(list)
        for t, bids, asks in LD.book(bk):
            self.t.append(t); self.u.append(max(seen.get(t, t), t))
            mb, ma = self.maker(bids), self.maker(asks)
            self.mb.append(mb); self.ma.append(ma)
            self.bb.append(round(bids[0][0] / TICK) if bids else None); self.ba.append(round(asks[0][0] / TICK) if asks else None)
            if mb is not None and ma is not None: widths[D.day(t)].append(ma - mb)
        self.widths = {d: LD.median(v) for d, v in sorted(widths.items())}

    @staticmethod
    def maker(levels):
        for p, q, n in levels:
            if (n == 1 and 4999.5 <= q <= 5010.5) or ((n or 0) > 1 and 4999.5 <= q <= 6000): return round(p / TICK)
        return None

    def at(self, T):
        i = bisect.bisect_right(self.t, T) - 1
        if i < 0 or T > self.u[i] + FRESH: return None
        return i


class Cb:
    """Coinbase's mid for one book (cb_touch, and the level recorder's 30-second touch from mmcomp/data), as-of readable."""

    def __init__(self, bk):
        rows = [(c[0], (c[1] + c[2]) / 2) for c in LD.cb(bk) if c[2] > c[1] > 0]
        for line in gzip.open(os.path.join(HERE, "..", "data", f"cb30_{bk}.txt.gz"), "rt"):
            f = line.strip().split("|")
            if len(f) == 5 and float(f[2]) > float(f[1]) > 0: rows.append((int(f[0]), (float(f[1]) + float(f[2])) * 0.5e-4))
        rows.sort()
        self.t = [r[0] for r in rows]; self.m = [r[1] for r in rows]

    def at(self, T):
        i = bisect.bisect_right(self.t, T) - 1
        if i < 0 or T - self.t[i] > 120_000: return None
        return self.m[i]


def run2(mins, prints, t_from, t_to, ref=None, cbs=None, inside=None, exit_mode="rule", cbpull=None, stats=None, cap_limit=None, **kw):
    """sim.run with the hooks above. `inside` = dict(k_bps, off, gbp[, min_width]); `stats` (a dict) receives the counts."""
    c = dict(sim.DEFAULTS); c.update(kw)
    if c["exit_reprice"] is None: c["exit_reprice"] = c["reprice"]
    size = c["size"] if c["size"] is not None else sim.equal_size(c["capital"], c["rungs"])
    size = dict(size)
    if inside:
        for b in mins:
            for s in ("bid", "ask"): size[(b, s, "in")] = inside["gbp"]
    retired = set(c["retired"])
    off = c["off_s"] * 1000
    trips = []
    orders = collections.Counter()      # (book, day) -> placements
    full = collections.Counter()        # 'turns', 'bid', 'ask'
    for b in sim.BOOKS:
        if b not in mins: continue
        pap = sim.Paper(b, c)
        R = ref[b] if ref else None
        CB = cbs.get(b) if cbs else None
        keys = [(r["side"], r["k"]) for r in pap.R] + ([("bid", "in"), ("ask", "in")] if inside else [])
        L = {key: {"side": key[0], "k": key[1], "held": 0.0, "cash": 0.0, "opened": None, "gbp": 0.0, "inpos": False,
                   "entry": None, "exit": None} for key in keys}
        quoted = {s: [key for key in keys if key[0] == s and size.get((b, s, key[1]), 0.0) >= 0.1 and (b, s, key[1]) not in retired]
                  for s in ("bid", "ask")}
        P = prints[b]; pi = 0
        lastp = None
        lastpx = None

        def live_orders():
            out = []
            for r in L.values():
                if r["entry"] is not None: out.append((r, r["entry"], "entry"))
                if r["exit"] is not None: out.append((r, r["exit"], "exit"))
            return out

        def apply_print(p):
            nonlocal lastp, lastpx
            ts, pt, q, aggr = p[0], p[1], p[2], p[3]
            cand = []
            for r, o, leg in live_orders():
                if o["live"] > ts or o["qty"] <= 1e-12: continue
                if through(o["side"], o["ticks"], pt): share = 1.0
                elif c["fill"] == "at" and at_fill(o["side"], o["ticks"], pt, aggr): share = c["at_share"]
                else: continue
                cand.append((r, o, leg, share))
            if cand:
                cand.sort(key=lambda z: (-z[1]["ticks"] if z[1]["side"] == "bid" else z[1]["ticks"], z[1]["live"]))
                used = used_at = 0.0
                for r, o, leg, share in cand:
                    avail = (q - used) if share == 1.0 else min(q - used, q * share - used_at)
                    if avail <= 1e-12: continue
                    take = min(o["qty"], avail)
                    used += take
                    if share != 1.0: used_at += take
                    o["qty"] -= take
                    px = o["ticks"] * TICK
                    sgn = 1 if o["side"] == "bid" else -1
                    pos_sgn = 1 if r["side"] == "bid" else -1
                    if leg == "entry":
                        r["held"] += take; r["cash"] -= sgn * take * px; r["gbp"] += take * px
                        if not r["inpos"] and r["held"] * px > c["hold_min_gbp"] + 1e-9:
                            r["inpos"] = True; r["opened"] = ts
                    else:
                        r["held"] -= take; r["cash"] -= sgn * take * px
                        if r["exit"] is not None: r["exit"]["qty"] = max(0.0, min(r["exit"]["qty"], r["held"]))
                        if r["held"] * px <= MIN_GBP + 1e-9:
                            pnl = r["cash"] + pos_sgn * r["held"] * px
                            trips.append({"book": b, "side": r["side"], "k": r["k"], "tEntry": r["opened"], "tExit": ts, "pnl": pnl,
                                          "gbp": r["gbp"], "how": "maker"})
                            r.update(held=0.0, cash=0.0, opened=None, gbp=0.0, exit=None, entry=None, inpos=False)
            lastp = (pt, aggr); lastpx = pt * TICK

        def turn(T):
            f = pap.f
            dk = (b, D.day(T))
            ri = R.at(T) if R is not None else None
            mk_b = R.mb[ri] if ri is not None else None
            mk_a = R.ma[ri] if ri is not None else None
            pull = {"bid": False, "ask": False}
            if cbpull and CB is not None:
                m1, m0 = CB.at(T), CB.at(T - cbpull[1])
                if m1 and m0:
                    d = 1e4 * math.log(m1 / m0)
                    pull["bid"] = d <= -cbpull[0]; pull["ask"] = d >= cbpull[0]
            net = 0
            if c["skew"]:
                net = sum((1 if r["side"] == "bid" else -1) for r in L.values() if r["inpos"])
            pr = {(r["side"], r["k"]): r for r in pap.R}
            for key, r in L.items():
                if r["inpos"]:
                    r["entry"] = None
                    if c["stop_ms"] is not None and T - r["opened"] >= c["stop_ms"] and lastpx:
                        px = lastpx * (1 - FEE - HALF) if r["side"] == "bid" else lastpx * (1 + FEE + HALF)
                        pos_sgn = 1 if r["side"] == "bid" else -1
                        pnl = r["cash"] + pos_sgn * r["held"] * px
                        trips.append({"book": b, "side": r["side"], "k": r["k"], "tEntry": r["opened"], "tExit": T, "pnl": pnl, "gbp": r["gbp"], "how": "taker"})
                        r.update(held=0.0, cash=0.0, opened=None, gbp=0.0, exit=None, inpos=False)
                        orders[dk] += 1
                        continue
                    if f is None: continue
                    xs = "ask" if r["side"] == "bid" else "bid"
                    offt = c["exit_off"]
                    if c["exit_after"] and T - r["opened"] >= c["exit_after"][0] * H: offt = offt - c["exit_after"][1]
                    want = et(f, r["side"], offt)
                    if exit_mode != "rule":
                        if exit_mode == "maker" or r["k"] == "in":
                            if r["side"] == "bid" and mk_a is not None: want = max(want, mk_a - 1)
                            if r["side"] == "ask" and mk_b is not None: want = min(want, mk_b + 1)
                        elif exit_mode == "mirror":
                            want = max(want, qt(f, r["k"], "ask")) if r["side"] == "bid" else min(want, qt(f, r["k"], "bid"))
                        o = r["exit"]
                        if o is not None and o["ticks"] == want: continue
                        if blocks(xs, want, lastp):
                            r["exit"] = None
                            continue
                        r["exit"] = {"side": xs, "ticks": want, "qty": r["held"], "live": T, "fair": f, "off": offt}
                        orders[dk] += 1
                        continue
                    o = r["exit"]
                    if o is None or o.get("off") != offt or abs(f / o["fair"] - 1) > c["exit_reprice"]:
                        if o is not None and o["ticks"] == want and o.get("off") == offt:
                            o["fair"] = f
                            continue
                        if blocks(xs, want, lastp):
                            r["exit"] = None
                            continue
                        r["exit"] = {"side": xs, "ticks": want, "qty": r["held"], "live": T, "fair": f, "off": offt}
                        orders[dk] += 1
                    continue
                r["exit"] = None
                tgt = None
                if r["k"] == "in":
                    wide_ok = inside.get("min_width") is None or (mk_a is not None and mk_b is not None and mk_a - mk_b >= inside["min_width"])
                    stands_for = inside.get("stands_for")      # the rung whose pounds it uses: no entry while that rung holds
                    if stands_for is not None and L[(r["side"], stands_for)]["inpos"]: wide_ok = False
                    if f is not None and ri is not None and wide_ok:
                        kb = inside["k_bps"] * 1e-4
                        if r["side"] == "bid" and mk_b is not None:
                            tgt = mk_b + inside["off"]
                            if (R.ba[ri] is not None and tgt >= R.ba[ri]) or tgt > math.floor(f * (1 - kb) / TICK + 1e-9): tgt = None
                        if r["side"] == "ask" and mk_a is not None:
                            tgt = mk_a - inside["off"]
                            if (R.bb[ri] is not None and tgt <= R.bb[ri]) or tgt < math.ceil(f * (1 + kb) / TICK - 1e-9): tgt = None
                else:
                    p = pr[key]
                    if p["mode"] == "quote" and p["o"] is not None and p["o"]["state"] != "rejected" and f is not None:
                        tgt = p["o"]["ticks"]
                if tgt is not None and inside and inside.get("stands_for") == r["k"]:
                    sl = L[(r["side"], "in")]
                    if sl["inpos"] or sl["entry"] is not None: tgt = None    # its pounds are the inside slot's just now
                if tgt is not None and (b, r["side"], r["k"]) in retired: tgt = None
                if tgt is not None and c["gate"] is not None and not c["gate"](T, b, r["side"], r["k"]): tgt = None
                if tgt is not None and pull[r["side"]]: tgt = None
                if tgt is not None and lastpx is not None and abs(lastpx / f - 1) > c["depeg"]: tgt = None
                gbp = size.get((b, r["side"], r["k"]), 0.0)
                if tgt is not None and gbp < 0.1: tgt = None
                if tgt is not None and c["skew"] and net:
                    bps, cap_units = c["skew"]
                    units = max(-cap_units, min(cap_units, net))
                    shift = round(units * bps * 1e-4 * f / TICK)
                    tgt = tgt - shift
                    if r["side"] == "ask" and tgt <= et(f, "bid"): tgt = et(f, "bid") + 1
                    if r["side"] == "bid" and tgt >= et(f, "ask"): tgt = et(f, "ask") - 1
                if tgt is None:
                    r["entry"] = None
                    continue
                e = r["entry"]
                if e is not None and e["ticks"] == tgt: continue
                if blocks(r["side"], tgt, lastp):
                    r["entry"] = None
                    continue
                r["entry"] = {"side": r["side"], "ticks": tgt, "qty": gbp / (tgt * TICK), "live": T}
                orders[dk] += 1
            full["turns"] += 1
            for s in ("bid", "ask"):
                if quoted[s] and all(L[key]["inpos"] for key in quoted[s]): full[s] += 1
            # pounds committed (an entry resting or a rung holding) over the strategy's capital: the wide-only slot can rest
            # while the outer rung it stands in for still holds from before
            if cap_limit is not None:
                out_ = sum(size.get((b, r["side"], r["k"]), 0.0) for r in L.values() if r["inpos"] or r["entry"] is not None)
                if out_ > cap_limit + 1e-6: full["over_cap"] += 1

        for (t, x0, fu) in mins[b]:
            if t >= t_to: break
            mp = []
            while pi < len(P) and P[pi][0] < t + M:
                if P[pi][0] >= t: mp.append(P[pi])
                pi += 1
            if t >= t_from:
                T = t + off
                for p in mp:
                    if p[0] < T: apply_print(p)
                turn(T)
                for p in mp:
                    if p[0] >= T: apply_print(p)
            else:
                if mp: lastp = (mp[-1][1], mp[-1][3]); lastpx = mp[-1][1] * TICK
            pap.step(t, x0, fu, mp)
        for r in L.values():
            if r["held"] * (lastpx or 0) > MIN_GBP and lastpx:
                pos_sgn = 1 if r["side"] == "bid" else -1
                trips.append({"book": b, "side": r["side"], "k": r["k"], "tEntry": r["opened"], "tExit": t_to, "pnl": r["cash"] + pos_sgn * r["held"] * lastpx,
                              "gbp": r["gbp"], "how": "open"})
    if stats is not None:
        per = collections.defaultdict(list)
        for (bk, d), n in orders.items(): per[bk].append(n)
        stats["orders_day_mean"] = {bk: round(st.fmean(v), 1) for bk, v in per.items()}
        stats["orders_day_max"] = {bk: max(v) for bk, v in per.items()}
        stats["orders_days_over_900"] = {bk: sum(1 for x in v if x > 900) for bk, v in per.items()}
        stats["side_full_share"] = {s: round(full[s] / max(1, full["turns"]), 4) for s in ("bid", "ask")}
        stats["over_capital_share"] = round(full["over_cap"] / max(1, full["turns"]), 4)
    cap = sum(v for k, v in size.items() if k[0] in mins and (k[0], k[1], k[2]) not in retired)
    return trips, cap


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


def summary(trips, cap, t0, t1, maker_gbp_day=None):
    d = daily(trips, t0, t1); n = len(d)
    v = [x / cap * 1e4 for x in d.values()]
    keys = list(d)
    h1 = [x for k, x in zip(keys, v) if k < SPLIT]; h2 = [x for k, x in zip(keys, v) if k >= SPLIT]
    done = [tr for tr in trips if tr["how"] != "open"]
    g = sum(tr["gbp"] for tr in done)
    o = {"capital": round(cap, 2), "gbp_day": round(sum(d.values()) / n, 4), "bps_cap_day": round(st.fmean(v), 3),
         "pct_year": round(st.fmean(v) * 365 / 100, 2),
         "bps_cap_day_before_10_13": round(st.fmean(h1), 3) if h1 else None, "bps_cap_day_from_10_13": round(st.fmean(h2), 3) if h2 else None,
         "trips_day": round(len(done) / n, 2), "bps_trip": round(1e4 * sum(tr["pnl"] for tr in done) / g, 2) if g else None,
         "taker_stops": sum(1 for tr in trips if tr["how"] == "taker"), "open_at_end": sum(1 for tr in trips if tr["how"] == "open"),
         "worst_day_bps_cap": round(min(v), 1), "days_under_minus_1pct": sum(1 for x in v if x <= -100)}
    by_k = collections.defaultdict(float)
    for tr in trips: by_k[str(tr["k"])] += tr["pnl"]
    o["bps_cap_day_by_rung"] = {k: round(x / n / cap * 1e4, 3) for k, x in sorted(by_k.items())}
    ins = [tr for tr in done if tr["k"] == "in"]
    if ins:
        gi = sum(tr["gbp"] for tr in ins)
        o["inside_trips_day"] = round(len(ins) / n, 2); o["inside_bps_trip"] = round(1e4 * sum(tr["pnl"] for tr in ins) / gi, 2)
        if maker_gbp_day: o["inside_entry_gbp_share_of_maker"] = round(gi / n / maker_gbp_day, 4)
    return o, v, keys


def paired(vb, vv, keys):
    diff = [b - a for a, b in zip(vb, vv)]
    h1 = [x for k, x in zip(keys, diff) if k < SPLIT]; h2 = [x for k, x in zip(keys, diff) if k >= SPLIT]
    return {"diff": round(st.fmean(diff), 3), "boot": boot(diff), "before_10_13": round(st.fmean(h1), 3), "boot_before": boot(h1),
            "from_10_13": round(st.fmean(h2), 3), "boot_from": boot(h2), "days_ahead": sum(1 for x in diff if x > 1e-9),
            "days_behind": sum(1 for x in diff if x < -1e-9)}


# ---------------------------------------------------------------------------------------------------------------------
p8 = open(os.environ["MM_LIVE_P8"]).read().strip()
ids8 = {p8[i:i + 8] for i in range(0, len(p8), 8)}
mins = D.load_minutes(); prints = D.load_prints()
mins3 = {b: [(t, x, fu) for (t, x, fu, lag) in v] for b, v in mins.items()}
clean = {b: [p for p in v if p[4][:8] not in ids8] for b, v in prints.items()}
res = {"window": "2026-09-26 -> 2026-10-29 00:00 UTC", "live_prints_removed": {b: len(prints[b]) - len(clean[b]) for b in prints}, "runs": {}}
print(res["live_prints_removed"], flush=True)
ref = {b: Ref(b) for b in sim.BOOKS}
cbs = {b: Cb(b) for b in sim.BOOKS}
res["maker_width_ticks_median_by_day"] = {b: ref[b].widths for b in sim.BOOKS}
MAKER_GBP_DAY = {b: v["sure"]["gbp_per_day"] for b, v in json.load(open(os.path.join(HERE, "..", "results", "maker_pnl.json"))).items() if b in sim.BOOKS}

R3, R2 = (0.001, 0.002, 0.003), (0.001, 0.002)
STRATS = {
    # name: (book, capital, rungs quoted, rungs of the paper engine, retired)
    "LIVE": ("USDT-GBP", 600.0, R3),
    "RXU": ("USDC-GBP", 120.0, R2),
}


def ladder(book, rungs, per):
    return {(book, s, k): per for s in ("bid", "ask") for k in rungs}


def variants(book, cap, rungs):
    """name -> run2 keywords. Every one keeps the capital; `base` is today's rule."""
    n = len(rungs)
    base = dict(size=ladder(book, rungs, cap / (2 * n)), retired=tuple((book, s, 0.003) for s in ("bid", "ask")) if n == 2 else ())
    V = collections.OrderedDict()
    V["base"] = dict(base)
    # the inside slot, alongside today's rungs (the capital a side over n + 1 orders) or in place of them
    for kb in (2, 4, 6):
        V[f"in{kb}_along"] = dict(base, size=ladder(book, rungs, cap / (2 * (n + 1))), inside=dict(k_bps=kb, off=1, gbp=cap / (2 * (n + 1))))
        V[f"in{kb}_replace"] = dict(base, size={}, inside=dict(k_bps=kb, off=1, gbp=cap / 2))
        V[f"in{kb}_replace_xmaker"] = dict(base, size={}, inside=dict(k_bps=kb, off=1, gbp=cap / 2), exit_mode="maker")
    # the inside slot in place of the outermost rung (the pounds per order unchanged), always, or only while the maker quotes
    # 10 ticks wide or more (its 12-tick regime, 10-13 -> 10-28), when the outer rung stands aside and the slot takes its pounds
    outer = rungs[-1]
    wide = lambda T, b: (lambda i: i is not None and ref[b].ma[i] is not None and ref[b].mb[i] is not None and ref[b].ma[i] - ref[b].mb[i] >= 10)(ref[b].at(T))
    for kb in (2, 4):
        V[f"in{kb}_swap"] = dict(base, size=ladder(book, rungs[:-1], cap / (2 * n)), inside=dict(k_bps=kb, off=1, gbp=cap / (2 * n)))
        V[f"in{kb}_wideswap"] = dict(base, inside=dict(k_bps=kb, off=1, gbp=cap / (2 * n), min_width=10, stands_for=outer),
                                     gate=lambda T, b, s, k: not (k == outer and wide(T, b)))
    # a. the full spread: today's rungs exit at their own distance on the other side, or one tick inside the maker's other side
    V["a_exit_mirror"] = dict(base, exit_mode="mirror")
    V["a_exit_maker"] = dict(base, exit_mode="maker")
    # b. distance from fair: one rung a side holding the side's whole capital, at k from fair; or at the maker (+1 inside, 0 join, -1 behind)
    for k in (0.0005, 0.0008, 0.001, 0.0015, 0.002):
        V[f"b_one_rung_{k * 100:g}pct"] = dict(base, rungs=(k,), size=ladder(book, (k,), cap / 2), retired=())
    for off in (1, 0, -1):
        V[f"b_maker{off:+d}_replace"] = dict(base, size={}, inside=dict(k_bps=2, off=off, gbp=cap / 2))
    # c. inventory skew: each held rung moves the book's entries away from the side it holds, at most three rungs
    for bp in (1, 2, 4):
        V[f"c_skew{bp}bp"] = dict(base, skew=(bp, 3))
    # d. faster re-pricing: the paper's entries and the executor's exits re-price on any 0.01 % move instead of 0.05 %
    V["d_reprice_0.01pct"] = dict(base, reprice=0.0001)
    # e. size per order: today's ladder against one order a side at the inner rung (the same capital)
    V["e_one_order_0.1pct"] = dict(base, rungs=(0.001,), size=ladder(book, (0.001,), cap / 2), retired=())
    # f. Coinbase: no new entry on the side Coinbase's mid has just moved against
    for w in (1, 2, 3):
        V[f"f_cbpull{w}bp_60s"] = dict(base, cbpull=(w, 60_000))
    V["f_cbpull2bp_300s"] = dict(base, cbpull=(2, 300_000))
    # the combination the single changes point to: the inside slot while the maker is wide, with the 1 bp skew
    V["combo_in2_wideswap_skew1"] = dict(V["in2_wideswap"], skew=(1, 3))
    return V


t_start = time.time()
# the engine check: run2 with no hook is sim.run
for name, (book, cap, rungs) in STRATS.items():
    m = {book: mins3[book]}
    kw = variants(book, cap, rungs)["base"]
    a, _ = sim.run(m, clean, FWD[0], FWD[1], exit_off=1, hold_min_gbp=1.0, fill="at", **kw)
    b2, _ = run2(m, clean, FWD[0], FWD[1], exit_off=1, hold_min_gbp=1.0, fill="at", **kw)
    same = len(a) == len(b2) and all(abs(x["pnl"] - y["pnl"]) < 1e-9 and x["tExit"] == y["tExit"] for x, y in zip(a, b2))
    res.setdefault("engine_check", {})[name] = {"sim_run_trips": len(a), "run2_trips": len(b2), "identical": same}
    print("engine check", name, same, len(a), len(b2), flush=True)
    assert same

for name, (book, cap, rungs) in STRATS.items():
    m = {book: mins3[book]}
    V = variants(book, cap, rungs)
    for fill in ("at", "through"):
        base_v = None
        for vn, kw in V.items():
            stt = {}
            tr, capv = run2(m, clean, FWD[0], FWD[1], ref=ref, cbs=cbs, stats=stt, cap_limit=cap, exit_off=1, hold_min_gbp=1.0, fill=fill, **kw)
            o, v, keys = summary(tr, cap, *FWD, maker_gbp_day=MAKER_GBP_DAY[book])
            o.update(stt)
            if vn == "base": base_v = v
            else: o["vs_base"] = paired(base_v, v, keys)
            if vn.startswith("f_"):
                ks = [i for i, k in enumerate(keys) if k >= CB_FROM]
                o["vs_base_from_10_10"] = paired([base_v[i] for i in ks], [v[i] for i in ks], [keys[i] for i in ks])
            res["runs"][f"{name}|{fill}|{vn}"] = o
            print(name, fill, vn, o["bps_cap_day"], o.get("vs_base", {}).get("diff"), o.get("vs_base", {}).get("boot"), round(time.time() - t_start), flush=True)
json.dump(res, open(OUT, "w"), indent=1, sort_keys=True)
