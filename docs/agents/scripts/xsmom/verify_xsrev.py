# An INDEPENDENT re-implementation of the xsrev study (cross-sectional reversal
# and low volatility), written from its pre-registration
# (docs/agents/reviews/2026-09-23-binance-xsrev-prereg.md, sections 2-5), not
# from backtest_xsrev.ts. It rebuilds the point-in-time universe, the three
# benchmarks, every candidate's out-of-sample daily equity path, R3's and V3's
# in-sample choices, and the first ten matched-null draws of every candidate
# window, and compares each with docs/agents/backtests/xsrev.json.
# Pure Python (no numpy). Reads only local files.
import datetime, glob, hashlib, json, math, os, statistics, sys

S = os.environ.get("XSMOM_WORK") or sys.exit("set XSMOM_WORK to a working directory: binance_klines/ lives under it")
W = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))   # the repository root
OUT = json.load(open(f"{W}/docs/agents/backtests/xsrev.json"))
XSMOM = json.load(open(f"{W}/docs/agents/backtests/xsmom.json"))
iso = lambda d: datetime.datetime.fromtimestamp(d * 86400, datetime.timezone.utc).strftime("%Y-%m-%d")
dnum = lambda s: int(datetime.datetime.strptime(s, "%Y-%m-%d").replace(tzinfo=datetime.timezone.utc).timestamp()) // 86400
M32 = 0xFFFFFFFF
worst = {}
def note(key, a, b):
    worst[key] = max(worst.get(key, 0.0), abs(a - b))

# ── data (prereg §2): every missing day starts a new segment ─────────────
man = json.load(open(f"{S}/binance_klines/manifest.json"))
syms = sorted(man["daily"])
rows = {}
for s in syms:
    p = f"{S}/binance_klines/daily/{s}.json"
    if hashlib.sha256(open(p, "rb").read()).hexdigest() != man["daily"][s]["sha256"]:
        sys.exit(f"{s}: not the manifest's file")
    rows[s] = json.load(open(p))
DAY0 = min(r[0][0] // 86400 for r in rows.values())
LAST = max(r[-1][0] // 86400 for r in rows.values())
N_DAYS = LAST - DAY0 + 1
O, C, QV, FIRST, SEGEND = {}, {}, {}, {}, {}
for s in syms:
    o = [None] * N_DAYS; c = [None] * N_DAYS; q = [0.0] * N_DAYS; f = [None] * N_DAYS
    days = [r[0] // 86400 - DAY0 for r in rows[s]]
    first = days[0]
    ends = set()
    for i, r in enumerate(rows[s]):
        d = days[i]
        if i and d - days[i - 1] > 1:
            ends.add(days[i - 1]); first = d
        o[d] = r[1]; c[d] = r[4]; q[d] = r[6]; f[d] = first
    if days[-1] + DAY0 < LAST:
        ends.add(days[-1])
    O[s], C[s], QV[s], FIRST[s], SEGEND[s] = o, c, q, f, ends
excluded = {e["symbol"] for e in XSMOM["inputs"]["excluded"]}   # xsmom's lists (the prereg adopts them)

# ── costs (prereg §3) ────────────────────────────────────────────────────
samples = [json.loads(l) for l in open(f"{W}/docs/agents/backtests/inputs/binance_books_2026-09-23/binance_cost_bookticker_samples.jsonl")]
med = {}
for s in samples[0]["binance"]:
    v = [r["binance"][s]["bps"] for r in samples if r["binance"].get(s) and isinstance(r["binance"][s].get("bps"), (int, float))]
    v = [x for x in v if x > 0]
    if v:
        med[s] = statistics.median(v)
WIDEST = max(med.values())
def half_spread(s, mult): return med.get(s, WIDEST) / 2 / 1e4 * mult

# ── universe (prereg §2) ─────────────────────────────────────────────────
def eligible(s, d):   # d = day offset
    if s in excluded or d - 29 < 0 or C[s][d] is None:
        return False
    f = FIRST[s][d]
    if d - f + 1 < 100:
        return False
    return all(C[s][x] is not None and FIRST[s][x] == f for x in range(d - 29, d + 1))
_u = {}
def universe(d):
    if d not in _u:
        el = sorted(((-math.fsum(QV[s][d - 29:d + 1]), s) for s in syms if eligible(s, d)))
        _u[d] = [s for _, s in el[:30]]
    return _u[d]

# ── windows, calendar (prereg §3) ────────────────────────────────────────
WIN = {"A": ("2025-09-10", "2026-09-19"), "B": ("2024-08-31", "2025-09-09"), "C": ("2023-08-22", "2024-08-30"), "D": ("2022-08-22", "2023-08-21")}
WIN = {w: (dnum(a) - DAY0, dnum(b) - DAY0) for w, (a, b) in WIN.items()}
IS_START = dnum("2019-07-01") - DAY0
def monday(d, wd=0): return (d + DAY0 - 4 - wd) % 7 == 0   # 1970-01-05 was a Monday

# ── signals (prereg §4) ──────────────────────────────────────────────────
def ret_l(s, d, L): return C[s][d] / C[s][d - L] - 1
def vol30(s, d):
    x = [C[s][t] / C[s][t - 1] - 1 for t in range(d - 29, d + 1)]
    assert FIRST[s][d - 30] == FIRST[s][d]
    m = sum(x) / 30
    return math.sqrt(sum((v - m) ** 2 for v in x) / 29)
def btc_on(d): return not (C["BTCUSDT"][d] < sum(C["BTCUSDT"][d - 199:d + 1]) / 200)
def rule(fam, k, L, regime):
    def pick(j, d, U, held):
        if regime and not btc_on(d):
            return []
        sig = (lambda s: ret_l(s, d, L)) if fam == "rev" else (lambda s: vol30(s, d))
        return [s for _, s in sorted((sig(s), s) for s in U)[:k]]
    return pick

# ── the engine (prereg §3) ───────────────────────────────────────────────
def simulate(frm, to, k, pick, fee_bps=10, mult=1.0, min_usd=5.0, wd=0):
    fee = fee_bps / 1e4
    tiny = max(min_usd, 1e-9)
    cash, hold = 100.0, {}          # symbol -> units (insertion ordered)
    eq, m, keep, fills, fee_usd, spread_usd = [], [], [], 0, 0.0, 0.0
    j = 0
    def sell(s, u, px):
        nonlocal cash, fills, fee_usd, spread_usd
        h = half_spread(s, mult)
        gross = u * px * (1 - h)
        cash += gross * (1 - fee); fee_usd += gross * fee; spread_usd += u * px * h; fills += 1
        hold[s] -= u
    for D in range(frm, to + 1):
        if D == frm or monday(D, wd):
            d = D - 1
            U = universe(d)
            held = sorted(hold)
            target = pick(j, d, U, held)
            if target is not None:
                m.append(len(target)); keep.append(sum(1 for s in held if s in target))
                for s in reversed(list(hold)):                       # exits, whole, at the open
                    if s not in target and O[s][D] is not None:
                        sell(s, hold[s], O[s][D]); del hold[s]
                E = cash + sum(u * (O[s][D] if O[s][D] is not None else C[s][D]) for s, u in hold.items())
                V = E / k
                buys = []
                for s in target:
                    if O[s][D] is None:
                        continue
                    px = O[s][D]
                    if s in hold:
                        delta = V - hold[s] * px
                        if abs(delta) < tiny:
                            continue
                        if delta < 0:
                            sell(s, -delta / px, px)
                        else:
                            buys.append((s, delta))
                    elif V >= tiny:
                        buys.append((s, V))
                need = sum(x * (1 + fee) for _, x in buys)
                f = cash / need if need > cash and need > 0 else 1.0   # no buys: nothing to scale
                for s, x0 in buys:
                    x = x0 * f
                    if s not in hold and x < min_usd:
                        continue
                    px, h = O[s][D], half_spread(s, mult)
                    cash -= x * (1 + fee); fee_usd += x * fee; spread_usd += x / (px * (1 + h)) * px * h; fills += 1
                    hold[s] = hold.get(s, 0.0) + x / (px * (1 + h))
                j += 1
        for s in reversed(list(hold)):                               # a segment's last day: sold at its close
            if D in SEGEND[s]:
                sell(s, hold[s], C[s][D]); del hold[s]
        eq.append(cash + sum(u * C[s][D] for s, u in hold.items()))
    peak, dd = 100.0, 0.0
    for e in eq:
        peak = max(peak, e); dd = max(dd, 1 - e / peak)
    return {"eq": eq, "ret": eq[-1] / 100 - 1, "maxDD": dd, "m": m, "keep": keep, "fills": fills, "fee": fee_usd, "spread": spread_usd}

# ── the null's random numbers (backtest_jev.ts's seedOf / mulberry32) ────
def seed_of(*parts):
    h = 0x811C9DC5
    for ch in "|".join(str(p) for p in parts):
        h = ((h ^ ord(ch)) * 0x01000193) & M32
    return h
def mulberry32(seed):
    st = [seed & M32]
    def rng():
        a = st[0] = (st[0] + 0x6D2B79F5) & M32
        t = ((a ^ (a >> 15)) * (1 | a)) & M32
        t = ((t + (((t ^ (t >> 7)) * (61 | t)) & M32)) & M32) ^ t
        return ((t ^ (t >> 14)) & M32) / 4294967296
    return rng
def sample(xs, n, rng):
    a = list(xs)
    k = min(n, len(a))
    for i in range(k):
        r = i + math.floor(rng() * (len(a) - i))
        a[i], a[r] = a[r], a[i]
    return a[:k]
def matched_null(m, keep, rng):
    def pick(j, d, U, held):
        inU = set(U)
        A = [s for s in held if s in inU]
        n_keep = min(keep[j], len(A), m[j])
        kept = sample(A, n_keep, rng)
        fill = sample([s for s in U if s not in held], m[j] - n_keep, rng)
        if len(fill) < m[j] - n_keep:
            fill += sample([s for s in A if s not in kept], m[j] - n_keep - len(fill), rng)
        return kept + fill
    return pick

# ── 1. the universe ──────────────────────────────────────────────────────
dec = sorted({D for D in range(IS_START, WIN["A"][1] + 1) if monday(D)} | {a for a, _ in WIN.values()})
ever = {}
for D in dec:
    for s in universe(D - 1):
        e = ever.setdefault(s, [D, D, 0]); e[1] = D; e[2] += 1
mine = {s: (iso(a + DAY0), iso(b + DAY0), n) for s, (a, b, n) in ever.items()}
theirs = {e["symbol"]: (e["firstInUniverse"], e["lastInUniverse"], e["decisionsInUniverse"]) for e in OUT["inputs"]["everInUniverse"]}
uni_ok = mine == theirs
print(f"universe: {len(mine)} pairs ever in it (xsrev.json {len(theirs)}); first / last / decisions identical: {uni_ok}")

# ── 2. the benchmarks ────────────────────────────────────────────────────
four = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT"]
def four_pick(j, d, U, held):
    el = sorted((-ret_l(s, d, 28), s) for s in four if eligible(s, d))[:2]
    return [s for _, s in el if C[s][d] > sum(C[s][d - 99:d + 1]) / 100]
bench_ok = True
for w, (a, b) in WIN.items():
    ew = simulate(a, b, 30, lambda j, d, U, held: U, min_usd=0)
    bh = simulate(a, b, 1, lambda j, d, U, held: ["BTCUSDT"] if j == 0 else None, min_usd=0)
    fc = simulate(a, b, 2, four_pick)
    for name, r, ref in [("ew", ew, OUT["benchmarks"][w]["universeEqualWeight"]), ("btc", bh, OUT["benchmarks"][w]["btcBuyAndHold"]), ("four", fc, OUT["fourCoinControl"]["perWindow"][w])]:
        note("benchmark ret", r["ret"], ref["ret"]); note("benchmark maxDD", r["maxDD"], ref["maxDD"])
        note("benchmark fees $", r["fee"], ref["feeUsd"]); note("benchmark spread $", r["spread"], ref["spreadUsd"])
        bench_ok &= r["fills"] == ref["fills"]
print(f"benchmarks (top-30 equal weight, BTC held, four-coin control) A–D: fills identical {bench_ok}; worst |Δ| ret {worst['benchmark ret']:.2g}, maxDD {worst['benchmark maxDD']:.2g}")

# ── 3. the candidates: in-sample choice, out-of-sample paths, first null draws ──
def key(fam, k, L, regime): return f"rev-k{k}-L{L}-{'on' if regime else 'off'}" if fam == "rev" else f"vol-k{k}-{'on' if regime else 'off'}"
def score(r): return r["ret"] / max(0.05, r["maxDD"])
def choose(points, w):
    best, bs = None, -math.inf
    for p in points:
        r = simulate(IS_START, WIN[w][0] - 1, p[1], rule(*p))
        note("in-sample score (grid)", score(r), next(g for g in OUT["grid"] if g["point"] == key(*p))["inSample"][w]["score"])
        if score(r) > bs:
            best, bs = p, score(r)
    return best
rev9 = [("rev", k, L, False) for k in (3, 5, 10) for L in (3, 7, 14)]
vol3 = [("vol", k, 0, False) for k in (3, 5, 10)]
cands = {"R1": ("rev", 5, 7, False), "R2": ("rev", 5, 7, True), "R3": rev9, "V1": ("vol", 5, 0, False), "V2": ("vol", 5, 0, True), "V3": vol3}
choice_ok, fills_ok, draws = True, True, 0
for c in OUT["candidates"]:
    spec = cands[c["id"]]
    for w in "ABCD":
        p = choose(spec, w) if isinstance(spec, list) else spec
        pw = c["perWindow"][w]
        choice_ok &= key(*p) == pw["chosen"]
        r = simulate(WIN[w][0], WIN[w][1], p[1], rule(*p))
        path = pw["equityPath"]
        if len(path) != len(r["eq"]):
            sys.exit(f"{c['id']} {w}: path length {len(r['eq'])} vs {len(path)}")
        for a, b in zip(r["eq"], path):
            note("candidate equity path ($)", a, b)
        note("candidate ret", r["ret"], pw["outOfSample"]["ret"]); note("candidate maxDD", r["maxDD"], pw["outOfSample"]["maxDD"])
        note("candidate fees $", r["fee"], pw["outOfSample"]["feeUsd"]); note("candidate spread $", r["spread"], pw["outOfSample"]["spreadUsd"])
        fills_ok &= r["fills"] == pw["outOfSample"]["fills"]
        for jd, want in enumerate(pw["null"]["firstDraws"]):
            nr = simulate(WIN[w][0], WIN[w][1], p[1], matched_null(r["m"], r["keep"], mulberry32(seed_of("xsrev-null", key(*p), w, jd))))
            note("null draw ret", nr["ret"], want); draws += 1
        print(f"  {c['id']} {w}: {key(*p)} ret {r['ret'] * 100:+.2f} % (xsrev.json {pw['outOfSample']['ret'] * 100:+.2f} %), maxDD {r['maxDD'] * 100:.2f} %")
print(f"candidates: in-sample choices identical {choice_ok}; fills identical {fills_ok}; {draws} null draws recomputed")
for k_, v in sorted(worst.items()):
    print(f"  worst |Δ| {k_}: {v:.3g}")
ok = uni_ok and bench_ok and choice_ok and fills_ok and all(v < (2e-6 if "path" in k_ or "draw" in k_ else 1e-4) for k_, v in worst.items())
print("VERIFIED" if ok else "MISMATCH")
sys.exit(0 if ok else 1)
