# An INDEPENDENT re-implementation of the xsmom study's engine, written from
# prereg_xsmom.md (sections 2, 3, 5 and correction 1), not from
# backtest_xsmom.ts. It rebuilds the point-in-time universe, the benchmarks and
# the candidates' chosen paths, re-runs the in-sample choice for C7 and one
# filter variant, and compares every number with docs/agents/backtests/xsmom.json.
# Pure Python (no numpy). Reads only local files.
import json, glob, os, datetime, statistics, sys

S = os.environ.get("XSMOM_WORK") or sys.exit("set XSMOM_WORK to a working directory: binance_klines/ lives under it")
W = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))   # the repository root
X = json.load(open(f"{W}/docs/agents/backtests/xsmom.json"))
DAY = 86400
iso = lambda d: datetime.datetime.fromtimestamp(d * DAY, datetime.timezone.utc).strftime("%Y-%m-%d")
dnum = lambda s: int(datetime.datetime.strptime(s, "%Y-%m-%d").replace(tzinfo=datetime.timezone.utc).timestamp()) // DAY

# ── data, segments (every missing day starts a new segment) ────────────
excluded = {e["symbol"] for e in X["inputs"]["excluded"]}
series = {}
for p in sorted(glob.glob(f"{S}/binance_klines/daily/*.json")):
    s = os.path.basename(p)[:-5]
    rows = json.load(open(p))
    days = [r[0] // DAY for r in rows]
    seg_first = {}
    first = days[0]
    for i, d in enumerate(days):
        if i and d - days[i - 1] > 1:
            first = d
        seg_first[d] = first
    seg_last = set()
    for i, d in enumerate(days):
        if i + 1 < len(days) and days[i + 1] - d > 1:
            seg_last.add(d)
    series[s] = {"o": {r[0] // DAY: r[1] for r in rows}, "c": {r[0] // DAY: r[4] for r in rows}, "qv": {r[0] // DAY: r[6] for r in rows},
                 "first": seg_first, "segend": seg_last, "last": days[-1]}
LAST = max(v["last"] for v in series.values())
for s, v in series.items():
    if v["last"] < LAST:
        v["segend"].add(v["last"])

# ── costs (prereg section 5) ────────────────────────────────────────────
samples = [json.loads(l) for l in open(f"{W}/docs/agents/backtests/inputs/binance_books_2026-09-23/binance_cost_bookticker_samples.jsonl")]
med = {}
for s in samples[0]["binance"]:
    v = [r["binance"][s]["bps"] for r in samples if r["binance"].get(s) and r["binance"][s].get("bps")]
    v = [x for x in v if x and x > 0]
    if v:
        med[s] = statistics.median(v)
UNMEAS = max(med.values())
half = lambda s, mult=1.0: (med.get(s, UNMEAS) / 2 / 1e4) * mult

# ── universe (prereg section 2) ──────────────────────────────────────────
def eligible(s, d):
    v = series[s]
    if s in excluded or d not in v["c"]:
        return False
    f = v["first"][d]
    if d - f + 1 < 100:
        return False
    return all((d - k) in v["c"] and v["first"][d - k] == f for k in range(30))

ucache = {}
def universe(d, N=30):
    key = (d, N)
    if key not in ucache:
        el = [(-sum(series[s]["qv"][d - k] for k in range(30)), s) for s in series if eligible(s, d)]
        el.sort()
        ucache[key] = [s for _, s in el[:N]]
    return ucache[key]

def close_at(s, d):
    v = series[s]
    f = v["first"].get(d)
    x = d
    while x not in v["c"]:
        x -= 1
    return v["c"][x]

def ret_l(s, d, L): return series[s]["c"][d] / close_at(s, d - L) - 1
def sma(s, d, n): return sum(close_at(s, d - k) for k in range(n)) / n
def btc_on(d): return not (series["BTCUSDT"]["c"][d] < sma("BTCUSDT", d, 200))

# ── the engine (prereg section 3) ───────────────────────────────────────
def run(frm, to, k, pick, fee_bps=10.0, mult=1.0, min_usd=5.0, wd=0):
    fee = fee_bps / 1e4
    cash, pos = 100.0, {}
    peak, dd, traded, fees, spr, fills = 100.0, 0.0, 0.0, 0.0, 0.0, 0
    j = 0
    eq = []
    for D in range(frm, to + 1):
        is_rb = D == frm or (D - 4 - wd) % 7 == 0
        if is_rb:
            d = D - 1
            U = universe(d)
            tgt = pick(j, d, U, sorted(pos))
            if tgt is not None:
                tset = set(tgt)
                for s in sorted(pos):
                    if s not in tset and D in series[s]["o"]:
                        px, h = series[s]["o"][D], half(s, mult)
                        g = pos[s] * px * (1 - h)
                        cash += g * (1 - fee); traded += g; fees += g * fee; spr += pos[s] * px * h; fills += 1
                        del pos[s]
                E = cash + sum(u * (series[s]["o"][D] if D in series[s]["o"] else close_at(s, D)) for s, u in pos.items())
                V = E / k
                buys = []
                for s in tgt:
                    if D not in series[s]["o"]:
                        continue
                    px = series[s]["o"][D]
                    u = pos.get(s, 0.0)
                    delta = V - u * px
                    if u > 0:
                        if abs(delta) < max(min_usd, 1e-9):
                            continue
                        if delta < 0:
                            h = half(s, mult); us = -delta / px; g = us * px * (1 - h)
                            cash += g * (1 - fee); traded += g; fees += g * fee; spr += us * px * h; fills += 1
                            pos[s] = u - us
                        else:
                            buys.append((s, delta))
                    else:
                        if V < max(min_usd, 1e-9):
                            continue
                        buys.append((s, V))
                need = sum(x * (1 + fee) for _, x in buys)
                f = (cash / need if need > 0 else 1.0) if need > cash else 1.0  # need = 0 with cash = -1e-15 leaves nothing to scale
                for s, x0 in buys:
                    x = x0 * f
                    if s not in pos and x < min_usd:
                        continue
                    px, h = series[s]["o"][D], half(s, mult)
                    u = x / (px * (1 + h))
                    cash -= x * (1 + fee); traded += x; fees += x * fee; spr += u * px * h; fills += 1
                    pos[s] = pos.get(s, 0.0) + u
                j += 1
        for s in sorted(pos):
            if D in series[s]["segend"]:
                px, h = series[s]["c"][D], half(s, mult)
                g = pos[s] * px * (1 - h)
                cash += g * (1 - fee); traded += g; fees += g * fee; spr += pos[s] * px * h; fills += 1
                del pos[s]
        e = cash + sum(u * close_at(s, D) for s, u in pos.items())
        eq.append(e)
        peak = max(peak, e); dd = max(dd, 1 - e / peak)
    return {"ret": eq[-1] / 100 - 1, "maxDD": dd, "traded": traded, "fee": fees, "spread": spr, "fills": fills, "eq": eq}

def rule(k, L, ab, reg):
    def pick(j, d, U, held):
        if reg and not btc_on(d):
            return []
        r = sorted(U, key=lambda s: (-ret_l(s, d, L), s))[:k]
        if ab == "ret":
            r = [s for s in r if ret_l(s, d, L) > 0]
        elif ab == "ma":
            r = [s for s in r if series[s]["c"][d] > sma(s, d, 100)]
        return r
    return pick

WIN = {w: (dnum(v["oos"].split(" → ")[0]), dnum(v["oos"].split(" → ")[1])) for w, v in X["definitions"]["windows"].items()}
IS_START = dnum(X["definitions"]["isStart"])
worst = 0.0
def check(label, got, want, tol=6e-5):
    global worst
    diff = abs(got - want)
    worst = max(worst, diff)
    flag = "" if diff <= tol else "   <-- MISMATCH"
    print(f"  {label:48s} here {got: .6f}  json {want: .6f}  |Δ| {diff:.2e}{flag}")

print("1. universe membership (every Monday and window start, 2019-07-01 → A's end)")
ever = {}
days = [D for D in range(IS_START, WIN["A"][1] + 1) if (D - 4) % 7 == 0 or D in [v[0] for v in WIN.values()]]
for D in days:
    for s in universe(D - 1):
        e = ever.setdefault(s, [D, D, 0]); e[1] = D; e[2] += 1
jx = {e["symbol"]: e for e in X["inputs"]["everInUniverse"]}
same = set(ever) == set(jx)
bad = [s for s in ever if s in jx and (iso(ever[s][0]) != jx[s]["firstInUniverse"] or iso(ever[s][1]) != jx[s]["lastInUniverse"] or ever[s][2] != jx[s]["decisionsInUniverse"])]
print(f"  pairs ever in the universe: here {len(ever)}, json {len(jx)}; same set {same}; first/last/count mismatches {len(bad)}")

print("2. benchmarks")
for w, (a, b) in WIN.items():
    bt = run(a, b, 1, lambda j, d, U, h: ["BTCUSDT"] if j == 0 else None, min_usd=0.0)
    check(f"BTC buy-and-hold {w} ret", bt["ret"], X["benchmarks"][w]["btcBuyAndHold"]["ret"])
    ew = run(a, b, 30, lambda j, d, U, h: U, min_usd=0.0)
    check(f"universe equal-weight {w} ret", ew["ret"], X["benchmarks"][w]["universeEqualWeight"]["ret"])
    check(f"universe equal-weight {w} maxDD", ew["maxDD"], X["benchmarks"][w]["universeEqualWeight"]["maxDD"])

print("3. every candidate's chosen path, every window (return, drawdown, traded $, fees $, spread $, fills)")
for c in X["candidates"]:
    for w, v in c["perWindow"].items():
        ch = v["chosen"]
        a, b = WIN[w]
        r = run(a, b, ch["k"], rule(ch["k"], ch["L"], ch["abs"], ch["regime"] == "on"))
        o = v["outOfSample"]
        check(f"{c['id']} {w} k{ch['k']} L{ch['L']} {ch['abs']} {ch['regime']} ret", r["ret"], o["ret"])
        check(f"{c['id']} {w} maxDD", r["maxDD"], o["maxDD"])
        check(f"{c['id']} {w} traded $", r["traded"], o["tradedUsd"], 6e-4)
        check(f"{c['id']} {w} fee $", r["fee"], o["feeUsd"], 6e-4)
        check(f"{c['id']} {w} spread $", r["spread"], o["spreadUsd"], 6e-4)
        if r["fills"] != o["fills"]:
            print(f"  {c['id']} {w} fills here {r['fills']} json {o['fills']}   <-- MISMATCH"); worst = max(worst, 1)

print("4. the in-sample choice, re-run: C7 over all 36 points, windows A and D")
grid = [(ab, reg, k, L) for ab in ["none", "ret", "ma"] for reg in [False, True] for k in [3, 5] for L in [7, 14, 28]]
for w in ["A", "D"]:
    best, bs = None, -1e18
    for (ab, reg, k, L) in grid:
        r = run(IS_START, WIN[w][0] - 1, k, rule(k, L, ab, reg))
        s = r["ret"] / max(0.05, r["maxDD"])
        if s > bs:
            bs, best = s, (ab, reg, k, L)
    ch = X["candidates"][6]["perWindow"][w]["chosen"]
    want = (ch["abs"], ch["regime"] == "on", ch["k"], ch["L"])
    print(f"  C7 window {w}: here {best} score {bs:.4f}; json {want} score {X['candidates'][6]['perWindow'][w]['inSample']['score']}  {'same' if best == want else 'DIFFERENT'}")
    if best != want: worst = max(worst, 1)

print(f"\nworst |Δ| over every compared number: {worst:.2e}")
sys.exit(0 if worst <= 6e-4 else 1)
