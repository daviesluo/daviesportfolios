"""L2: on the live recording, how often the Polymarket book offers a side below its fair price after the taker fee, how
long that lasts, how much size sits there, and what a taker who acts L seconds late would have made.

Fair price: the model of model.py in Chainlink space. S_now = Coinbase mid now x b, b the median over the last 120 s of
Chainlink / Coinbase at the same SOURCE second (Chainlink arrives ~2-3 s after Coinbase, l1_leadlag). K is Gamma's
priceToBeat; inside the last 60 s the averaged part A is the Chainlink values already published plus S_now for the
seconds not yet published. Variance a second: k x the Binance 1 s realised variance of the last 1,800 s (k = 1.75 for
5m, 2.5 for 15m, h1_model_fit). The grid is 100 ms of RECEIVE time on this machine.

An episode: consecutive grid points where buying a side at its best ask leaves fair - ask - fee >= margin. A taker
deciding at the episode's first point sends a limit at that ask; L seconds later it fills against the levels at or
below the limit then on the book (Up asks, or Up bids for a Down buy), up to its size; P&L = outcome - price - fee.
DRIVER (environment, default cb) picks the fast feed in place of Coinbase: bf (Binance USD-M perp), bs (Binance spot) or
hb (Hyperliquid perp), read from REF2 (environment: recorder2.py's file); the basis to Chainlink is then that feed's.
Usage: l2_opportunities.py ref.jsonl clob.jsonl binance_1s.json.gz outcomes.json out.json"""
import json, sys, os, bisect, math, statistics as st, datetime
sys.path.insert(0, os.path.dirname(__file__)); import model
ref = [json.loads(l) for l in open(sys.argv[1])]; clob = [json.loads(l) for l in open(sys.argv[2])]
B = model.load_binance(sys.argv[3]); OUTC = json.load(open(sys.argv[4]))
K_MULT = {300: 1.75, 900: 2.5}
def iso_ms(s):
    return int(datetime.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp() * 1000)
DRIVER = os.environ.get("DRIVER", "cb")
if DRIVER == "cb":
    cb = [(r["t"], (r["b"] + r["a"]) / 2, iso_ms(r["ts"])) for r in ref if r["k"] == "cb"]
else:  # the source stamp: Binance perp's match time, Hyperliquid's time; Binance spot has none, so its receive time
    cb = [(r["t"], (r["b"] + r["a"]) / 2, r.get("ts") or r["t"]) for r in map(json.loads, open(os.environ["REF2"])) if r["k"] == DRIVER]
cb_t = [x[0] for x in cb]; cb_src = sorted((x[2], x[1]) for x in cb); cb_src_t = [x[0] for x in cb_src]
cl = sorted({r["ts"] // 1000: (r["p"], r["t"]) for r in ref if r["k"] == "cl"}.items())  # source second -> (price, recv)
cl_sec = [x[0] for x in cl]; cl_recv = sorted((x[1][1], x[0]) for x in cl)
def cb_at_src(ms):
    i = bisect.bisect_right(cb_src_t, ms) - 1
    return cb_src[i][1] if i >= 0 else None
ratio = []  # (recv time at which the ratio became known, ratio)
for sec, (p, recv) in cl:
    c = cb_at_src(sec * 1000)
    if c: ratio.append((recv, p / c))
ratio_t = [x[0] for x in ratio]
def basis(t):
    i = bisect.bisect_right(ratio_t, t)
    w = [x[1] for x in ratio[max(0, i - 120):i]]
    return st.median(w) if w else None
def s_now(t):
    i = bisect.bisect_right(cb_t, t) - 1; b = basis(t)
    return cb[i][1] * b if i >= 0 and b and t - cb[i][0] <= 5000 else None  # a stale feed (a gap) gives no price
def cl_published(t):  # Chainlink seconds received by t: {sec: price}
    i = bisect.bisect_right([x[0] for x in cl_recv], t)
    return i
cl_recv_t = [x[0] for x in cl_recv]; cl_map = {sec: p for sec, (p, _) in cl}
def fair_up(t, s, e, Kp):
    S = s_now(t)
    if S is None: return None
    sec = t // 1000; tau = e - t / 1000
    v = K_MULT[e - s] * model.rv1(B, sec - 1)
    if tau <= 0: return None
    if tau >= 60:
        mu, sd = S, S * math.sqrt(v * (tau - 40))
    else:
        # the 60 s average at e: Chainlink seconds published by t, S for the rest of (e-60, sec], then the future part
        n_pub = bisect.bisect_right(cl_recv_t, t); pub = {sec_: cl_map[sec_] for _, sec_ in cl_recv[:n_pub] if e - 60 < sec_ <= sec}
        A = sum(pub.get(u, S) for u in range(e - 59, sec + 1))
        rem = e - sec
        mu = (A + rem * S) / 60; sd = S * math.sqrt(v * rem ** 3 / 3) / 60
    return model.Phi((mu - Kp) / sd) if sd > 0 else (1.0 if mu >= Kp else 0.0)
# books by window, by receive time
books = {}
for r in clob:
    if r["k"] == "bk": books.setdefault(r["m"], []).append((r["t"], r["bb"], r["ba"]))
book_times = {}
def book_at(m, t):
    # None when the newest record is over 10 s old: the recording has a gap (the container restarted at 21:06 UTC)
    v = books.get(m)
    if not v: return None
    ts = book_times.get(m)
    if ts is None: ts = book_times[m] = [x[0] for x in v]
    i = bisect.bisect_right(ts, t) - 1
    return v[i] if i >= 0 and t - v[i][0] <= 10000 else None
trades = {}
for r in clob:
    if r["k"] == "tr": trades.setdefault(r["m"], []).append((r["t"], r["a"], r["p"]))
def first_print(m, t0, side, px, horizon=30000):
    for t, a, p in trades.get(m, []):
        if t < t0 or t > t0 + horizon: continue
        if (side == "Up" and ((a == "Up" and p <= px + 1e-9) or (a == "Down" and p >= 1 - px - 1e-9))) or \
           (side == "Down" and ((a == "Down" and p <= px + 1e-9) or (a == "Up" and p >= 1 - px - 1e-9))):
            return (t - t0) / 1000
    return None
def mid_side(m, t, side):
    b = book_at(m, t)
    if not b or not b[1] or not b[2]: return None
    mu = (b[1][0][0] + b[2][0][0]) / 2
    return mu if side == "Up" else 1 - mu
MARGINS = (0.0, 0.02, 0.05); LAGS = (0.0, 0.1, 0.25, 0.5, 1.0, 2.0, 5.0); SIZES = (100, 1000)  # dollars a trade
t_lo = max(cb[0][0], cl_recv[0][0]) + 130000; t_hi = min(cb[-1][0], cl_recv[-1][0])
res = {f"m{m}": {"episodes": 0, "durations_s": [], "edge_at_start": [], "usd_at_touch": [], "by_lag": {}, "first_print_s": [], "no_print_30s": 0, "per_window": {}} for m in MARGINS}
grid_points = {300: 0, 900: 0}; scanned_windows = set()
for slug, v in books.items():
    if not slug.startswith("btc-updown-"): continue  # the hourly books of the first minutes are not studied
    dur = 300 if "-5m-" in slug else 900; s = int(slug.rsplit("-", 1)[1]); e = s + dur
    o = OUTC.get(slug)
    if not o or o.get("up_won") is None or o.get("priceToBeat") is None: continue
    Kp = o["priceToBeat"]; y_up = o["up_won"]
    times = [x[0] for x in v]
    open_ep = {m: None for m in MARGINS}
    t = max(s * 1000, t_lo)
    while t < min(e * 1000 - 500, t_hi):
        bk = book_at(slug, t); q = fair_up(t, s, e, Kp) if bk else None
        if bk and q is not None and bk[1] and bk[2]:
            scanned_windows.add(slug); grid_points[dur] += 1
            ask_up = bk[2][0][0]; ask_dn = 1 - bk[1][0][0]
            cand = [(q - ask_up - model.fee(ask_up), "Up", ask_up, bk[2][0][1]), ((1 - q) - ask_dn - model.fee(ask_dn), "Down", ask_dn, bk[1][0][1])]
            edge, side, px, sz = max(cand)
            for m in MARGINS:
                if edge >= m and (open_ep[m] is None or open_ep[m]["side"] != side):
                    if open_ep[m] is not None:
                        res[f"m{m}"]["durations_s"].append((t - open_ep[m]["t"]) / 1000)
                    open_ep[m] = {"t": t, "side": side, "px": px}
                    R = res[f"m{m}"]; R["episodes"] += 1; R["edge_at_start"].append(edge); R["usd_at_touch"].append(sz * px)
                    y = y_up if side == "Up" else (not y_up)
                    fp = first_print(slug, t, side, px)
                    if fp is None: R["no_print_30s"] += 1
                    else: R["first_print_s"].append(fp)
                    for L in LAGS:
                        b2 = book_at(slug, t + int(L * 1000))
                        lv = (b2[2] if side == "Up" else [(round(1 - p, 4), s_) for p, s_ in b2[1]]) if b2 else []
                        avail = [(p, s_) for p, s_ in lv if p <= px + 1e-9]
                        for cap in SIZES:
                            want = cap / px; got = 0; cost = 0; fee = 0
                            for p, s_ in avail:
                                take = min(s_, want - got)
                                if take <= 0: break
                                got += take; cost += take * p; fee += take * model.fee(p)
                            a = R["by_lag"].setdefault(f"L{L}|${cap}", [0, 0, 0.0, 0.0, 0.0, 0.0, 0.0])
                            a[0] += 1
                            if got > 0:
                                a[1] += 1; a[2] += got; a[3] += got * (1 if y else 0) - cost - fee; a[4] += cost
                                for j, H in ((5, 5000), (6, 30000)):
                                    mid = mid_side(slug, t + int(L * 1000) + H, side)
                                    a[j] += got * (mid if mid is not None else (1 if y else 0)) - cost - fee
                                pw = R["per_window"].setdefault(f"L{L}|${cap}", {}); pw[slug] = pw.get(slug, 0.0) + got * (1 if y else 0) - cost - fee
                elif edge < m and open_ep[m] is not None:
                    res[f"m{m}"]["durations_s"].append((t - open_ep[m]["t"]) / 1000); open_ep[m] = None
        t += 100
hours = (t_hi - t_lo) / 3.6e6
import random
def boot(v, n=2000):  # window-clustered bootstrap of the total P&L (seeded): the windows, not the fills, are the sample
    if len(v) < 2: return None
    rng = random.Random(7); tots = sorted(sum(rng.choice(v) for _ in v) for _ in range(n))
    return [round(tots[int(.05 * n)], 1), round(tots[int(.95 * n)], 1)]
out = {"hours_scanned": round(hours, 3), "windows_scanned": len(scanned_windows), "grid_points": grid_points}
for k, R in res.items():
    d = R["durations_s"]
    out[k] = {"episodes": R["episodes"], "episodes_per_hour": round(R["episodes"] / hours, 1),
              "duration_s_p50": round(st.median(d), 2) if d else None, "duration_s_p90": round(sorted(d)[int(.9 * len(d))], 2) if d else None,
              "share_shorter_than_1s": round(sum(x < 1 for x in d) / len(d), 3) if d else None,
              "edge_at_start_median": round(st.median(R["edge_at_start"]), 4) if R["edge_at_start"] else None,
              "usd_at_touch_median": round(st.median(R["usd_at_touch"]), 1) if R["usd_at_touch"] else None,
              "first_print_s_p50": round(st.median(R["first_print_s"]), 2) if R["first_print_s"] else None,
              "first_print_within_1s_share": round(sum(x <= 1 for x in R["first_print_s"]) / R["episodes"], 3) if R["episodes"] else None,
              "no_print_within_30s": R["no_print_30s"],
              "by_lag": {kk: {"tries": a[0], "filled": a[1], "shares": round(a[2], 1), "pnl_usd": round(a[3], 2), "pnl_per_share": round(a[3] / a[2], 4) if a[2] else None,
                              "markout5s_per_share": round(a[5] / a[2], 4) if a[2] else None, "markout30s_per_share": round(a[6] / a[2], 4) if a[2] else None,
                              "windows": len(R["per_window"].get(kk, {})), "boot_p5_p95_usd": boot(list(R["per_window"].get(kk, {}).values())),
                              "pnl_usd_per_day": round(a[3] / hours * 24, 0)} for kk, a in sorted(R["by_lag"].items())}}
json.dump(out, open(sys.argv[5], "w"), indent=1, sort_keys=True)
print(json.dumps(out, indent=1, sort_keys=True))
