# LOTS (2026-10-30): more than one lot a rung. Davies, 2026-10-30 ~04:30 UTC: "既然影响我们收益最大的因素是等待，目前我们每档只有
# 一个lot，如果我们每档多做几个呢？或者设计下每档多少个？会不会提升收益？你也仔细深度研究下，在live的这三个策略上，也可以挑一些你觉得有代表
# 性的testing策略".
#
# Today a rung holds ONE lot: once its entry fills it quotes no entry until that lot's exit fills (the waiting MAKER-ABSENT
# found binding: LIVE's bids all held on 31 % of the minutes the other maker was away). Here a rung holds up to K lots: each
# lot is a slot of its own with its own entry fill, its own exit (fair and the rule's offset, re-priced as today's) and its
# own 24-hour stop; while some lots wait for their exits another rests the rung's entry at the rung's price.
#
# The engine is run2.py's executor (PR5-OPT's, LIVE's rules) with each rung split into lots; with K = 1 it gives sim.run's
# trips exactly (checked first). Designs, at the strategy's capital unless named otherwise:
#   seq K      K lots of rung/K pounds; one free lot rests the rung's entry at a time (the next once it holds)
#   all K      K lots of rung/K; every free lot rests (the rung's free pounds in K pieces at one price)
#   pool       lots of rung/2, up to 4 a rung, while the side's pounds committed (held or resting) stay within half the
#              capital: a busy rung borrows what an idle one does not use
#   cap×2      today's one lot a rung at twice the pounds (more capital), against seq 2 of full rungs (more lots, the same
#              doubled capital): whether "more capital" and "more lots" are one lever
# Counted: orders a UTC day (each lot's own exit; and `agg`, a rung's lots re-priced in the same turn to the same price as
# one order), the share of turns a side had no lot free to quote, the most pounds held a side, the worst day, and each
# trip's markout (the book's mid 5, 30 and 60 minutes after its first fill against its entry price, in its favour) by how
# many lots of its rung were already held when it filled (0 = the first lot).
#
# Strategies (LIVE's rules where not said): LIVE (USDT-GBP £600, 0.1/0.2/0.3 % at £100), RX USDC/GBP (USDC-GBP £120, 0.1/0.2 %
# at £30), Coinbase LIVE (USDC-GBP on Coinbase's own prints, £120, £20 a rung, exits at fair: PR5's rule on Coinbase's
# recorded prints with fair = 1 / GBP-USD, Yahoo's minute bar held through closures; no Revolut X nudge, no release
# blackout; 2026-10-10 -> 10-29), and two TESTING arms: variant-1 `live1200` (LIVE's rules at £1,200, the next size: more
# capital done the other way) and variant-4 `n600usdt` (both books 1:1, £50 rungs: does stacking help where the capital is
# spread thin). The Revolut X record is MAKER-ABSENT's (to 2026-10-30 03:00, LIVE's own prints taken out, $MM_LIVE_P8 as
# absent.py); paired by UTC day in bps of capital, circular 3-day blocks, 10,000 resamples, seed 20261030; halves at 10-13;
# the maker there or away by the watch's history (results/maker_history.json), paired by absence window.
#   MM_LIVE_P8=<file>:<file> python3 -I docs/agents/backtests/mmcomp/scripts/lots.py   -> results/lots.json
import bisect, collections, gzip, json, os, random, statistics as st, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True
sys.path.insert(0, HERE)
from run2 import D, sim, LD, DAY, M, H, TICK, FEE, HALF, MIN_GBP, et, blocks, through, at_fill, daily, boot
import fp_data

OUT = os.path.join(HERE, "..", "results", "lots.json")
DATA = os.path.join(HERE, "..", "data")
FP = os.path.join(HERE, "..", "..", "fair_price", "data")
T0, T1 = D.ms(2026, 9, 26), D.ms(2026, 10, 30, 3)
CB0, CB1 = D.ms(2026, 10, 10), D.ms(2026, 10, 29)
SPLIT = D.ms(2026, 10, 13)
SEED, NB = 20261030, 10000
MARK_H = (5, 30, 60)


def run_lots(mins, prints, t_from, t_to, K=1, mode="seq", lot_mul=1.0, pool=None, pool_kmax=4, mid_at=None, stats=None, on_turn=None, **kw):
    """`size` (a rung's pounds) is split into K lots of size/K × lot_mul. `pool`: lots of half a rung, up to `pool_kmax` a rung,
    while a side of the book commits no more than its rungs' pounds together."""
    c = dict(sim.DEFAULTS); c.update(kw)
    if c["exit_reprice"] is None: c["exit_reprice"] = c["reprice"]
    rung_gbp = dict(c["size"])
    retired = set(c["retired"])
    off = c["off_s"] * 1000
    trips = []
    orders, orders_agg = collections.Counter(), collections.Counter()
    blocked = collections.Counter()
    held_max = collections.Counter()
    nlots = pool_kmax if pool else K
    for b in mins:
        pap = sim.Paper(b, c)
        L = {}
        for r in pap.R:
            g = rung_gbp.get((b, r["side"], r["k"]), 0.0)
            if g < 0.1 or (b, r["side"], r["k"]) in retired: continue
            lot = (g / 2 if pool else g / K) * lot_mul
            for j in range(nlots):
                L[(r["side"], r["k"], j)] = {"side": r["side"], "k": r["k"], "j": j, "lot": lot, "held": 0.0, "cash": 0.0, "opened": None,
                                             "gbp": 0.0, "qin": 0.0, "inpos": False, "entry": None, "exit": None, "rank": 0, "px0": None}
        # the pool: a side of the book may commit what its rungs are given, in any rung
        side_cap = {s_: sum(g for (bb, ss, kk), g in rung_gbp.items() if bb == b and ss == s_ and (bb, ss, kk) not in retired) for s_ in ("bid", "ask")}
        P = prints[b]; pi = 0
        lastp = None; lastpx = None

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
                        if r["px0"] is None: r["px0"] = (ts, px)
                        r["held"] += take; r["cash"] -= sgn * take * px; r["gbp"] += take * px; r["qin"] += take
                        if not r["inpos"] and r["held"] * px > c["hold_min_gbp"] + 1e-9:
                            r["inpos"] = True; r["opened"] = ts
                            r["rank"] = sum(1 for x in L.values() if x is not r and x["side"] == r["side"] and x["k"] == r["k"] and x["inpos"])
                    else:
                        r["held"] -= take; r["cash"] -= sgn * take * px
                        if r["exit"] is not None: r["exit"]["qty"] = max(0.0, min(r["exit"]["qty"], r["held"]))
                        if r["held"] * px <= MIN_GBP + 1e-9:
                            close(r, ts, r["cash"] + pos_sgn * r["held"] * px, "maker")
            lastp = (pt, aggr); lastpx = pt * TICK

        def close(r, ts, pnl, how):
            t0, p0 = r["px0"] if r["px0"] else (r["opened"], None)
            entry = r["gbp"] / r["qin"] if r["qin"] > 0 else p0
            mk = {}
            if mid_at and entry:
                for h in MARK_H:
                    m1 = mid_at(b, r["opened"] + h * M)
                    v = (1e4 * (m1 / entry - 1) * (1 if r["side"] == "bid" else -1)) if m1 else None
                    # a mid more than 50 bps off is an emptied book, not a price (maker_pnl.py's rule): left out
                    mk[h] = v if v is not None and abs(v) <= 50 else None
            trips.append({"book": b, "side": r["side"], "k": r["k"], "j": r["j"], "rank": r["rank"], "tEntry": r["opened"], "tExit": ts,
                          "pnl": pnl, "gbp": r["gbp"], "how": how, "mk": mk, "lot": r["lot"]})
            r.update(held=0.0, cash=0.0, opened=None, gbp=0.0, qin=0.0, exit=None, entry=None, inpos=False, rank=0, px0=None)

        def committed(side):
            return sum(r["lot"] for r in L.values() if r["side"] == side and (r["inpos"] or r["entry"] is not None or r["held"] > 0))

        def turn(T):
            f = pap.f
            dk = (b, D.day(T))
            pr = {(r["side"], r["k"]): r for r in pap.R}
            ex_this = set()                   # (side, k, ticks) exits placed this turn: one order when aggregated
            stopped = set()                   # lots closed by the 24-hour stop this turn rest no entry before the next (as sim.run)
            for key, r in L.items():
                if not r["inpos"]: continue
                r["entry"] = None
                if c["stop_ms"] is not None and T - r["opened"] >= c["stop_ms"] and lastpx:
                    px = lastpx * (1 - FEE - HALF) if r["side"] == "bid" else lastpx * (1 + FEE + HALF)
                    pos_sgn = 1 if r["side"] == "bid" else -1
                    close(r, T, r["cash"] + pos_sgn * r["held"] * px, "taker")
                    orders[dk] += 1; orders_agg[dk] += 1
                    stopped.add(key)
                    continue
                if f is None: continue
                xs = "ask" if r["side"] == "bid" else "bid"
                offt = c["exit_off"]
                want = et(f, r["side"], offt)
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
                    if (r["side"], r["k"], want) not in ex_this: orders_agg[dk] += 1; ex_this.add((r["side"], r["k"], want))
            # entries, rung by rung (inner first), lot by lot
            for (side, k) in sorted({(r["side"], r["k"]) for r in L.values()}, key=lambda z: (z[0], z[1])):
                lots = [L[(side, k, j)] for j in range(nlots)]
                p = pr[(side, k)]
                tgt = None
                if p["mode"] == "quote" and p["o"] is not None and p["o"]["state"] != "rejected" and f is not None: tgt = p["o"]["ticks"]
                if tgt is not None and c["gate"] is not None and not c["gate"](T, b, side, k): tgt = None
                if tgt is not None and lastpx is not None and abs(lastpx / f - 1) > c["depeg"]: tgt = None
                free = [r for r in lots if not r["inpos"] and (r["side"], r["k"], r["j"]) not in stopped]
                for r in lots:
                    if not r["inpos"]: r["exit"] = None
                if mode == "seq":
                    # the lowest free lot that has begun filling keeps the rung's entry; else the lowest free lot
                    resting = [r for r in free if r["held"] > 0] or free[:1]
                    want = set(id(r) for r in resting[:1])
                else:
                    want = set(id(r) for r in free)
                for r in free:
                    t = tgt if id(r) in want else None
                    if t is not None and pool and r["entry"] is None and committed(side) + r["lot"] > side_cap[side] + 1e-9: t = None
                    if t is None:
                        r["entry"] = None
                        continue
                    e = r["entry"]
                    if e is not None and e["ticks"] == t: continue
                    if blocks(side, t, lastp):
                        r["entry"] = None
                        continue
                    r["entry"] = {"side": side, "ticks": t, "qty": r["lot"] / (t * TICK), "live": T}
                    orders[dk] += 1; orders_agg[dk] += 1
            for s in ("bid", "ask"):
                side_lots = [r for r in L.values() if r["side"] == s]
                if side_lots and all(r["entry"] is None for r in side_lots) and f is not None:
                    blocked[s] += 1
                hv = sum(r["gbp"] for r in side_lots if r["held"] > 0)
                held_max[(b, s)] = max(held_max[(b, s)], hv)
            blocked["turns"] += 1
            if on_turn: on_turn(T, b, L)

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
                close(r, t_to, r["cash"] + (1 if r["side"] == "bid" else -1) * r["held"] * lastpx, "open")
    if stats is not None:
        per = collections.defaultdict(list)
        for (bk, d), n in orders.items(): per[bk].append(n)
        pera = collections.defaultdict(list)
        for (bk, d), n in orders_agg.items(): pera[bk].append(n)
        stats["orders_day_mean"] = {bk: round(st.fmean(v), 1) for bk, v in per.items()}
        stats["orders_day_max"] = {bk: max(v) for bk, v in per.items()}
        stats["orders_agg_day_mean"] = {bk: round(st.fmean(v), 1) for bk, v in pera.items()}
        stats["orders_days_over_900"] = {bk: sum(1 for x in v if x > 900) for bk, v in per.items()}
        stats["side_no_entry_share"] = {s: round(blocked[s] / max(1, blocked["turns"]), 4) for s in ("bid", "ask")}
        stats["held_max_gbp"] = {f"{bk}|{s}": round(v, 2) for (bk, s), v in held_max.items()}
    return trips


# --------------------------------------------------------------------------------------------------------------- data
def load_rx():
    mins = fp_data.load_minutes(); prints = fp_data.load_prints()
    last = {b: v[-1][0] for b, v in mins.items()}
    for l in gzip.open(os.path.join(DATA, "minutes2.txt.gz"), "rt"):
        b, t, x, fu, lag, hn, pn = l.strip().split("|")
        if int(t) > last.get(b, 0): mins.setdefault(b, []).append((int(t), float(x) if x else None, float(fu) if fu else None, int(lag) if lag else None))
    seen = {p[4] for v in prints.values() for p in v}
    for l in gzip.open(os.path.join(DATA, "prints2.txt.gz"), "rt"):
        pid, b, t, px, q, sd = l.strip().split("|")
        if pid not in seen: prints.setdefault(b, []).append((int(t), round(float(px) / TICK), float(q), sd, pid))
    for b in mins: mins[b].sort()
    for b in prints: prints[b].sort(key=lambda z: (z[0], z[4]))
    ids = set()
    for fn in os.environ["MM_LIVE_P8"].split(":"):
        s = "".join(open(fn).read().split()); ids |= {s[i:i + 8] for i in range(0, len(s), 8)}
    removed = {b: sum(1 for p in v if p[4][:8] in ids) for b, v in prints.items()}
    prints = {b: [p for p in v if p[4][:8] not in ids] for b, v in prints.items()}
    return {b: [(t, x, fu) for (t, x, fu, lag) in v] for b, v in mins.items()}, prints, removed


def load_cb():
    """Coinbase's USDC-GBP: its prints as the recorder summarised each minute, fair = 1 / GBP-USD (Yahoo's minute bar)."""
    prints = []
    for l in gzip.open(os.path.join(FP, "cb_print_minutes_USDC-GBP.txt.gz"), "rt"):
        f = l.strip().split("|")
        if len(f) < 6 or not f[1]: continue
        ms = int(f[0]); sec = f[1].split(","); px = f[2].split(","); buy = f[3].split(","); sz = f[5].split(",")
        for i in range(len(px)):
            prints.append((ms + int(sec[i]) * 1000, int(px[i]), int(sz[i]) * 0.01, "buy" if buy[i] == "1" else "sell", f"{ms}-{i}"))
    prints.sort(key=lambda z: (z[0], z[4]))
    fx = [(int(a), float(v)) for a, v in (l.strip().split("|") for l in gzip.open(os.path.join(FP, "fx.txt.gz"), "rt"))]
    ft = [a for a, _ in fx]
    mins = []
    for t in range(CB0 - 2 * DAY, CB1, M):
        i = bisect.bisect_right(ft, t) - 1
        x = fx[i][1] if i >= 0 and t - fx[i][0] <= 10 * M else None
        mins.append((t, x, 1.0))
    return {"CB-USDC-GBP": mins}, {"CB-USDC-GBP": prints}


def rx_mid():
    out = {}
    for bk in ("USDC-GBP", "USDT-GBP"):
        seen = LD.book_seen(bk)
        T, V = [], []
        for t, bids, asks in LD.book(bk):
            if bids and asks and bids[0][0] < asks[0][0] <= bids[0][0] * 1.01:
                T.append(t); V.append(((bids[0][0] + asks[0][0]) / 2, max(seen.get(t, t), t)))
        for l in gzip.open(os.path.join(DATA, f"book2_{bk}.txt.gz"), "rt"):
            f = l.strip().split("|")
            b0 = f[2].split(";")[0].split(":") if f[2] else None; a0 = f[3].split(";")[0].split(":") if f[3] else None
            if b0 and a0 and float(b0[0]) < float(a0[0]) <= float(b0[0]) * 1.01 and int(f[0]) > (T[-1] if T else 0):
                T.append(int(f[0])); V.append(((float(b0[0]) + float(a0[0])) / 2, int(f[1])))
        out[bk] = (T, V)

    def mid(b, t):
        T, V = out[b]
        i = bisect.bisect_right(T, t) - 1
        if i < 0 or t > V[i][1] + 5 * M: return None
        m = V[i][0]
        return m
    return mid


def cb_mid():
    rows = [(c[0], (c[1] + c[2]) / 2) for c in LD.cb("USDC-GBP") if c[2] > c[1] > 0]
    T = [r[0] for r in rows]
    def mid(b, t):
        i = bisect.bisect_right(T, t) - 1
        if i < 0 or t - T[i] > 5 * M: return None
        return rows[i][1]
    return mid


# ------------------------------------------------------------------------------------------------------------ regimes
HIST = json.load(open(os.path.join(HERE, "..", "results", "maker_history.json")))


def absences(book):
    out, gone = [], None
    def ms(s): return D.ms(*[int(x) for x in s[:10].split("-")]) + (int(s[11:13]) * 60 + int(s[14:16])) * M
    for e in HIST["events"]:
        if e["book"] != book: continue
        if e["kind"] == "disappeared": gone = ms(e["ts"])
        if e["kind"] == "appeared" and gone is not None: out.append((gone, ms(e["ts"]))); gone = None
    if gone is not None: out.append((gone, T1))
    return out


# --------------------------------------------------------------------------------------------------------------- stats
def boot_sum(xs):
    if not xs: return None
    rnd = random.Random(SEED); n = len(xs); out = sorted(sum(xs[rnd.randrange(n)] for _ in range(n)) for _ in range(NB))
    return [round(out[int(0.05 * NB)], 4), round(out[int(0.95 * NB)], 4), round(sum(1 for x in out if x <= 0) / NB, 4)]


def summarise(trips, cap, t0, t1, stt, absn=None):
    d = daily(trips, t0, t1); n = len(d)
    v = [x / cap * 1e4 for x in d.values()]
    keys = list(d)
    done = [tr for tr in trips if tr["how"] != "open"]
    g = sum(tr["gbp"] for tr in done)
    o = {"gbp_day": round(sum(d.values()) / n, 4), "bps_cap_day": round(st.fmean(v), 3), "pct_year": round(st.fmean(v) * 365 / 100, 2),
         "trips_day": round(len(done) / n, 2), "bps_trip": round(1e4 * sum(tr["pnl"] for tr in done) / g, 2) if g else None,
         "taker_stops": sum(1 for tr in trips if tr["how"] == "taker"), "worst_day_bps_cap": round(min(v), 1), "days_under_minus_1pct": sum(1 for x in v if x <= -100)}
    o.update(stt)
    # how many round trips bought or sold less than their lot: the part a partly filled entry left unfilled
    o["partial_trip_share"] = round(sum(1 for t in done if t["gbp"] < 0.95 * t["lot"]) / max(1, len(done)), 3)
    o["lot_filled_share"] = round(sum(min(t["gbp"], t["lot"]) for t in done) / max(1e-9, sum(t["lot"] for t in done)), 3)
    # markouts by the lots of its rung already held when it filled
    byr = collections.defaultdict(lambda: collections.defaultdict(list))
    for tr in done:
        rk = min(tr["rank"], 3)
        for h, val in tr["mk"].items():
            if val is not None: byr[rk][h].append((tr["gbp"], val))
    o["markout_bps_by_rank"] = {str(rk): {str(h): round(sum(a * b for a, b in xs) / sum(a for a, _ in xs), 2) for h, xs in hh.items() if xs} | {"trips": len([t for t in done if min(t["rank"], 3) == rk])} for rk, hh in sorted(byr.items())}
    o["pnl_bps_trip_by_rank"] = {}
    for rk in sorted({min(t["rank"], 3) for t in done}):
        ts_ = [t for t in done if min(t["rank"], 3) == rk]; gg = sum(t["gbp"] for t in ts_)
        o["pnl_bps_trip_by_rank"][str(rk)] = round(1e4 * sum(t["pnl"] for t in ts_) / gg, 2) if gg else None
    if absn is not None:
        o["absence_pnl"] = [round(sum(tr["pnl"] for tr in trips if tr["tEntry"] is not None and a <= tr["tEntry"] < b), 4) for a, b in absn]
        hrs = sum(b - a for a, b in absn) / 3600e3
        o["absent_gbp_day"] = round(sum(o["absence_pnl"]) / hrs * 24, 4) if hrs else None
        pres = sum(tr["pnl"] for tr in trips if tr["tEntry"] is not None and not any(a <= tr["tEntry"] < b for a, b in absn))
        o["present_gbp_day"] = round(pres / ((t1 - t0) / 3600e3 - hrs) * 24, 4)
    return o, v, keys


def paired(vb, vv, keys):
    diff = [b - a for a, b in zip(vb, vv)]
    h1 = [x for k, x in zip(keys, diff) if k < SPLIT]; h2 = [x for k, x in zip(keys, diff) if k >= SPLIT]
    out = {"diff": round(st.fmean(diff), 3), "boot": boot(diff), "days_ahead": sum(1 for x in diff if x > 1e-9), "days_behind": sum(1 for x in diff if x < -1e-9)}
    if len(h1) >= 3 and len(h2) >= 3:
        out.update(before_10_13=round(st.fmean(h1), 3), boot_before=boot(h1), from_10_13=round(st.fmean(h2), 3), boot_from=boot(h2))
    return out


# ---------------------------------------------------------------------------------------------------------------- runs
def ladder(book, rungs_gbp):
    return {(book, s, k): g for s in ("bid", "ask") for k, g in rungs_gbp.items() if g > 0}


def designs(cap):
    V = collections.OrderedDict()
    V["K1"] = dict(K=1)
    for K in (2, 3, 4, 6):
        V[f"seq{K}"] = dict(K=K, mode="seq")
    for K in (2, 3):
        V[f"all{K}"] = dict(K=K, mode="all")
    V["pool"] = dict(pool=True, pool_kmax=4, mode="seq")
    V["cap2_K1"] = dict(K=1, lot_mul=2.0)
    V["cap2_seq2"] = dict(K=2, mode="seq", lot_mul=2.0)
    return V


U, C = "USDT-GBP", "USDC-GBP"
STRATS = collections.OrderedDict([
    ("LIVE", dict(venue="rx", books=(U,), cap=600.0, size=ladder(U, {0.001: 100, 0.002: 100, 0.003: 100}), exit_off=1)),
    ("RXU", dict(venue="rx", books=(C,), cap=120.0, size=ladder(C, {0.001: 30, 0.002: 30}), exit_off=1)),
    ("CBLIVE", dict(venue="cb", books=("CB-USDC-GBP",), cap=120.0, size=ladder("CB-USDC-GBP", {0.001: 20, 0.002: 20, 0.003: 20}), exit_off=0)),
    ("live1200", dict(venue="rx", books=(U,), cap=1200.0, size=ladder(U, {0.001: 200, 0.002: 200, 0.003: 200}), exit_off=1)),
    ("n600usdt", dict(venue="rx", books=(U, C), cap=600.0, size={**ladder(U, {0.001: 50, 0.002: 50, 0.003: 50}), **ladder(C, {0.001: 50, 0.002: 50, 0.003: 50})}, exit_off=1)),
])

if __name__ == "__main__":
    rx_mins, rx_prints, removed = load_rx()
    cb_mins, cb_prints = load_cb()
    mid_rx, mid_cb = rx_mid(), cb_mid()
    res = {"window_rx": "2026-09-26 00:00 -> 2026-10-30 03:00 UTC", "window_cb": "2026-10-10 00:00 -> 2026-10-29 00:00 UTC",
           "live_prints_removed": removed, "engine_check": {}, "runs": {}}
    # the engine check: one lot a rung is sim.run
    for name in ("LIVE", "RXU"):
        S = STRATS[name]
        m = {b: rx_mins[b] for b in S["books"]}
        kw = dict(size=S["size"], exit_off=S["exit_off"], hold_min_gbp=1.0, fill="at")
        if name == "RXU": kw["retired"] = ((C, "bid", 0.003), (C, "ask", 0.003))
        a, _ = sim.run(m, rx_prints, T0, T1, **kw)
        b2 = run_lots(m, rx_prints, T0, T1, K=1, **kw)
        same = len(a) == len(b2) and all(abs(x["pnl"] - y["pnl"]) < 1e-9 and x["tExit"] == y["tExit"] for x, y in zip(a, b2))
        res["engine_check"][name] = {"sim_run_trips": len(a), "run_lots_trips": len(b2), "identical": same}
        print("engine check", name, same, len(a), len(b2), flush=True)
        assert same
    for name, S in STRATS.items():
        rx = S["venue"] == "rx"
        m = {b: (rx_mins if rx else cb_mins)[b] for b in S["books"]}
        pr = rx_prints if rx else cb_prints
        t0, t1 = (T0, T1) if rx else (CB0, CB1)
        absn = absences(S["books"][0]) if rx and len(S["books"]) == 1 else None
        for fill in ("at", "through"):
            base_v = base_abs = None
            for dn, dkw in designs(S["cap"]).items():
                stt = {}
                trips = run_lots(m, pr, t0, t1, mid_at=(mid_rx if rx else mid_cb), stats=stt, size=S["size"], exit_off=S["exit_off"], hold_min_gbp=1.0, fill=fill, **dkw)
                cap = S["cap"] * dkw.get("lot_mul", 1.0)
                o, v, keys = summarise(trips, S["cap"], t0, t1, stt, absn)
                o["capital"] = cap
                if dn == "K1": base_v, base_abs = v, o.get("absence_pnl")
                else:
                    o["vs_K1"] = paired(base_v, v, keys)
                    if absn is not None:
                        dd = [x - y for x, y in zip(o["absence_pnl"], base_abs)]
                        o["vs_K1_absent"] = {"sum_gbp": round(sum(dd), 4), "boot_windows": boot_sum(dd), "ahead": sum(1 for x in dd if x > 1e-9), "behind": sum(1 for x in dd if x < -1e-9)}
                res["runs"][f"{name}|{fill}|{dn}"] = o
                print(name, fill, dn, o["gbp_day"], o["bps_cap_day"], o["trips_day"], o["bps_trip"], o.get("vs_K1", {}).get("diff"), o.get("vs_K1", {}).get("boot"), flush=True)
    json.dump(res, open(OUT, "w"), indent=1, sort_keys=True)
