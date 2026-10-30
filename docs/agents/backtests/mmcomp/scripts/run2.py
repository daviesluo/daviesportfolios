# MMCOMP-3 and MAKER-ABSENT (2026-10-30): the hooked executor both replays run on, moved out of inside.py unchanged so
# absent.py can import it. `run2` is PR5-OPT's `sim.run` (pr5_opt/scripts/sim.py, imported unchanged) with hooks: the inside
# slot (an order off the other maker's), the exit modes, the Coinbase pull, and the counts (placements a day, sides full,
# capital over the strategy's). With no hook on it gives `sim.run`'s trips exactly (inside.py checks it before anything).
# `Ref` reads the other maker off the recorded books, `Cb` Coinbase's mid; `daily` and `boot` are inner_rung2.py's.
import bisect, collections, gzip, math, os, random, statistics as st, sys
HERE = os.path.dirname(os.path.abspath(__file__))
BT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.dont_write_bytecode = True
for p in (HERE, os.path.join(BT, "fair_price", "scripts"), os.path.join(BT, "pr5_opt", "scripts")):
    if p not in sys.path: sys.path.insert(0, p)
import fp_data as D
import sim
import load as LD
from sim import TICK, FEE, HALF, MIN_GBP, DAY, M, H, et, qt, blocks, through, at_fill

SEED, NB, BLOCK = 20261030, 10000, 3
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


def run2(mins, prints, t_from, t_to, ref=None, cbs=None, inside=None, exit_mode="rule", cbpull=None, stats=None, cap_limit=None, on_turn=None, **kw):
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
                    # absent.py's regime switch: the exit offset as a function of the turn (none: the rule's)
                    offt = c["exit_off_fn"](T, b) if c.get("exit_off_fn") else c["exit_off"]
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
            # absent.py's per-minute reading of the slots (sides full, pounds out); nothing reads it here
            if on_turn is not None: on_turn(T, b, L, quoted, size)

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
