"""PR5v — denser and other rungs, re-price steps, cadence, the order budget and accounts, for "Stablecoin quotes -
variant" (Davies, 2026-09-28). Descriptive search, chosen on the in-sample half of the tightened market and confirmed
on the other half, on five fresh days and, separately, on the wide market before 2026-08-24.

Windows (trips counted by the step they were entered in, as PR5 counts them):
  IS   2026-08-26 00:00 -> 09-09 18:00 UTC (PR3's split)      one run over 08-26 -> 09-23 on the committed inputs
  OOS  2026-09-09 18:00 -> 09-23 00:00                         (Exness GBP/USD, the tested source)
  N28  both halves
  WIDE each book from its PR5 start (USDC-GBP 2025-11-26, USDT-GBP 2025-12-16) -> 2026-08-24 00:00, a separate regime
  FRESH 2026-09-23 00:00 -> 09-28 00:00, fresh keyless prints and hours and Yahoo's GBP/USD (inputs/pr5v_2026-09-28)

Every selection is a rule written here before it ran, applied to IS only:
  1. the rung set: the highest IS $/day at $100 a rung among the sets tried whose IS return on locked capital is at
     least 8 %/yr (the paper spec's bar); a tie goes to fewer rungs;
  2. the re-price step: the highest IS $/day for that set whose busiest day of the 28 stays under 600 POSTs on one key;
  3. the cadence: the fastest one tried unless a slower one is better on IS by more than 5 %;
  4. accounts: for 1, 2 and 4 keys, the configuration with the highest IS $/day under the simulated governor;
  5. the recommendation: the account count whose best has the highest IS $/day (within 5 %, fewer accounts). Rule 5
     was written after stage E printed its IS and OOS lines; it reads IS only, and the review discloses it.
usage: study.py OUT_DIR
"""
import collections, gzip, hashlib, json, math, os, random, statistics as stt, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import pr5v_sim as V  # noqa: E402
P = V.P
M, DAY = V.M, V.DAY
ROOT = os.path.abspath(os.path.join(HERE, "../../../.."))
FRESH_DIR = os.path.join(ROOT, "docs/agents/backtests/inputs/pr5v_2026-09-28")


def ms(s):
    return P.ms(s)


N0, NMID, N1 = P.PR3_0, P.PR3_MID, P.END
WIDE_END = ms("2026-08-24T00:00")
F0, F1 = P.END, ms("2026-09-28T00:00")
BOOKS = P.BOOKS
KS = [0.0003, 0.0005, 0.00075, 0.001, 0.00125, 0.0015, 0.002, 0.0025, 0.003, 0.0035, 0.004, 0.005, 0.006]
FROZEN = [0.001, 0.002, 0.003]
DAVIES = [0.0005, 0.0015, 0.0025, 0.0035, 0.004]
UNION = sorted(set(FROZEN) | set(DAVIES))
REF = dict(s_ms=M, delta_ms=None, cancel_ms=0, lagx_ms=0, phase_ms=0)          # today's timing (the frozen rule's)


def live(s, d):
    """A live loop: a turn every s seconds, a POST live d seconds after it, a cancel landing d seconds after it, the
    GBP/USD bar read 5 s after its minute ends, turns 5 s past the minute."""
    return dict(s_ms=s * 1000, delta_ms=d * 1000, cancel_ms=d * 1000, lagx_ms=5000, phase_ms=5000)


N_CONFIGS = collections.Counter()


def sha(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


# ------------------------------------------------------------------------------------------------ inputs
def fresh_markets():
    """Committed prints + the fresh pull (by id), the USD hours likewise, and Yahoo's GBP/USD minutes only."""
    y = json.load(gzip.open(os.path.join(FRESH_DIR, "yahoo_GBPUSD_1m_7d.json.gz"), "rt"))["chart"]["result"][0]
    pulled = max(y["timestamp"])
    bars = {}
    for t, c in zip(y["timestamp"], y["indicators"]["quote"][0]["close"]):
        start = t // 60 * 60 * 1000
        if c is not None and c > 0 and start + M <= pulled * 1000 - (pulled % 60) * 1000:
            bars[start] = c
    fxp = sorted(bars.items())
    out = {}
    for b in BOOKS:
        rows = {}
        for line in gzip.open(os.path.join(P.S, "trades", b + ".jsonl.gz"), "rt"):
            r = json.loads(line)
            rows[r["id"]] = r
        for r in json.load(gzip.open(os.path.join(FRESH_DIR, f"prints_{b}.json.gz"), "rt"))["rows"]:
            rows[r["id"]] = r
        prints = []
        for r in sorted(rows.values(), key=lambda z: (z["ts"], z["id"])):
            if r["region"] != "UK":
                continue
            pt = round(float(r["price"]) / P.TICK)
            prints.append((r["ts"], pt, float(r["qty"]), r["side"]))
        hrs = {}
        base = json.load(gzip.open(os.path.join(P.S, "candles", f"{P.USD_OF[b]}_60.json.gz"), "rt"))["rows"]
        for r in base + json.load(gzip.open(os.path.join(FRESH_DIR, f"candles_{P.USD_OF[b]}_60.json.gz"), "rt"))["rows"]:
            hrs[int(r["start"])] = float(r["close"])
        out[b] = V.Mkt(b, prints, fxp, sorted(hrs.items()))
    return out, bars


def fx_checks(yahoo_bars):
    """Yahoo against Exness where both have a minute, and where one is dark and the other is not."""
    exn = dict(P.fx_series())
    common = sorted(set(exn) & set(yahoo_bars))
    dev = sorted(abs(yahoo_bars[t] / exn[t] - 1) * 1e4 for t in common)
    sdev = sorted((yahoo_bars[t] / exn[t] - 1) * 1e4 for t in common)
    lo, hi = min(yahoo_bars), max(exn)
    only_y = [t for t in yahoo_bars if lo <= t <= hi and t not in exn]
    only_e = [t for t in exn if lo <= t <= hi and t not in yahoo_bars]
    q = lambda a, p: a[min(len(a) - 1, int(p * (len(a) - 1)))] if a else None
    return {"overlap_from": P.datetime.datetime.fromtimestamp(lo / 1000, P.datetime.timezone.utc).isoformat(),
            "overlap_to": P.datetime.datetime.fromtimestamp(hi / 1000, P.datetime.timezone.utc).isoformat(),
            "minutes_both": len(common), "median_abs_bps": round(stt.median(dev), 3) if dev else None,
            "p95_abs_bps": round(q(dev, 0.95), 3) if dev else None, "max_abs_bps": round(dev[-1], 3) if dev else None,
            "median_signed_bps_yahoo_minus_exness": round(stt.median(sdev), 3) if sdev else None,
            "minutes_yahoo_only": len(only_y), "minutes_exness_only": len(only_e)}


# ------------------------------------------------------------------------------------------------ metrics
def token_bucket_min(times):
    """The lowest level of a 1,000-token bucket refilled continuously at 1,000 a day, starting full."""
    lvl, last, low = 1000.0, None, 1000.0
    for t in sorted(times):
        if last is not None:
            lvl = min(1000.0, lvl + (t - last) * 1000.0 / DAY)
        lvl -= 1
        low = min(low, lvl)
        last = t
    return round(low, 1)


def order_stats(posts, d0, d1, acct_names=None):
    """POSTs a UTC day (placements, re-prices, re-placements, exits and stops) over the whole days [d0, d1)."""
    days = list(range(d0 // DAY, d1 // DAY))
    by = collections.defaultdict(collections.Counter)
    times = collections.defaultdict(list)
    for p in posts:
        if not p[6] or not (d0 <= p[0] < d1):
            continue
        by[p[2]][p[0] // DAY] += 1
        by["all"][p[0] // DAY] += 1
        times[p[2]].append(p[0])
    out = {}
    for a, c in by.items():
        v = sorted(c.get(d, 0) for d in days)
        out[str(a)] = {"mean": round(sum(v) / len(v), 1), "p95": v[min(len(v) - 1, int(0.95 * (len(v) - 1)))],
                       "max": v[-1], "days_over_600": sum(1 for x in v if x > 600),
                       "days_over_700": sum(1 for x in v if x > 700), "days_over_1000": sum(1 for x in v if x > 1000)}
        if a != "all":
            out[str(a)]["token_bucket_min"] = token_bucket_min(times[a])
            out[str(a)]["max_posts_one_second"] = max(collections.Counter(t // 1000 for t in times[a]).values(), default=0)
            out[str(a)]["max_posts_one_minute"] = max(collections.Counter(t // M for t in times[a]).values(), default=0)
    return out


def pnl_stats(trips, a, b, capital, days):
    sel = [x for x in trips if a <= x["t_entry"] < b]
    tot = sum(x["pnl_usd"] for x in sel)
    cum = peak = mdd = 0.0
    for x in sorted(sel, key=lambda z: (z["t_exit"], z["t_entry"], z["book"], z["side"], z["k"])):
        cum += x["pnl_usd"]
        peak = max(peak, cum)
        mdd = max(mdd, peak - cum)
    byday = collections.Counter()
    for x in sel:
        byday[x["t_entry"] // DAY] += x["pnl_usd"]
    dl = [byday.get(d, 0.0) for d in range(a // DAY, (b - 1) // DAY + 1)]
    return {"trips": len(sel), "trips_per_day": round(len(sel) / days, 2), "pnl_usd": round(tot, 4),
            "usd_per_day": round(tot / days, 4), "usd_per_trip": round(tot / len(sel), 4) if sel else None,
            "capital_usd": round(capital, 2), "pct_per_year": round(100 * tot / capital * 365 / days, 2) if capital else None,
            "win_rate": round(sum(1 for x in sel if x["pnl_usd"] > 0) / len(sel), 4) if sel else None,
            "taker_exits": sum(1 for x in sel if x["how"] != "maker"),
            "stale_entries": sum(1 for x in sel if x.get("stale_entry")),
            "stale_exits": sum(1 for x in sel if x.get("stale_exit")),
            "worst_trip_usd": round(min((x["pnl_usd"] for x in sel), default=0.0), 4),
            "worst_day_usd": round(min(dl), 4) if dl else 0.0, "max_drawdown_usd": round(mdd, 4),
            "fill_usd_per_day": round(sum(x["notional_usd"] for x in sel) / days, 2)}


def daily(trips, a, b):
    byday = collections.Counter()
    for x in trips:
        if a <= x["t_entry"] < b:
            byday[x["t_entry"] // DAY] += x["pnl_usd"]
    return [round(byday.get(d, 0.0), 6) for d in range(a // DAY, (b - 1) // DAY + 1)]


# ------------------------------------------------------------------------------------------------ running
class Runner:
    def __init__(self):
        t = time.time()
        self.N = V.committed_markets()
        self.F, self.ybars = fresh_markets()
        print(f"inputs loaded in {time.time() - t:.1f}s", flush=True)

    def cfg(self, rungs, **kw):
        c = dict(REF)
        c.update(kw)
        c["rungs"] = {"bid": list(rungs), "ask": list(rungs)} if isinstance(rungs, (list, tuple)) else rungs
        c.setdefault("cap", "shared")
        return V.default_cfg(**c)

    def key(self, rungs, kw):
        return json.dumps({"rungs": rungs, **{k: v for k, v in kw.items() if k not in ("acct",)}}, sort_keys=True, default=str)

    def run(self, span, rungs, **kw):
        """span N: both books over 08-26 -> 09-23; W: each book from its start to 08-24; F: 09-23 -> 09-28 (Yahoo)."""
        N_CONFIGS[self.key(rungs, kw)] += 1
        cfg = self.cfg(rungs, **kw)
        nr = len(cfg["rungs"]["bid"]) + len(cfg["rungs"]["ask"])
        if span == "N":
            r = V.simulate([self.N[b] for b in BOOKS], cfg, N0, N1)
            return {"trips": r["trips"], "posts": r["posts"], "stats": dict(r["stats"]), "nr": nr, "size": cfg["size"]}
        if span == "F":
            r = V.simulate([self.F[b] for b in BOOKS], cfg, F0, F1)
            return {"trips": r["trips"], "posts": r["posts"], "stats": dict(r["stats"]), "nr": nr, "size": cfg["size"]}
        out = {"trips": [], "posts": [], "stats": collections.Counter(), "nr": nr, "size": cfg["size"]}
        for bi, b in enumerate(BOOKS):
            r = V.simulate([self.N[b]], cfg, P.START[b], WIDE_END)
            out["trips"] += r["trips"]
            out["posts"] += [[p[0], bi, f"{bi}:{p[2]}"] + p[3:] for p in r["posts"]]
            out["stats"].update(r["stats"])
        out["stats"] = dict(out["stats"])
        return out


def summary(res, span, per_book=True):
    nr, size = res["nr"], res["size"]
    cap_book = nr * size
    out = {}
    if span == "N":
        wins = {"IS": (N0, NMID), "OOS": (NMID, N1), "N28": (N0, N1)}
        for w, (a, b) in wins.items():
            days = (b - a) / DAY
            out[w] = pnl_stats(res["trips"], a, b, 2 * cap_book, days)
            if per_book:
                out[w]["by_book"] = {bk: pnl_stats([x for x in res["trips"] if x["book"] == bk], a, b, cap_book, days) for bk in BOOKS}
        out["orders"] = order_stats(res["posts"], N0, N1)
    elif span == "F":
        days = (F1 - F0) / DAY
        out["FRESH"] = pnl_stats(res["trips"], F0, F1, 2 * cap_book, days)
        if per_book:
            out["FRESH"]["by_book"] = {bk: pnl_stats([x for x in res["trips"] if x["book"] == bk], F0, F1, cap_book, days) for bk in BOOKS}
        out["orders"] = order_stats(res["posts"], F0, F1)
    else:
        by = {}
        capyears, tot, per_day = 0.0, 0.0, 0.0
        for bk in BOOKS:
            days = (WIDE_END - P.START[bk]) / DAY
            by[bk] = pnl_stats([x for x in res["trips"] if x["book"] == bk], P.START[bk], WIDE_END, cap_book, days)
            capyears += cap_book * days / 365
            tot += by[bk]["pnl_usd"]
            per_day += by[bk]["pnl_usd"] / days
        allt = res["trips"]
        out["WIDE"] = {"pnl_usd": round(tot, 2), "usd_per_day": round(per_day, 4), "capital_usd": 2 * cap_book,
                       "pct_per_year": round(100 * tot / capyears, 2), "trips": len(allt),
                       "worst_day_usd": min(by[bk]["worst_day_usd"] for bk in BOOKS),
                       "stale_entries": sum(by[bk]["stale_entries"] for bk in BOOKS), "by_book": by}
        out["orders"] = order_stats(res["posts"], P.START["USDC-GBP"], WIDE_END)
    out["stats"] = res["stats"]
    return out


def brief(s, w="IS"):
    x = s[w]
    return f"{w} {x['trips']}t ${x['pnl_usd']:.2f} ${x['usd_per_day']:.3f}/d {x['pct_per_year']}%/yr"


# ------------------------------------------------------------------------------------------------ the null and bootstrap
def null_twins(R, mkts, cfg_kw, rungs, trips, a, b, draws=2000, seed=20260923):
    """PR5's random-time null with the variant's own exit machinery: every trip entered in [a, b) gets a twin that
    enters at the last print of a random minute of its book (with prints and an X) and exits by the variant's rule."""
    cfg = R.cfg({"bid": [], "ask": []}, **cfg_kw)
    cfg["no_entries"] = True
    size = cfg_kw.get("size", 100.0)
    lagx = cfg["lagx_ms"]
    pools = {}
    for bi, bk in enumerate(BOOKS):
        mk = mkts[bk]
        mins = sorted({ts // M * M for ts in mk.pts if a <= ts < b})
        pools[bk] = [m for m in mins if mk.X(m + cfg["phase_ms"], lagx)]
    sel = sorted((x for x in trips if a <= x["t_entry"] < b), key=lambda z: (z["book"], z["t_entry"], z["side"], z["k"]))
    rng = random.Random(seed)
    cache = {}
    out = []
    for _ in range(draws):
        tot = 0.0
        for x in sel:
            bk = x["book"]
            m = pools[bk][rng.randrange(len(pools[bk]))]
            key = (bk, m, x["side"])
            if key not in cache:
                mk = mkts[bk]
                i = V.bisect.bisect_left(mk.pts, m + M) - 1
                last = mk.prints[i]
                xx = mk.X(m + cfg["phase_ms"], lagx)
                usd = min(size, 0.10 * mk.qvol[m] * xx)
                if usd <= 0:
                    cache[key] = 0.0
                else:
                    r = V.simulate([mk], cfg, m - M, min(N1, m + 2 * DAY), collect_posts=False,
                                   inject=(0, x["side"], 0.0, last[1], usd, last[0], xx), stop_when_flat=True)
                    cache[key] = sum(t["pnl_usd"] for t in r["trips"])
            tot += cache[key]
        out.append(tot)
    out.sort()
    act = sum(x["pnl_usd"] for x in sel)
    return {"draws": draws, "seed": seed, "mean": round(stt.mean(out), 4), "p95": round(out[int(0.95 * (draws - 1))], 4),
            "max": round(out[-1], 4), "actual": round(act, 4), "share_draws_ge_actual": round(sum(1 for v in out if v >= act) / draws, 4),
            "distinct_twins": len(cache)}


def block_bootstrap(diff, block, n=10000, seed=20260928):
    rng = random.Random(seed)
    L = len(diff)
    means = []
    for _ in range(n):
        s = []
        while len(s) < L:
            i = rng.randrange(L)
            s += [diff[(i + k) % L] for k in range(block)]
        means.append(sum(s[:L]) / L)
    means.sort()
    return {"block_days": block, "resamples": n, "mean": round(sum(diff) / L, 4), "ci95": [round(means[int(0.025 * n)], 4), round(means[int(0.975 * n)], 4)],
            "p_le_0": round(sum(1 for v in means if v <= 0) / n, 4)}


# ------------------------------------------------------------------------------------------------ main
def main():
    out_dir = sys.argv[1]
    os.makedirs(out_dir, exist_ok=True)
    t_start = time.time()
    R = Runner()
    O = {"inputs": {"pr5_sim.py": sha(os.path.join(HERE, "..", "pr5", "pr5_sim.py")), "pr5v_sim.py": sha(os.path.join(HERE, "pr5v_sim.py")),
                    "study.py": sha(os.path.abspath(__file__))},
         "committed_inputs": {f: sha(os.path.join(P.S, f)) for f in ["config.json", "trades/USDC-GBP.jsonl.gz", "trades/USDT-GBP.jsonl.gz",
                                                                      "fx/series_EXN.json.gz", "candles/USDC-USD_60.json.gz", "candles/USDT-USD_60.json.gz"]},
         "fresh_inputs": {f: sha(os.path.join(FRESH_DIR, f)) for f in sorted(os.listdir(FRESH_DIR)) if f.endswith(".gz")},
         "windows": {"IS": ["2026-08-26T00:00Z", "2026-09-09T18:00Z"], "OOS": ["2026-09-09T18:00Z", "2026-09-23T00:00Z"],
                     "WIDE": {"USDC-GBP": ["2025-11-26T00:00Z", "2026-08-24T00:00Z"], "USDT-GBP": ["2025-12-16T00:00Z", "2026-08-24T00:00Z"]},
                     "FRESH": ["2026-09-23T00:00Z", "2026-09-28T00:00Z"]},
         "timing": {"REF": REF, "live(s, d)": "s_ms=s*1000, delta_ms=d*1000, cancel_ms=d*1000, lagx_ms=5000, phase_ms=5000"}}
    O["fx_yahoo_vs_exness"] = fx_checks(R.ybars)
    print("fx", O["fx_yahoo_vs_exness"], flush=True)

    def full(rungs, spans=("N",), **kw):
        s = {}
        for sp in spans:
            s.update(summary(R.run(sp, rungs, **kw), sp))
            if sp == "N":
                s["orders_N"] = s.pop("orders")
            elif sp == "W":
                s["orders_W"] = s.pop("orders")
            else:
                s["orders_F"] = s.pop("orders")
            s["stats_" + sp] = s.pop("stats")
        return s

    # ---- A. single rungs, today's timing, both caps
    A = {}
    for k in KS:
        for cap in ("shared", "per_rung"):
            A[f"k={k * 100:g}%/{cap}"] = full([k], spans=("N", "W", "F") if cap == "shared" else ("N",), cap=cap)
            print("A", k, cap, brief(A[f"k={k * 100:g}%/{cap}"]), brief(A[f"k={k * 100:g}%/{cap}"], "OOS"), flush=True)
    O["A_single_rungs"] = A

    # ---- B. sets (today's timing, shared cap; the frozen set also under the frozen per-rung cap)
    singles_is = sorted(((A[f"k={k * 100:g}%/shared"]["IS"]["usd_per_day"], k) for k in KS), reverse=True)
    top3 = sorted(k for _, k in singles_is[:3])
    top5 = sorted(k for _, k in singles_is[:5])
    clear8 = sorted(k for k in KS if A[f"k={k * 100:g}%/shared"]["IS"]["pct_per_year"] >= 8.0)
    sets = {"frozen": FROZEN, "davies": DAVIES, "union": UNION, "is_top3": top3, "is_top5": top5, "is_each_over_8pct": clear8}
    O["B_sets_defined"] = {k: [round(x * 100, 4) for x in v] for k, v in sets.items()}
    B = {}
    for name, ks in sets.items():
        B[name + "/shared"] = full(ks, spans=("N", "W", "F"))
        print("B", name, ks, brief(B[name + "/shared"]), brief(B[name + "/shared"], "OOS"), flush=True)
    B["frozen/per_rung"] = full(FROZEN, spans=("N", "W", "F"), cap="per_rung")
    B["frozen/shared_minute_only"] = full(FROZEN, spans=("N",), cap="shared_minute")
    print("B frozen per_rung", brief(B["frozen/per_rung"]), flush=True)
    O["B_sets"] = B
    elig = [(B[n + "/shared"]["IS"]["usd_per_day"], -len(ks), n) for n, ks in sets.items() if B[n + "/shared"]["IS"]["pct_per_year"] >= 8.0]
    chosen_set = max(elig)[2] if elig else "frozen"
    CS = sets[chosen_set]
    O["B_choice"] = {"rule": "highest IS $/day with IS >= 8 %/yr on locked capital; ties to fewer rungs", "chosen": chosen_set,
                     "rungs_pct": [round(x * 100, 4) for x in CS]}
    print("CHOSEN SET", chosen_set, CS, flush=True)

    # ---- C. re-price step, today's timing, for the frozen set and the chosen set
    C = {}
    for nm, ks in (("frozen", FROZEN), ("chosen", CS)):
        for rp in (0.0002, 0.0003, 0.0005, 0.00075, 0.001):
            C[f"{nm}/reprice={rp * 100:g}%"] = full(ks, spans=("N", "W"), reprice=rp)
            s = C[f"{nm}/reprice={rp * 100:g}%"]
            print("C", nm, rp, brief(s), "orders", s["orders_N"]["all"], flush=True)
    O["C_reprice"] = C
    elig = [(C[f"chosen/reprice={rp * 100:g}%"]["IS"]["usd_per_day"], rp) for rp in (0.0002, 0.0003, 0.0005, 0.00075, 0.001)
            if C[f"chosen/reprice={rp * 100:g}%"]["orders_N"]["all"]["max"] < 600]
    RP = max(elig)[1] if elig else 0.001
    O["C_choice"] = {"rule": "highest IS $/day for the chosen set whose busiest day of the 28 stays under 600 POSTs", "reprice_pct": RP * 100}
    print("CHOSEN REPRICE", RP, flush=True)

    # ---- D. cadence and latency
    D = {}
    for nm, ks, rp in (("frozen", FROZEN, 0.0005), ("chosen", CS, RP)):
        D[f"{nm}/REF"] = full(ks, spans=("N",), reprice=rp)
        for d in (1, 2):
            for s in (60, 30, 15, 10, 5, 2, 1):
                D[f"{nm}/s={s}/d={d}"] = full(ks, spans=("N",), reprice=rp, **live(s, d))
                x = D[f"{nm}/s={s}/d={d}"]
                print("D", nm, s, d, brief(x), brief(x, "OOS"), "orders", x["orders_N"]["all"]["mean"], x["orders_N"]["all"]["max"], flush=True)
        # where a fast loop's gain comes from: at s = 1 s, d = 1 s, only some actions may run between minute turns
        for fast in (("exit",), ("exit", "entry"), ("exit", "entry", "reprice")):
            D[f"{nm}/s=1/d=1/fast={'+'.join(fast)}"] = full(ks, spans=("N",), reprice=rp, fast=fast, **live(1, 1))
    O["D_cadence"] = D
    cand = [(s, D[f"chosen/s={s}/d=1"]["IS"]["usd_per_day"]) for s in (60, 30, 15, 10, 5, 2, 1)]
    fastest = cand[-1]
    best = max(cand, key=lambda z: z[1])
    S_CH = fastest[0] if best[1] <= fastest[1] * 1.05 else best[0]
    O["D_choice"] = {"rule": "the fastest cadence unless a slower one beats it on IS by more than 5 %", "s": S_CH}
    print("CHOSEN CADENCE", S_CH, flush=True)

    # ---- E. accounts under the governor (entries withdrawn at 600 POSTs a UTC day a key, only stops from 700)
    gov = {"entry_at": 600, "stop_at": 700}
    accts = {1: lambda book, side: 0, 2: lambda book, side: book, 4: lambda book, side: f"{book}/{side}"}
    E = {}
    cands = []
    for nm, ks in sets.items():
        for rp in (0.0002, 0.0003, 0.0005, 0.001):
            cands.append((nm, ks, rp))
    for na, fn in accts.items():
        best = None
        for nm, ks, rp in cands:
            kw = dict(reprice=rp, gov=gov, acct=fn, **live(S_CH, 1))
            s = full(ks, spans=("N",), **kw)
            E[f"acct={na}/{nm}/reprice={rp * 100:g}%"] = s
            if best is None or s["IS"]["usd_per_day"] > best[0]:
                best = (s["IS"]["usd_per_day"], nm, rp)
        E[f"best_acct={na}"] = {"set": best[1], "reprice_pct": best[2] * 100, "IS_usd_per_day": best[0]}
        b = E[f"acct={na}/{best[1]}/reprice={best[2] * 100:g}%"]
        print("E", na, best, brief(b), brief(b, "OOS"), brief(b, "N28"), flush=True)
    O["E_accounts"] = E

    # ---- 5. the recommendation: the account count whose best configuration has the highest IS $/day (within 5 %,
    #         fewer accounts); then its size, stress, strict exits, fresh and wide arms, the null and the bootstrap.
    #         (This rule was added after stage E had printed its IS and OOS lines; it reads IS only. Disclosed.)
    bestE = {na: E[f"best_acct={na}"] for na in accts}
    top = max(v["IS_usd_per_day"] for v in bestE.values())
    NA = min(na for na, v in bestE.items() if v["IS_usd_per_day"] >= top / 1.05)
    CS, RP = sets[bestE[NA]["set"]], bestE[NA]["reprice_pct"] / 100
    RK = dict(reprice=RP, gov=gov, acct=accts[NA], **live(S_CH, 1))
    O["recommended"] = {"set": bestE[NA]["set"], "rungs_pct": [round(x * 100, 4) for x in CS], "reprice_pct": RP * 100,
                        "s": S_CH, "delta_s": 1, "cancel_s": 1, "lagx_s": 5, "cap": "shared", "size_usd": 100,
                        "accounts": NA, "governor": gov,
                        "rule": "the account count whose best configuration has the highest IS $/day; within 5 %, fewer accounts"}
    print("RECOMMENDED", O["recommended"], flush=True)
    Z = {}
    for size in (100.0, 300.0, 1000.0):
        Z[f"size={int(size)}"] = full(CS, spans=("N", "W", "F"), size=size, **RK)
        print("SIZE", size, brief(Z[f"size={int(size)}"]), brief(Z[f"size={int(size)}"], "OOS"), brief(Z[f"size={int(size)}"], "N28"), flush=True)
    Z["fixed_capital_1200"] = full(CS, spans=("N",), size=1200.0 / (4 * len(CS)), **RK)
    Z["delta=2"] = full(CS, spans=("N", "F"), **dict(RK, **live(S_CH, 2)))
    Z["s=60"] = full(CS, spans=("N",), **dict(RK, **live(60, 1)))
    Z["no_governor"] = full(CS, spans=("N", "W"), **dict(RK, gov=None))
    Z["stress"] = full(CS, spans=("N", "W"), stress=True, **RK)
    Z["strict_exits"] = full(CS, spans=("N",), exit_share=True, **RK)
    Z["frozen_REF"] = full(FROZEN, spans=("N", "W", "F"), cap="per_rung")
    Z["frozen_REF_stress"] = full(FROZEN, spans=("N", "W"), stress=True, cap="per_rung")
    Z["frozen_REF_strict_exits"] = full(FROZEN, spans=("N",), exit_share=True)
    O["Z_recommended_arms"] = Z

    # paired by day against the frozen rule as it runs today (per-rung cap, today's timing) on the same days
    fr = R.run("N", FROZEN, cap="per_rung")
    va = R.run("N", CS, **RK)
    dF, dV = daily(fr["trips"], N0, N1), daily(va["trips"], N0, N1)
    diff = [v - f for v, f in zip(dV, dF)]
    O["paired"] = {"days": len(diff), "frozen_daily": dF, "variant_daily": dV,
                   "bootstrap_1d": block_bootstrap(diff, 1), "bootstrap_7d": block_bootstrap(diff, 7),
                   "days_variant_better": sum(1 for x in diff if x > 1e-12), "days_equal": sum(1 for x in diff if abs(x) <= 1e-12)}
    fr2 = R.run("N", FROZEN, cap="shared", **dict(RK, reprice=0.0005, acct=accts[1]))
    diff2 = [v - f for v, f in zip(dV, daily(fr2["trips"], N0, N1))]
    O["paired_same_timing_and_cap"] = {"what": "variant against the frozen rungs and step at the variant's cadence and cap",
                                       "bootstrap_1d": block_bootstrap(diff2, 1), "bootstrap_7d": block_bootstrap(diff2, 7)}
    print("PAIRED", O["paired"]["bootstrap_1d"], O["paired"]["bootstrap_7d"], O["paired_same_timing_and_cap"]["bootstrap_7d"], flush=True)
    t = time.time()
    nk = dict(reprice=RP, **live(S_CH, 1))
    O["null"] = {"variant_N28": null_twins(R, R.N, nk, CS, va["trips"], N0, N1),
                 "variant_OOS": null_twins(R, R.N, nk, CS, va["trips"], NMID, N1)}
    print("NULL", O["null"], f"{time.time() - t:.0f}s", flush=True)
    O["configurations_run"] = len(N_CONFIGS)
    O["seconds"] = round(time.time() - t_start, 1)
    json.dump(O, open(os.path.join(out_dir, "pr5v_study.json"), "w"), indent=1, sort_keys=True)
    print("done", O["configurations_run"], "configurations", O["seconds"], "s")


if __name__ == "__main__":
    main()
