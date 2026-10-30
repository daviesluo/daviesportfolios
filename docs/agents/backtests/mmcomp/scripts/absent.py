# MAKER-ABSENT (2026-10-30): what LIVE's and RX USDC/GBP's rules earn while the other maker is away, and whether another rule
# would earn more then. Davies, 2026-10-30 ~03:25 UTC, after the maker left both books at 2026-10-29 21:16 and LIVE's fills
# rose: "我们如何趁他不在时最大化收益？"
#
# The maker's history is the watch's own (results/maker_history.json, made by maker_history.ts from
# supabase/functions/agents/maker_watch.ts): per book, its absences (disappeared -> appeared) and its width. A minute's regime:
#   absent  inside an absence ([disappeared, appeared), as the watch dates them: the first minute it was gone);
#   wide    there, its bid-ask gap settled at 10 ticks or more (the 12-tick regime);
#   narrow  there, under 10 ticks (the 5-tick regime);
#   start   before the watch's first events (2026-09-26 00:00 to ~18:50).
# A switching rule can only know an absence once the watch has called it: from 15 minutes after it began (MW_GONE_MIN) to 3
# minutes after it ended (MW_BACK_MIN). Its gate uses those `known` windows; the attribution uses the true ones.
#
# The record: REVX-FAIR's stored minutes and prints to 2026-10-29 00:00, then data/minutes2 and prints2 to 2026-10-30 03:00
# (sql/pull_1029.sql), LIVE's own fill prints taken out (their 8-character id prefixes, from sql/live_fill_prints.sql's
# question asked to 10-29 and again from 10-27 to 10-30 03:00, handed in as $MM_LIVE_P8, files joined by ':'; never committed).
# The engine is run2.py (PR5-OPT's executor, LIVE's rules: fills 'at' and 'through', the £1 holding line, an exit a tick
# beyond fair). Each run covers the whole record, as LIVE would trade it; every round trip is put in the regime of its entry.
#   MM_LIVE_P8=<file>:<file> python3 -I docs/agents/backtests/mmcomp/scripts/absent.py   -> results/absent.json
import bisect, collections, gzip, json, os, random, statistics as st, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True
sys.path.insert(0, HERE)
from run2 import run2, D, sim, DAY, M
import fp_data

OUT = os.path.join(HERE, "..", "results", "absent.json")
DATA = os.path.join(HERE, "..", "data")
T0, T1 = D.ms(2026, 9, 26), D.ms(2026, 10, 30, 3)
GONE_MS, BACK_MS = 15 * M, 3 * M         # maker_watch.ts MW_GONE_MIN, MW_BACK_MIN
SEED, NB = 20261030, 10000


def load():
    mins = fp_data.load_minutes(); prints = fp_data.load_prints()
    last = {b: v[-1][0] for b, v in mins.items()}
    for l in gzip.open(os.path.join(DATA, "minutes2.txt.gz"), "rt"):
        b, t, x, fu, lag, hn, pn = l.strip().split("|")
        if int(t) > last.get(b, 0): mins.setdefault(b, []).append((int(t), float(x) if x else None, float(fu) if fu else None, int(lag) if lag else None))
    seen = {p[4] for v in prints.values() for p in v}
    for l in gzip.open(os.path.join(DATA, "prints2.txt.gz"), "rt"):
        pid, b, t, px, q, sd = l.strip().split("|")
        if pid not in seen: prints.setdefault(b, []).append((int(t), round(float(px) / sim.TICK), float(q), sd, pid))
    for b in mins: mins[b].sort()
    for b in prints: prints[b].sort(key=lambda z: (z[0], z[4]))
    return mins, prints


def live_prefixes():
    out = set()
    for f in os.environ["MM_LIVE_P8"].split(":"):
        s = "".join(open(f).read().split())
        out |= {s[i:i + 8] for i in range(0, len(s), 8)}
    return out


H = json.load(open(os.path.join(HERE, "..", "results", "maker_history.json")))


def regimes(book):
    """(true absences, known absences, width steps) for a book, from the watch's events."""
    ev = [e for e in H["events"] if e["book"] == book]
    absn, known, widths = [], [], []
    gone = None
    for e in ev:
        t = D.ms(*[int(x) for x in e["ts"][:10].split("-")]) + (int(e["ts"][11:13]) * 60 + int(e["ts"][14:16])) * M
        if e["kind"] == "disappeared": gone = t
        if e["kind"] == "appeared" and gone is not None:
            absn.append((gone, t)); known.append((gone + GONE_MS, t + BACK_MS)); gone = None
        if e["kind"] == "width": widths.append((t, e["to_value"]))
    if gone is not None: absn.append((gone, T1)); known.append((gone + GONE_MS, T1))
    first = min((D.ms(*[int(x) for x in e["ts"][:10].split("-")]) + (int(e["ts"][11:13]) * 60 + int(e["ts"][14:16])) * M for e in ev), default=T1)
    return absn, known, widths, first


def inside(t, wins):
    i = bisect.bisect_right([a for a, _ in wins], t) - 1
    return i >= 0 and t < wins[i][1]


def regime_of(t, R):
    absn, known, widths, first = R
    if t < first: return "start"
    if inside(t, absn): return "absent"
    i = bisect.bisect_right([w[0] for w in widths], t) - 1
    w = widths[i][1] if i >= 0 else None
    return "wide" if w is not None and w >= 10 else "narrow"


def minutes_by_regime(R):
    c = collections.Counter()
    for t in range(T0, T1, M): c[regime_of(t, R)] += 1
    return c


def boot_windows(xs):
    """The windows' differences resampled with replacement: the 90 % band of their sum and P(sum <= 0)."""
    if not xs: return None
    rnd = random.Random(SEED); n = len(xs); out = []
    for _ in range(NB):
        out.append(sum(xs[rnd.randrange(n)] for _ in range(n)))
    out.sort()
    return [round(out[int(0.05 * NB)], 4), round(out[int(0.95 * NB)], 4), round(sum(1 for x in out if x <= 0) / NB, 4)]


mins, prints = load()
ids = live_prefixes()
mins3 = {b: [(t, x, fu) for (t, x, fu, lag) in v] for b, v in mins.items()}
clean = {b: [p for p in v if p[4][:8] not in ids] for b, v in prints.items()}
res = {"window": "2026-09-26 00:00 -> 2026-10-30 03:00 UTC", "live_prints_removed": {b: len(prints[b]) - len(clean[b]) for b in prints},
       "regime_minutes": {}, "absences": {}, "runs": {}}
print(res["live_prints_removed"], flush=True)


def ladder(book, rungs_gbp):
    return {(book, s, k): g for s in ("bid", "ask") for k, g in rungs_gbp.items() if g > 0}


def strategies():
    U, C = "USDT-GBP", "USDC-GBP"
    S = {}
    # LIVE today: USDT-GBP alone, £100 on each 0.1 / 0.2 / 0.3 % rung a side.
    live = {0.001: 100, 0.002: 100, 0.003: 100}
    S["LIVE"] = (U, 600.0, collections.OrderedDict([
        ("base", dict(size=ladder(U, live))),
        ("near005_for_03", dict(rungs=(0.0005, 0.001, 0.002), size=ladder(U, {0.0005: 100, 0.001: 100, 0.002: 100}))),
        ("add005_4rungs", dict(rungs=(0.0005, 0.001, 0.002, 0.003), size=ladder(U, {0.0005: 75, 0.001: 75, 0.002: 75, 0.003: 75}))),
        ("more01_200_100", dict(size=ladder(U, {0.001: 200, 0.002: 100}), retired=((U, "bid", 0.003), (U, "ask", 0.003)))),
        ("03to01_02", dict(size=ladder(U, {0.001: 150, 0.002: 150}), retired=((U, "bid", 0.003), (U, "ask", 0.003)))),
        ("exit0", dict(size=ladder(U, live), exit_off=0)),
        ("exit2", dict(size=ladder(U, live), exit_off=2)),
        ("exit3", dict(size=ladder(U, live), exit_off=3)),
        ("capital1200", dict(size=ladder(U, {0.001: 200, 0.002: 200, 0.003: 200}))),
    ]))
    # RX USDC/GBP today: USDC-GBP alone, £30 on each 0.1 / 0.2 % rung a side, the 0.3 % rungs quoting nothing.
    rxu = {0.001: 30, 0.002: 30}
    ret03 = ((C, "bid", 0.003), (C, "ask", 0.003))
    S["RXU"] = (C, 120.0, collections.OrderedDict([
        ("base", dict(size=ladder(C, rxu), retired=ret03)),
        ("near005_for_02", dict(rungs=(0.0005, 0.001), size=ladder(C, {0.0005: 30, 0.001: 30}))),
        ("add005_3rungs", dict(rungs=(0.0005, 0.001, 0.002), size=ladder(C, {0.0005: 20, 0.001: 20, 0.002: 20}))),
        ("more01_60", dict(size=ladder(C, {0.001: 60}), retired=ret03)),
        ("exit0", dict(size=ladder(C, rxu), retired=ret03, exit_off=0)),
        ("exit2", dict(size=ladder(C, rxu), retired=ret03, exit_off=2)),
        ("exit3", dict(size=ladder(C, rxu), retired=ret03, exit_off=3)),
        ("capital240", dict(size=ladder(C, {0.001: 60, 0.002: 60}), retired=ret03)),
    ]))
    return S


def switch(book, rule, known, base_kw, alt_kw):
    """Today's rule while the maker is there, `alt` while the watch knows it is gone: both rule's slots, each gated by the
    regime (a slot of one rule still holding finishes its exit under the other)."""
    sb, sa = base_kw["size"], alt_kw["size"]
    union = tuple(sorted({k for (_, _, k) in sb} | {k for (_, _, k) in sa} | set(sim.DEFAULTS["rungs"])))
    keys = set(sb) | set(sa)
    # a slot in both with different pounds cannot switch its size in this engine: refuse such a pair
    assert all(sb.get(k, 0) == sa.get(k, 0) or sb.get(k, 0) == 0 or sa.get(k, 0) == 0 for k in keys), "a slot in both rules must have one size"
    size = {k: max(sb.get(k, 0), sa.get(k, 0)) for k in keys}
    def gate(T, b, s, k):
        alt = inside(T, known)
        return ((b, s, k) in sa) if alt else ((b, s, k) in sb)
    return dict(rungs=union, size=size, gate=gate)


S = strategies()
FILLS = ("at", "through")
for name, (book, cap, V) in S.items():
    R = regimes(book)
    absn, known, widths, first = R
    res["regime_minutes"][name] = dict(minutes_by_regime(R))
    res["absences"][name] = [{"from": D.day(a) + " " + f"{(a % DAY) // 3600000:02d}:{(a % 3600000) // 60000:02d}", "hours": round((b - a) / 3600e3, 2)} for a, b in absn]
    m = {book: mins3[book]}
    for fill in FILLS:
        out_base = None
        runs = list(V.items())
        # the regime switches: today's rule, and in an absence (as the watch knows it) the 0.3 % rung's pounds on a 0.05 % rung
        if name == "LIVE":
            runs.append(("switch_near005", switch(book, name, known, V["base"], V["near005_for_03"])))
        # and the exit a few ticks further out while the watch knows it is gone (the rule's tick otherwise)
        for off in (2, 3):
            runs.append((f"switch_exit{off}", dict(V["base"], exit_off_fn=lambda T, b, off=off: off if inside(T, known) else 1)))
        for vn, kw in runs:
            per = collections.defaultdict(lambda: collections.Counter())
            def on_turn(T, b, L, quoted, size, per=per):
                rg = regime_of(T, R)
                c = per[rg]; c["turns"] += 1
                for s in ("bid", "ask"):
                    if quoted[s] and all(L[key]["inpos"] for key in quoted[s]): c["full_" + s] += 1
                c["gbp_held"] += sum(r["gbp"] for r in L.values() if r["inpos"])
            kwx = dict(kw); kwx.setdefault("exit_off", 1)
            stt = {}
            trips, _ = run2(m, clean, T0, T1, stats=stt, cap_limit=cap, on_turn=on_turn, hold_min_gbp=1.0, fill=fill, **kwx)
            by = collections.defaultdict(lambda: {"pnl": 0.0, "gbp": 0.0, "trips": 0, "taker": 0})
            for tr in trips:
                rg = regime_of(tr["tEntry"] if tr["tEntry"] is not None else tr["tExit"], R)
                x = by[rg]; x["pnl"] += tr["pnl"]; x["gbp"] += tr["gbp"]; x["trips"] += tr["how"] != "open"; x["taker"] += tr["how"] == "taker"
            o = {"orders_day_mean": stt["orders_day_mean"], "orders_day_max": stt["orders_day_max"], "over_capital_share": stt["over_capital_share"], "regimes": {}}
            for rg, mcount in res["regime_minutes"][name].items():
                x = by.get(rg, {"pnl": 0.0, "gbp": 0.0, "trips": 0, "taker": 0}); c = per.get(rg, collections.Counter())
                hours = mcount / 60
                o["regimes"][rg] = {"hours": round(hours, 1), "gbp_per_day": round(x["pnl"] / hours * 24, 4) if hours else None,
                                    "bps_cap_day": round(x["pnl"] / hours * 24 / cap * 1e4, 2) if hours else None,
                                    "trips_per_day": round(x["trips"] / hours * 24, 2) if hours else None,
                                    "bps_trip": round(1e4 * x["pnl"] / x["gbp"], 2) if x["gbp"] else None, "taker_stops": x["taker"],
                                    "bid_side_full": round(c["full_bid"] / max(1, c["turns"]), 3), "ask_side_full": round(c["full_ask"] / max(1, c["turns"]), 3),
                                    "gbp_held_mean": round(c["gbp_held"] / max(1, c["turns"]), 1)}
            # paired by absence window: each window's trips (entered in it) against today's rule's in the same window
            wins = {}
            for i, (a, b) in enumerate(absn):
                wins[i] = sum(tr["pnl"] for tr in trips if tr["tEntry"] is not None and a <= tr["tEntry"] < b)
            o["absence_windows_pnl"] = [round(wins[i], 4) for i in range(len(absn))]
            if vn == "base": out_base = o
            else:
                d = [o["absence_windows_pnl"][i] - out_base["absence_windows_pnl"][i] for i in range(len(absn))]
                o["vs_base_absent"] = {"sum_gbp": round(sum(d), 4), "boot_windows": boot_windows(d), "windows_ahead": sum(1 for x in d if x > 1e-9), "windows_behind": sum(1 for x in d if x < -1e-9)}
                for rg in ("absent", "wide", "narrow"):
                    b0, b1 = out_base["regimes"].get(rg), o["regimes"].get(rg)
                    if b0 and b1 and b0["gbp_per_day"] is not None: o.setdefault("vs_base_gbp_day", {})[rg] = round(b1["gbp_per_day"] - b0["gbp_per_day"], 4)
            res["runs"][f"{name}|{fill}|{vn}"] = o
            print(name, fill, vn, {rg: (v["gbp_per_day"], v["trips_per_day"], v["bps_trip"]) for rg, v in o["regimes"].items()}, o.get("vs_base_absent"), flush=True)
json.dump(res, open(OUT, "w"), indent=1, sort_keys=True)
