"""PR5v fast X: what a faster GBP/USD and more keys are worth to "Stablecoin quotes - variant" (Davies, 2026-09-28).

Davies asked whether a faster GBP/USD source and more Revolut X keys would make the variant earn much more. This prices
both on the study's own days (`2026-09-28-pr5-variant-study.md`): 28 tightened days 2026-08-26 -> 09-23 (IS to 09-09
18:00, OOS after) on the committed prints and USD hours, and the fresh days 2026-09-23 -> 09-28 on the fresh pull. Only X
changes: GBP/USD is Dukascopy's public ticks (`pull_ticks.py`), sampled as

    M60  the minute bar, read 5 s after it ends (today's X, from the ticks) and 1 s after it ends
    B15, B5, B1  15 s, 5 s and 1 s bars, read 1 s after they end
    T1000, T250  the latest tick at least 1 s / 0.25 s old at the turn

fairU is the study's (the median of the USD book's hourly closes, 24 h to 1 h back). A value is dark 10 minutes after
its interval began, as the frozen rule's minute bar is. The engine is `fastx_sim.simulate`, the frozen `pr5v_sim`
engine with a key per rung and re-price rules added; with neither in use it is the frozen engine, and before any new
number is believed the minute bars of the study's own sources, read through this file's series, reproduce the study
(check `repro`).

usage: fastx.py OUT.json            (PR5V_TICKS = the folder pull_ticks.py wrote; default ~/pr5v_ticks)
       fastx.py --inputs DIR [LIVE_LOG ...]   (writes the committed inputs: SHA256SUMS of the raw hours, the minute
                                              closes derived from the ticks, the live logs gzipped)
"""
import bisect, collections, datetime, gzip, hashlib, json, lzma, math, os, sys, time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import study as S  # noqa: E402  (frozen: its Runner, summaries and windows)
import fastx_sim as FS  # noqa: E402

V, P = S.V, S.P
M, H, DAY = V.M, V.H, V.DAY
ROOT = S.ROOT
N0, NMID, N1, F0, F1 = S.N0, S.NMID, S.N1, S.F0, S.F1
BOOKS = S.BOOKS
NINE = [0.0003, 0.0005, 0.00075, 0.001, 0.00125, 0.0015, 0.002, 0.0025, 0.003]
FROZEN = [0.001, 0.002, 0.003]
GOV = {"entry_at": 600, "stop_at": 700}
LIVE1 = S.live(1, 1)                    # 1 s turns 5 s past the minute, POST live 1 s later, cancel lands 1 s later
TICKS_DIR = os.environ.get("PR5V_TICKS") or os.path.expanduser("~/pr5v_ticks")   # the folder pull_ticks.py wrote
T_FROM, T_TO = P.ms("2026-08-25T23:00"), P.ms("2026-09-28T00:00")


def iso(t):
    return datetime.datetime.fromtimestamp(t / 1000, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")[:-4] + "Z"


# ------------------------------------------------------------------------------------------------ the ticks
REC = np.dtype([("ms", ">u4"), ("ask", ">u4"), ("bid", ">u4"), ("av", ">f4"), ("bv", ">f4")])


def hour_path(root, h):
    d = datetime.datetime.fromtimestamp(h / 1000, datetime.timezone.utc)
    return os.path.join(root, "GBPUSD", f"{d:%Y-%m-%d}", f"{d.hour:02d}h_ticks.bi5")


def load_ticks(root=TICKS_DIR, t0=T_FROM, t1=T_TO):
    """Every tick in the UTC hours [t0, t1): (ts ms int64, mid float64, bid, ask), time order; and per-hour counts."""
    ts, mid, bid, ask, per_hour, missing = [], [], [], [], {}, []
    for h in range(t0, t1, H):
        p = hour_path(root, h)
        if not os.path.exists(p):
            missing.append(iso(h))
            continue
        b = open(p, "rb").read()
        if not b:
            per_hour[h] = 0
            continue
        a = np.frombuffer(lzma.decompress(b), dtype=REC)
        per_hour[h] = len(a)
        ts.append(h + a["ms"].astype(np.int64))
        bid.append(a["bid"].astype(np.float64) / 1e5)
        ask.append(a["ask"].astype(np.float64) / 1e5)
    ts = np.concatenate(ts) if ts else np.zeros(0, np.int64)
    bid = np.concatenate(bid) if bid else np.zeros(0)
    ask = np.concatenate(ask) if ask else np.zeros(0)
    o = np.argsort(ts, kind="stable")
    ts, bid, ask = ts[o], bid[o], ask[o]
    return {"ts": ts, "mid": (bid + ask) / 2, "bid": bid, "ask": ask, "per_hour": per_hour, "missing": missing}


def bar_closes(ts, mid, width):
    """{bar start: the mid of the bar's last tick} for bars of `width` ms."""
    starts = ts // width * width
    last = np.r_[starts[1:] != starts[:-1], True]
    return starts[last], mid[last]


# ------------------------------------------------------------------------------------------------ X as the rule reads it
class XS:
    """A GBP/USD series as the rule reads it: entry i may be read from avail[i] on, and is too old after expire[i].
    X(tau) is the value of the last entry with avail <= tau, if tau <= its expire, else None (dark)."""

    def __init__(self, name, avail, expire, val, whole_seconds):
        self.name, self.avail, self.expire, self.val = name, list(map(int, avail)), list(map(int, expire)), list(map(float, val))
        self.whole_seconds = whole_seconds                   # X is asked only at whole seconds: instants may be rounded up
        assert all(self.avail[i] <= self.avail[i + 1] for i in range(len(self.avail) - 1))

    def x(self, tau):
        k = bisect.bisect_right(self.avail, tau) - 1
        return self.val[k] if k >= 0 and tau <= self.expire[k] else None

    def changes(self, t0, t1):
        """The instants in [t0, t1) at which X may change: every avail, and every expire + 1 (all of them for a bar
        series built `exact`, as the frozen Mkt lists them; otherwise only those not already superseded)."""
        a, z = bisect.bisect_left(self.avail, t0), bisect.bisect_left(self.avail, t1)
        out = self.avail[a:z]
        lo = bisect.bisect_left(self.avail, t0 - 11 * M - 10 * M)
        av, ex = self.avail, self.expire
        n = len(av)
        for i in range(lo, z):
            c = ex[i] + 1
            if t0 <= c < t1 and (not self.whole_seconds or i + 1 >= n or av[i + 1] > ex[i]):
                out.append(c)
        if self.whole_seconds:
            assert t0 % 1000 == 0
            out = sorted({-(-c // 1000) * 1000 for c in out})
        return out


def minute_series(name, pairs, lag):
    """Minute bars [(start, close)] read `lag` ms after they end: the frozen Mkt's X with lagx = lag."""
    st = [a for a, _ in pairs]
    return XS(name, [a + M + lag for a in st], [a + 10 * M + lag for a in st], [b for _, b in pairs], False)


def bar_series(name, ts, mid, width, lag):
    """Bars of `width` ms built from ticks (close = last mid), read `lag` ms after they end; dark 10 min after start."""
    st, cl = bar_closes(ts, mid, width)
    return XS(name, st + width + lag, st + 10 * M + lag, cl, True)


def tick_series(name, ts, mid, lag):
    """The latest tick at least `lag` ms old. Asked only at whole-second turns, so the ticks that first become readable
    in the same second collapse to the last of them (same value at every whole second: pinned in test_fastx.py)."""
    av = ts + lag
    sec = -(-av // 1000) * 1000                              # the first whole second at which the tick is readable
    last = np.r_[sec[1:] != sec[:-1], True]
    return XS(name, sec[last], (ts + 10 * M + lag)[last], mid[last], True)


class FastMkt(V.Mkt):
    """A study market (prints, minute volumes, USD hours) whose X is an XS series. With `mask` (the study's own X for
    the same span and timing), X is dark whenever the mask is: the rule is dark whenever PR5 is (no weekend quoting on
    a source that reopens earlier, which is PR5-W's question)."""

    def __init__(self, book, prints, hours, xs, mask=None):
        V.Mkt.__init__(self, book, prints, [], hours)
        self.xs, self.mask = xs, mask

    def X(self, tau, lagx):                                  # the series carries its own read lag
        if self.mask is not None and self.mask.x(tau) is None:
            return None
        return self.xs.x(tau)

    def change_instants(self, lagx, t0, t1):
        out = self.xs.changes(t0, t1)
        if self.mask is not None:
            out += self.mask.changes(t0, t1)
        a, z = bisect.bisect_left(self.hs, t0 - 1441 * M), bisect.bisect_left(self.hs, t1)
        for h in self.hs[a:z]:
            for c in (h + H, h + 1440 * M + 1):
                if t0 <= c < t1:
                    out.append(c)
        return out


def remarket(mk, xs, mask=None):
    return FastMkt(mk.book, mk.prints, list(zip(mk.hs, mk.hc)), xs, mask)


# ------------------------------------------------------------------------------------------------ keys
def acct4(book, side, k):
    return f"{book}/{side}"


def acct_split(n):
    """n keys per book-side: the side's rungs by distance, dealt round-robin (rank mod n), so every key holds near and
    far rungs: for n = 2, {0.03, 0.075, 0.125, 0.20, 0.30} and {0.05, 0.10, 0.15, 0.25}."""
    def fn(book, side, k):
        return f"{book}/{side}/{NINE.index(k) % n}" if k in NINE else f"{book}/{side}/0"
    return fn


def keys_needed(posts, d0, d1, limit=600):
    """From an ungoverned run: per book-side, the fewest keys whose rungs' POSTs (placements, re-prices, re-placements,
    exits, stops) stay under `limit` on every UTC day of [d0, d1), rungs split any way (all partitions tried), and the
    POSTs the busiest rung sends on its busiest day. None when one rung alone reaches the limit."""
    days = range(d0 // DAY, d1 // DAY)
    per = collections.defaultdict(lambda: collections.defaultdict(collections.Counter))
    for p in posts:
        if p[6] and d0 <= p[0] < d1:
            per[(p[1], p[4])][p[5]][p[0] // DAY] += 1
    out = {}
    for bs, rung_days in per.items():
        rungs = sorted(rung_days)
        vec = {k: [rung_days[k].get(d, 0) for d in days] for k in rungs}
        worst_rung = max(max(v) for v in vec.values())
        if worst_rung >= limit:
            out[f"{BOOKS[bs[0]]}/{bs[1]}"] = {"keys": None, "busiest_rung_day": worst_rung}
            continue
        best, split = _min_partition([vec[k] for k in rungs], limit)
        out[f"{BOOKS[bs[0]]}/{bs[1]}"] = {"keys": best, "busiest_rung_day": worst_rung,
                                          "side_busiest_day": max(sum(v[i] for v in vec.values()) for i in range(len(days))),
                                          "split_pct": [[round(rungs[i] * 100, 4) for i in grp] for grp in split]}
    return out


def _min_partition(vecs, limit):
    """The fewest groups such that each group's day-by-day sums stay below `limit`, and one such split (lists of item
    indices). Exhaustive with symmetry pruning (n <= 12 items)."""
    n = len(vecs)
    order = sorted(range(n), key=lambda i: -max(vecs[i]))
    L = len(vecs[0]) if vecs else 0
    for g in range(1, n + 1):
        sums, members = [], []

        def place(idx):
            if idx == n:
                return True
            i = order[idx]
            v = vecs[i]
            seen = set()
            for s, mem in zip(sums, members):
                key = tuple(s)
                if key in seen:
                    continue
                seen.add(key)
                if all(s[d] + v[d] < limit for d in range(L)):
                    for d in range(L):
                        s[d] += v[d]
                    mem.append(i)
                    if place(idx + 1):
                        return True
                    mem.pop()
                    for d in range(L):
                        s[d] -= v[d]
            if len(sums) < g:
                sums.append(list(v))
                members.append([i])
                if place(idx + 1):
                    return True
                sums.pop()
                members.pop()
            return False

        if place(0):
            return g, [sorted(m) for m in members]
    return None, []


# ------------------------------------------------------------------------------------------------ stale fills
class TickFair:
    """The tick-level fair: fairU(t) / the latest Dukascopy mid at or before t (no read lag), dark after 10 minutes."""

    def __init__(self, ticks):
        self.ts, self.mid = ticks["ts"], ticks["mid"]

    def x_at(self, t):
        i = int(np.searchsorted(self.ts, t, side="right")) - 1
        return float(self.mid[i]) if i >= 0 and self.ts[i] >= t - 10 * M else None


def stale_fills(trips, mkts_by_book, tf, a, b):
    """Entry fills in [a, b) made while the tick-level fair was already through the entry price (a bid above it, an
    ask below it), with their trips' P&L; and the mean edge at fill against the tick fair, in bps."""
    n = pnl = 0
    edges, short, notional = [], [], []
    for x in trips:
        if not (a <= x["t_entry"] < b) or x.get("fill_ts") is None:
            continue
        mk = mkts_by_book[x["book"]]
        u = mk.fairU(x["fill_ts"])
        xt = tf.x_at(x["fill_ts"])
        if not u or not xt:
            continue
        f = u / xt
        e = (f - x["entry"]) / f if x["side"] == "bid" else (x["entry"] - f) / f
        edges.append(e * 1e4)
        short.append(x["k"] * 1e4 - e * 1e4)                 # the rung's distance the fill did not get
        notional.append(x["notional_usd"])
        if e < 0:
            n += 1
            pnl += x["pnl_usd"]
    return {"stale_fills": n, "stale_fill_pnl_usd": round(pnl, 4), "fills_scored": len(edges),
            "mean_edge_at_fill_bps": round(float(np.mean(edges)), 3) if edges else None,
            "median_edge_at_fill_bps": round(float(np.median(edges)), 3) if edges else None,
            "mean_shortfall_vs_rung_bps": round(float(np.mean(short)), 3) if short else None,
            "shortfall_usd": round(float(sum(s * v for s, v in zip(short, notional)) / 1e4), 4) if short else None}


# ------------------------------------------------------------------------------------------------ data and runs
class Data:
    """The study's markets (Runner: committed prints and hours with Exness X; fresh ones with Yahoo X) and the ticks."""

    def __init__(self, ticks=True):
        self.R = S.Runner()
        self.exn = sorted(P.fx_series().items())
        self.yah = sorted(self.R.ybars.items())
        self.ticks = load_ticks() if ticks else None
        self._xs, self._masks = {}, {}

    def xs(self, name):
        if name not in self._xs:
            if len(self._xs) >= 3:
                self._xs.pop(next(iter(self._xs)))
            self._xs[name] = self._build(name)
        return self._xs[name]

    def _build(self, name):
        src, kind = name.split("_", 1)
        if src in ("EXN", "YAH"):
            lag = {"M60/5s": 5000, "M60/0": 0}[kind]
            return minute_series(name, self.exn if src == "EXN" else self.yah, lag)
        t = self.ticks
        if kind.startswith("M60"):
            st, cl = bar_closes(t["ts"], t["mid"], M)
            lag = {"M60/5s": 5000, "M60/1s": 1000, "M60/0": 0}[kind]
            return minute_series(name, list(zip(st.tolist(), cl.tolist())), lag)
        if kind.startswith("B"):
            return bar_series(name, t["ts"], t["mid"], int(kind[1:]) * 1000, 1000)
        if kind.startswith("T"):
            return tick_series(name, t["ts"], t["mid"], int(kind[1:]))
        raise ValueError(name)

    def mask(self, span, ref_timing):
        """The study's own X for the span and timing: Exness (28 days) or Yahoo (fresh days), read 5 s after the bar
        at the live timing and at the bar's end at PR5's minute timing."""
        name = ("EXN" if span == "N" else "YAH") + ("_M60/0" if ref_timing else "_M60/5s")
        if name not in self._masks:
            self._masks[name] = self._build(name)
        return self._masks[name]

    def markets(self, span, xname, ref_timing=False):
        base = self.R.N if span == "N" else self.R.F
        xs = self.xs(xname)
        mask = self.mask(span, ref_timing) if xname.startswith("DUK") else None
        return [remarket(base[b], xs, mask) for b in BOOKS]


ARMS = {
    # the recommended configuration and its key counts
    "rec/4": dict(rungs=NINE, reprice=0.0003, gov=GOV, acct=lambda b, s: f"{b}/{s}", **LIVE1),
    "rec/8": dict(rungs=NINE, reprice=0.0003, gov=GOV, acct_k=acct_split(2), **LIVE1),
    "rec/16": dict(rungs=NINE, reprice=0.0003, gov=GOV, acct_k=acct_split(4), **LIVE1),
    "rec/ungov": dict(rungs=NINE, reprice=0.0003, gov=None, acct=lambda b, s: f"{b}/{s}", **LIVE1),
    # the frozen set {0.1, 0.2, 0.3} at its 0.05 % step, same live timing and shared cap, on one key
    "frozen/1": dict(rungs=FROZEN, reprice=0.0005, gov=GOV, acct=lambda b, s: 0, **LIVE1),
    "frozen/ungov": dict(rungs=FROZEN, reprice=0.0005, gov=None, acct=lambda b, s: 0, **LIVE1),
    # the PR5V reference timing: a turn a minute, orders live the next minute (as the forward test runs)
    "rec/ref": dict(rungs=NINE, reprice=0.0003, gov=GOV, acct=lambda b, s: f"{b}/{s}"),
    "frozen/ref/per_rung": dict(rungs=FROZEN, cap="per_rung"),
}
RULES = {"D": {"frac": 1 / 3, "away": None}, "A": {"frac": 0.0, "away": 0.001}, "DA": {"frac": 1 / 3, "away": 0.001}}
for _rn, _rule in RULES.items():
    ARMS[f"rec/4/{_rn}"] = dict(ARMS["rec/4"], rule=_rule)
    ARMS[f"rec/ungov/{_rn}"] = dict(ARMS["rec/ungov"], rule=_rule)


def cfg_of(D, arm, **extra):
    kw = dict(ARMS[arm]) if isinstance(arm, str) else dict(arm)
    kw.update(extra)
    rungs = kw.pop("rungs")
    return D.R.cfg(rungs, **kw)


def run(D, span, xname, arm, engine="fastx", **extra):
    cfg = cfg_of(D, arm, **extra)
    mk = D.markets(span, xname, ref_timing=cfg["s_ms"] == M and cfg["delta_ms"] is None)
    t0, t1 = (N0, N1) if span == "N" else (F0, F1)
    t = time.time()
    r = (FS.simulate if engine == "fastx" else V.simulate)(mk, cfg, t0, t1)
    nr = len(cfg["rungs"]["bid"]) + len(cfg["rungs"]["ask"])
    return {"trips": r["trips"], "posts": r["posts"], "stats": dict(r["stats"]), "nr": nr, "size": cfg["size"],
            "seconds": round(time.time() - t, 1), "mkts": {m.book: m for m in mk}}


def summarize(D, res, span, tf=None, keys=False):
    s = S.summary(res, span)
    out = {k: v for k, v in s.items() if k not in ("orders", "stats")}
    out["orders"] = s["orders"]
    out["stats"] = s["stats"]
    a, b = (N0, N1) if span == "N" else (F0, F1)
    out["daily"] = S.daily(res["trips"], a, b)
    if tf is not None:
        wins = {"IS": (N0, NMID), "OOS": (NMID, N1), "N28": (N0, N1)} if span == "N" else {"FRESH": (F0, F1)}
        for w, (x, y) in wins.items():
            out[w]["stale"] = stale_fills(res["trips"], res["mkts"], tf, x, y)
    out["reach_600"] = reach_600(res["posts"], a, b)
    if keys:
        out["keys_needed"] = keys_needed(res["posts"], a, b)
        if span == "N":
            out["keys_needed_IS_days"] = keys_needed(res["posts"], N0, NMID // DAY * DAY)
    out["seconds"] = res["seconds"]
    return out


def reach_600(posts, a, b, limit=600):
    """For each key and UTC day of [a, b): the time of day its `limit`-th POST was sent (the governor's entry line)."""
    by = collections.defaultdict(list)
    for p in posts:
        if p[6] and a <= p[0] < b:
            by[(p[2], p[0] // DAY)].append(p[0])
    hits = sorted(sorted(v)[limit - 1] % DAY for v in by.values() if len(v) >= limit)
    fmt = lambda ms_: f"{ms_ // H:02d}:{ms_ % H // M:02d}"  # noqa: E731
    return {"key_days": len(hits), "earliest": fmt(hits[0]) if hits else None,
            "median": fmt(hits[len(hits) // 2]) if hits else None}


def same_run(r1, r2):
    """Trip for trip (every field) and POST for POST."""
    key = lambda x: (x["t_entry"], x["book"], x["side"], x["k"], x["fill_ts"])  # noqa: E731
    a = sorted(r1["trips"], key=key)
    b = sorted(r2["trips"], key=key)
    return {"trips": [len(a), len(b)], "trips_identical": a == b, "posts": [len(r1["posts"]), len(r2["posts"])],
            "posts_identical": r1["posts"] == r2["posts"]}


def near(x, y, tol=5e-5):
    return x is not None and y is not None and abs(x - y) <= tol


def repro(D):
    """Before any new number: the study's own sources, read through this file's series (XS, FastMkt) and engine
    (fastx_sim), reproduce the study (pr5v_study.json, ref_timing.json), and the frozen engine run on the study's own
    markets, trip for trip and POST for POST."""
    out, ok = {}, True
    st = json.load(open(os.path.join(ROOT, "docs/agents/backtests/pr5v/pr5v_study.json")))
    rt = json.load(open(os.path.join(ROOT, "docs/agents/backtests/pr5v/ref_timing.json")))
    checks = [
        ("recommended: 1 s turns, 4 keys (study Z size=100)", "N", "EXN_M60/5s", "rec/4", st["Z_recommended_arms"]["size=100"], ("IS", "OOS", "N28")),
        ("recommended, fresh days on Yahoo (study Z size=100)", "F", "YAH_M60/5s", "rec/4", st["Z_recommended_arms"]["size=100"], ("FRESH",)),
        ("recommended without the governor (study Z no_governor)", "N", "EXN_M60/5s", "rec/ungov", st["Z_recommended_arms"]["no_governor"], ("IS", "OOS", "N28")),
        ("frozen set at 1 s turns, shared cap, one key, no governor (study D frozen/s=1/d=1)", "N", "EXN_M60/5s", "frozen/ungov", st["D_cadence"]["frozen/s=1/d=1"], ("IS", "OOS", "N28")),
        ("frozen set as it runs: a turn a minute, per-rung cap (study B frozen/per_rung)", "N", "EXN_M60/0", "frozen/ref/per_rung", st["B_sets"]["frozen/per_rung"], ("IS", "OOS", "N28")),
        ("frozen set as it runs, fresh days", "F", "YAH_M60/0", "frozen/ref/per_rung", st["B_sets"]["frozen/per_rung"], ("FRESH",)),
        ("PR5V reference timing: a turn a minute, 4 keys (ref_timing nine/0.03%/4 keys/minute)", "N", "EXN_M60/0", "rec/ref", rt["arms"]["nine/0.03%/4 keys/minute"], ("IS", "OOS", "N28")),
        ("PR5V reference timing, fresh days", "F", "YAH_M60/0", "rec/ref", rt["arms"]["nine/0.03%/4 keys/minute"], ("FRESH",)),
    ]
    for name, span, xname, arm, ref, wins in checks:
        r_new = run(D, span, xname, arm)
        cfg = cfg_of(D, arm)
        base = D.R.N if span == "N" else D.R.F
        t0, t1 = (N0, N1) if span == "N" else (F0, F1)
        r_old = V.simulate([base[b] for b in BOOKS], cfg, t0, t1)           # the frozen engine, the study's markets
        sm = S.summary(r_new, span)
        c = {"series": xname, "fastx_engine_and_series_vs_frozen": same_run(r_new, r_old)}
        for w in wins:
            c[w] = {"trips": [sm[w]["trips"], ref[w]["trips"]], "pnl_usd": [sm[w]["pnl_usd"], ref[w]["pnl_usd"]],
                    "usd_per_day": [sm[w]["usd_per_day"], ref[w]["usd_per_day"]],
                    "pct_per_year": [sm[w]["pct_per_year"], ref[w]["pct_per_year"]],
                    "match": sm[w]["trips"] == ref[w]["trips"] and near(sm[w]["pnl_usd"], ref[w]["pnl_usd"])}
        e = c["fastx_engine_and_series_vs_frozen"]
        c["PASS"] = e["trips_identical"] and e["posts_identical"] and all(c[w]["match"] for w in wins)
        ok = ok and c["PASS"]
        out[name] = c
        print("REPRO", "PASS" if c["PASS"] else "FAIL", name, {w: c[w]["usd_per_day"] for w in wins}, flush=True)
    out["PASS"] = ok
    return out


# ------------------------------------------------------------------------------------------------ Dukascopy against the study's sources
def compare_minutes(a, b, lo, hi):
    """Two {minute start: close} series over [lo, hi): |a/b - 1| in bps where both have the minute; minutes in one only."""
    both = sorted(t for t in a if lo <= t < hi and t in b)
    d = np.array([(a[t] / b[t] - 1) * 1e4 for t in both])
    ad = np.abs(d)
    return {"from": iso(lo), "to": iso(hi), "minutes_both": len(both),
            "median_abs_bps": round(float(np.median(ad)), 3) if len(d) else None,
            "p95_abs_bps": round(float(np.percentile(ad, 95)), 3) if len(d) else None,
            "max_abs_bps": round(float(ad.max()), 3) if len(d) else None,
            "median_signed_bps": round(float(np.median(d)), 3) if len(d) else None,
            "share_abs_over_2bps": round(float((ad > 2).mean()), 4) if len(d) else None,
            "minutes_first_only": sum(1 for t in a if lo <= t < hi and t not in b),
            "minutes_second_only": sum(1 for t in b if lo <= t < hi and t not in a)}


def step_events(series, lo, hi, step=0.0003):
    """How often a series moves more than `step` from where it last re-set, per day of [lo, hi): the re-prices the
    X part alone would cause (fairU held still)."""
    ts = sorted(t for t in series if lo <= t < hi)
    n, ref = 0, None
    for t in ts:
        v = series[t]
        if ref is None or abs(v / ref - 1) > step:
            n += ref is not None
            ref = v
    return round(n / ((hi - lo) / DAY), 1)


def weekends(series_minutes, lo, hi):
    """Each weekend's dark stretch in a minute series: the last minute before a gap of more than 6 hours, and the first after."""
    ts = sorted(t for t in series_minutes if lo <= t < hi)
    out = []
    for x, y in zip(ts, ts[1:]):
        if y - x > 6 * H:
            out.append([iso(x), iso(y)])
    return out


def validate(D):
    t = D.ticks
    st, cl = bar_closes(t["ts"], t["mid"], M)
    duk = dict(zip(st.tolist(), cl.tolist()))
    exn = dict(D.exn)
    yah = dict(D.yah)
    y3 = {r[0]: r[4] for r in json.load(gzip.open(os.path.join(ROOT, "docs/agents/backtests/inputs/first_principles_2026-09-23/ref/yahoo_GBPUSD_1m.json.gz"), "rt"))}
    lo_y, hi_y = min(yah), max(yah) + M
    ph = t["per_hour"]
    weekday_hours = [h for h in range(T_FROM, T_TO, H) if datetime.datetime.fromtimestamp(h / 1000, datetime.timezone.utc).weekday() < 5
                     and not (datetime.datetime.fromtimestamp(h / 1000, datetime.timezone.utc).weekday() == 4 and
                              datetime.datetime.fromtimestamp(h / 1000, datetime.timezone.utc).hour >= 21)]
    by_day = collections.Counter()
    for h, n in ph.items():
        by_day[h // DAY] += n
    wk = [v for d, v in by_day.items() if datetime.datetime.fromtimestamp(d * DAY / 1000, datetime.timezone.utc).weekday() < 5]
    mids = t["mid"]
    ts = t["ts"]
    hr = (ts // H) % 24
    wd = ((ts // DAY) + 3) % 7                               # 1970-01-01 was a Thursday: 0 = Monday
    busy = (hr >= 8) & (hr < 16) & (wd < 5)
    gaps = np.diff(ts)[busy[1:] & busy[:-1]]
    chg = int((mids[1:] != mids[:-1]).sum())
    return {"ticks": int(len(ts)), "hours_fetched": len(ph) + 0, "hours_missing": t["missing"],
            "hours_empty": sum(1 for v in ph.values() if v == 0),
            "weekday_hours_empty": [iso(h) for h in weekday_hours if ph.get(h, 0) == 0],
            "ticks_per_weekday_median": int(np.median(wk)) if wk else None,
            "mid_changes": chg, "mid_changes_per_weekday_minute": round(chg / max(1, sum(1 for v in ph.values() if v) * 60), 2),
            "median_gap_between_ticks_ms_london_hours": float(np.median(gaps)) if len(gaps) else None,
            "minute_closes_vs_exness": compare_minutes(duk, exn, N0, N1),
            "minute_closes_vs_yahoo_fresh_pull": compare_minutes(duk, yah, lo_y, hi_y),
            "minute_closes_vs_yahoo_pr3_file": compare_minutes(duk, y3, min(y3), min(max(y3) + M, N1)),
            "yahoo_fresh_vs_exness_for_scale": compare_minutes(yah, exn, lo_y, N1),
            "moves_over_3bps_a_day": {
                "dukascopy_minute_28d": step_events(duk, N0, N1), "exness_minute_28d": step_events(exn, N0, N1),
                "dukascopy_minute_fresh": step_events(duk, F0, F1), "yahoo_minute_fresh": step_events(yah, F0, F1),
                "dukascopy_1s_28d": step_events(dict(zip(*[a.tolist() for a in bar_closes(ts, mids, 1000)])), N0, N1),
                "dukascopy_1s_fresh": step_events(dict(zip(*[a.tolist() for a in bar_closes(ts, mids, 1000)])), F0, F1)},
            "alignment_median_abs_bps_by_shift_min": {
                name: {str(s): compare_minutes({t - s * M: v for t, v in duk.items()}, other, lo, hi)["median_abs_bps"] for s in (-2, -1, 0, 1, 2)}
                for name, other, lo, hi in (("exness", exn, N0, N1), ("yahoo_fresh_pull", yah, lo_y, hi_y))},
            "weekend_dark": {"dukascopy": weekends(duk, T_FROM, T_TO), "exness": weekends(exn, T_FROM, N1),
                             "yahoo_fresh_pull": weekends(yah, lo_y, hi_y)}}


# ------------------------------------------------------------------------------------------------ Q3: the ceiling
def ceiling_minutes(by_min, rungs=NINE, size=100.0, vs=0.10):
    """{minute: [(ts, price ticks, value USD, fair GBP)]} -> (ladder $, ladder fill $, free $, free fill $); see ceiling."""
    lad = free = lad_fill = free_fill = 0.0
    for m, ps in by_min.items():
        vol = sum(v for _, _, v, _ in ps)
        bud = {"bid": vs * vol, "ask": vs * vol}
        cand = {"bid": [], "ask": []}
        for ts, q, v, f in ps:
            left = v
            for side in ("bid", "ask"):
                prices = [(P.rt(f, k, side), k) for k in rungs]
                thr = [(p, k) for p, k in prices if (q < p if side == "bid" else q > p)]
                thr.sort(key=lambda z: (-z[0], z[1]) if side == "bid" else (z[0], z[1]))
                for p, k in thr:
                    room = min(size, left, bud[side])
                    if room <= 1e-12:
                        break
                    px = p * P.TICK
                    lad += room * ((f - px) / px if side == "bid" else (px - f) / px)
                    lad_fill += room
                    left -= room
                    bud[side] -= room
            # the free bound's candidates: a bid one tick above a print below fair, an ask one tick below one above
            pb, pa = (q + 1) * P.TICK, (q - 1) * P.TICK
            if pb < f:
                cand["bid"].append(((f - pb) / pb, v))
            if pa > f:
                cand["ask"].append(((pa - f) / pa, v))
        for side in ("bid", "ask"):
            room = vs * vol
            for e, v in sorted(cand[side], reverse=True):
                take = min(v, room)
                if take <= 0:
                    break
                free += take * e
                free_fill += take
                room -= take
    return lad, lad_fill, free, free_fill


def ceiling(D, span, rungs=NINE, size=100.0, vs=0.10):
    """Per UTC day and book: the UK notional printed, the 10 % a side the shared cap allows, and two upper bounds on
    what quotes could earn from those prints, both at the tick-level fair (fairU / the latest Dukascopy mid, no lag):
      ladder: the nine rungs a side, $100 each, re-priced continuously, always available (no waiting for an exit),
              filled by every print strictly through them under the shared cap (nearest first, the print's own value
              and 10 % of the minute a side), each fill earning its full distance to fair;
      free:   any price at all: 10 % of the minute a side, filled from the prints with the best distance to fair first,
              each at one tick better than the print, earning that distance.
    Neither pays an exit, a stop or a queue; they bound what the rule's fills could be worth, not what it can earn."""
    t0, t1 = (N0, N1) if span == "N" else (F0, F1)
    tf = TickFair(D.ticks)
    base = D.R.N if span == "N" else D.R.F
    dark = D.mask(span, False)                               # only while PR5's own X is lit, as the rule is
    days = (t1 - t0) / DAY
    res = {}
    for b in BOOKS:
        mk = base[b]
        pr = [p for p in mk.prints if t0 <= p[0] < t1]
        vol_day = collections.Counter()
        by_min = collections.defaultdict(list)
        for ts, q, qty, aggr in pr:
            if dark.x(ts) is None:
                continue
            x = tf.x_at(ts)
            u = mk.fairU(ts)
            if not x or not u:
                continue
            v = qty * q * P.TICK * x
            vol_day[ts // DAY] += v
            by_min[ts // M * M].append((ts, q, v, u / x))
        lad, lad_fill, free, free_fill = ceiling_minutes(by_min, rungs, size, vs)
        tot = sum(vol_day.values())
        i = np.searchsorted(tf.ts, np.array([p[0] for p in pr], dtype=np.int64), side="right") - 1
        every = sum(p[2] * p[1] * P.TICK * float(tf.mid[j]) for p, j in zip(pr, i) if j >= 0)   # weekends too, at the last mid
        res[b] = {"notional_all_usd_per_day": round(every / days, 2),
                  "notional_usd_per_day": round(tot / days, 2), "cap_10pct_a_side_usd_per_day": round(0.1 * tot / days, 2),
                  "ladder_fill_usd_per_day": round(lad_fill / days, 2), "ladder_usd_per_day": round(lad / days, 4),
                  "free_fill_usd_per_day": round(free_fill / days, 2), "free_usd_per_day": round(free / days, 4)}
    res["both"] = {k: round(sum(res[b][k] for b in BOOKS), 4) for k in res[BOOKS[0]]}
    return res


# ------------------------------------------------------------------------------------------------ the grid
X_LIST = ["DUK_M60/5s", "DUK_M60/1s", "DUK_B15", "DUK_B5", "DUK_B1", "DUK_T1000", "DUK_T250"]
X_LABEL = {"DUK_M60/5s": "minute bar, read 5 s after (today)", "DUK_M60/1s": "minute bar, read 1 s after",
           "DUK_B15": "15 s bars, read 1 s after", "DUK_B5": "5 s bars, read 1 s after", "DUK_B1": "1 s bars, read 1 s after",
           "DUK_T1000": "latest tick at least 1 s old", "DUK_T250": "latest tick at least 0.25 s old",
           "EXN_M60/5s": "Exness minute bar, read 5 s after (the study's 28 days)",
           "YAH_M60/5s": "Yahoo minute bar, read 5 s after (the study's fresh days)"}
GRID_ARMS = ["rec/4", "rec/8", "rec/16", "rec/ungov", "frozen/1", "frozen/ungov",
             "rec/4/D", "rec/4/A", "rec/4/DA", "rec/ungov/D", "rec/ungov/A", "rec/ungov/DA"]
_D = [None]


def _unit(args):
    """One X series on one span: every arm, summarised (runs in a worker; the data came by fork)."""
    span, xname, arms = args
    D = _D[0]
    tf = TickFair(D.ticks)
    out = {}
    for arm in arms:
        res = run(D, span, xname, arm)
        out[arm] = summarize(D, res, span, tf=tf, keys=arm.startswith("rec/ungov") or arm == "frozen/ungov")
        if arm == "rec/4":                                    # the new engine is the frozen one when its additions are off
            old = run(D, span, xname, arm, engine="frozen")
            out[arm]["engine_check_vs_frozen"] = same_run(res, old)
        print(span, xname, arm, f"{res['seconds']}s", {w: out[arm][w]["usd_per_day"] for w in ("IS", "OOS", "N28", "FRESH") if w in out[arm]}, flush=True)
    return span, xname, out


def grid(D, workers=4):
    import multiprocessing as mp
    _D[0] = D
    units = [(span, x, GRID_ARMS) for x in X_LIST for span in ("N", "F")]
    units += [("N", "EXN_M60/5s", GRID_ARMS), ("F", "YAH_M60/5s", GRID_ARMS)]
    units += [("N", "DUK_M60/0", ["rec/ref", "frozen/ref/per_rung"]), ("F", "DUK_M60/0", ["rec/ref", "frozen/ref/per_rung"]),
              ("N", "EXN_M60/0", ["rec/ref", "frozen/ref/per_rung"]), ("F", "YAH_M60/0", ["rec/ref", "frozen/ref/per_rung"])]
    ctx = mp.get_context("fork")
    res = {}
    with ctx.Pool(workers) as pool:
        for span, x, out in pool.imap_unordered(_unit, units):
            for arm, s in out.items():
                res[f"{span}|{x}|{arm}"] = s
    return res


def paired(res, span, x, arm, base_x="DUK_M60/5s"):
    a, b = res[f"{span}|{x}|{arm}"]["daily"], res[f"{span}|{base_x}|{arm}"]["daily"]
    diff = [u - v for u, v in zip(a, b)]
    out = {"mean_usd_per_day": round(sum(diff) / len(diff), 4), "better_days": sum(1 for d in diff if d > 1e-9),
           "worse_days": sum(1 for d in diff if d < -1e-9)}
    if span == "N":
        out["bootstrap_7d"] = S.block_bootstrap(diff, 7)
    return out


def paired_arms(res, span, x, arm_a, arm_b):
    """arm_a minus arm_b on the same X, by UTC day of entry."""
    a, b = res[f"{span}|{x}|{arm_a}"]["daily"], res[f"{span}|{x}|{arm_b}"]["daily"]
    diff = [u - v for u, v in zip(a, b)]
    out = {"mean_usd_per_day": round(sum(diff) / len(diff), 4), "better_days": sum(1 for d in diff if d > 1e-9),
           "worse_days": sum(1 for d in diff if d < -1e-9)}
    if span == "N":
        out["bootstrap_7d"] = S.block_bootstrap(diff, 7)
    return out


def split_fn(splits):
    """acct_k from a keys_needed result: {book/side: {"split_pct": [[k%...], ...]}}."""
    table = {}
    for bs, v in splits.items():
        for gi, grp in enumerate(v["split_pct"]):
            for kp in grp:
                table[(bs, round(kp, 4))] = f"{bs}/{gi}"

    def fn(book, side, k):
        return table[(f"{book}/{side}", round(k * 100, 4))]
    return fn


def best_combination(D, res):
    """The declared rule (fastx.json 'declared'): among X x re-price rule, each ungoverned and held to the keys it
    needs on the IS days, the highest IS $/day; within 5 %, fewer keys, then the slower X."""
    cands = []
    for xi, x in enumerate(X_LIST):
        for rn in (None, "D", "A", "DA"):
            arm = "rec/ungov" + (f"/{rn}" if rn else "")
            s = res[f"N|{x}|{arm}"]
            kn = s["keys_needed_IS_days"]
            keys = sum(v["keys"] for v in kn.values()) if all(v["keys"] for v in kn.values()) else None
            cands.append({"x": x, "rule": rn or "0.03 %", "arm": arm, "IS_usd_per_day": s["IS"]["usd_per_day"], "keys_IS": keys,
                          "xi": xi})
    ok = [c for c in cands if c["keys_IS"] is not None]
    top = max(c["IS_usd_per_day"] for c in ok)
    near_top = [c for c in ok if c["IS_usd_per_day"] >= top / 1.05]
    pick = min(near_top, key=lambda c: (c["keys_IS"], c["xi"], -c["IS_usd_per_day"]))
    splits = res[f"N|{pick['x']}|{pick['arm']}"]["keys_needed_IS_days"]
    rule = RULES.get(pick["rule"]) if pick["rule"] in RULES else None
    arm = dict(ARMS["rec/4"], acct_k=split_fn(splits), rule=rule)
    arm.pop("acct")
    tf = TickFair(D.ticks)
    out = {"candidates": [{k: v for k, v in c.items() if k != "xi"} for c in cands], "pick": {k: v for k, v in pick.items() if k != "xi"},
           "split": splits}
    for span in ("N", "F"):
        r = run(D, span, pick["x"], arm)
        s = summarize(D, r, span, tf=tf)
        s["key_days_reaching_600"] = sum(v["days_over_600"] for k, v in s["orders"].items() if k != "all")
        s["gov_withdrawn"] = s["stats"].get("gov_withdrawn", 0)
        out[span] = s
    return out


# ------------------------------------------------------------------------------------------------ main
def sha(p):
    return hashlib.sha256(open(p, "rb").read()).hexdigest()


def write_inputs(out_dir, *live_logs):
    """The committed inputs: the pull's SHA256SUMS (every raw hour, with its URL), Dukascopy's minute closes derived from
    the ticks (small, for checking the validation without the raw files), and the live log, gzipped with mtime 0."""
    import io, shutil
    os.makedirs(out_dir, exist_ok=True)
    shutil.copyfile(os.path.join(TICKS_DIR, "SHA256SUMS"), os.path.join(out_dir, "dukascopy_SHA256SUMS"))
    t = load_ticks()
    st, cl = bar_closes(t["ts"], t["mid"], M)

    def gz(obj_bytes, name):
        buf = io.BytesIO()
        with gzip.GzipFile(filename="", mode="wb", fileobj=buf, mtime=0) as g:
            g.write(obj_bytes)
        open(os.path.join(out_dir, name), "wb").write(buf.getvalue())

    gz(json.dumps({"source": "Dukascopy GBPUSD ticks (pull_ticks.py), the mid of each minute's last tick",
                   "from": iso(T_FROM), "to": iso(T_TO), "rows": [[int(a), round(float(b), 6)] for a, b in zip(st, cl)]}).encode(),
       "dukascopy_GBPUSD_1m_closes.json.gz")
    for p in live_logs:
        gz(open(p, "rb").read(), os.path.basename(p) + ".gz")
    with open(os.path.join(out_dir, "SHA256SUMS"), "w") as f:
        for n in sorted(os.listdir(out_dir)):
            if n != "SHA256SUMS":
                f.write(f"{sha(os.path.join(out_dir, n))}  {n}\n")


def main():
    if sys.argv[1] == "--inputs":
        write_inputs(sys.argv[2], *sys.argv[3:])
        return
    out_fn = sys.argv[1]
    t_start = time.time()
    declared = json.load(open(out_fn)).get("declared") if os.path.exists(out_fn) else None
    D = Data()
    O = {"declared": declared, "question": "the value of a faster GBP/USD (X) and of more Revolut X keys to PR5V's recommended configuration, on the study's days",
         "windows": {"IS": [iso(N0), iso(NMID)], "OOS": [iso(NMID), iso(N1)], "N28": [iso(N0), iso(N1)], "FRESH": [iso(F0), iso(F1)]},
         "x_labels": X_LABEL, "capital_usd": {"recommended": 3600, "frozen set": 1200}}
    here = lambda f: os.path.join(HERE, f)  # noqa: E731
    O["sha256"] = {"scripts": {f: sha(here(f)) for f in ("fastx.py", "fastx_sim.py", "fastx_tables.py", "pull_ticks.py", "live_fx_measure.py",
                                                         "live_fx_analyze.py", "wsmini.py", "test_fastx.py") if os.path.exists(here(f))},
                   "frozen": {"pr5_sim.py": sha(os.path.join(HERE, "..", "pr5", "pr5_sim.py")), "pr5v_sim.py": sha(here("pr5v_sim.py")),
                              "study.py": sha(here("study.py")), "ref_timing.py": sha(here("ref_timing.py"))},
                   "committed_inputs": {f: sha(os.path.join(P.S, f)) for f in ["config.json", "trades/USDC-GBP.jsonl.gz", "trades/USDT-GBP.jsonl.gz",
                                                                               "fx/series_EXN.json.gz", "candles/USDC-USD_60.json.gz", "candles/USDT-USD_60.json.gz"]},
                   "fresh_inputs": {f: sha(os.path.join(S.FRESH_DIR, f)) for f in sorted(os.listdir(S.FRESH_DIR)) if f.endswith(".gz")},
                   "dukascopy_SHA256SUMS": sha(os.path.join(TICKS_DIR, "SHA256SUMS")) if os.path.exists(os.path.join(TICKS_DIR, "SHA256SUMS")) else None}
    O["repro"] = repro(D)
    if not O["repro"]["PASS"]:
        json.dump(O, open(out_fn, "w"), indent=1, default=str)
        raise SystemExit("reproduction FAILED: no new number is reported")
    O["dukascopy_validation"] = validate(D)
    print("validation", json.dumps({k: v for k, v in O["dukascopy_validation"].items() if k.startswith("minute_closes")}), flush=True)
    res = grid(D)
    O["runs"] = res
    O["paired_vs_minute_bar"] = {f"{span}|{x}|{arm}": paired(res, span, x, arm) for span in ("N", "F") for x in X_LIST[1:]
                                 for arm in ("rec/4", "rec/ungov", "frozen/1", "rec/4/D", "rec/4/A")}
    O["paired_arms"] = {f"{span}|{x}|{a} - {b}": paired_arms(res, span, x, a, b)
                        for span in ("N", "F") for x in X_LIST + ["EXN_M60/5s" if span == "N" else "YAH_M60/5s"]
                        for a, b in (("rec/8", "rec/4"), ("rec/16", "rec/4"), ("rec/ungov", "rec/4"), ("rec/ungov/D", "rec/ungov"),
                                     ("rec/ungov/A", "rec/ungov"), ("rec/ungov/DA", "rec/ungov"), ("rec/4/D", "rec/4"),
                                     ("rec/4/A", "rec/4"), ("rec/4/DA", "rec/4"))}
    O["ceiling"] = {span: ceiling(D, span) for span in ("N", "F")}
    O["best"] = best_combination(D, res)
    # the best combination against today's minute bar with four keys, by day (same Dukascopy source), plain and with D
    for span in ("N", "F"):
        for name, arm in (("vs_minute_bar_4_keys", "rec/4"), ("vs_minute_bar_4_keys_rule_D", "rec/4/D")):
            a, b = O["best"][span]["daily"], res[f"{span}|DUK_M60/5s|{arm}"]["daily"]
            diff = [u - v for u, v in zip(a, b)]
            O["best"][span][name] = {"mean_usd_per_day": round(sum(diff) / len(diff), 4),
                                     "bootstrap_7d": S.block_bootstrap(diff, 7) if span == "N" else None}
    live = os.path.join(ROOT, "docs/agents/backtests/pr5v/fastx_live.json")
    O["live_sources"] = json.load(open(live)) if os.path.exists(live) else None
    O["seconds"] = round(time.time() - t_start, 1)
    json.dump(O, open(out_fn, "w"), indent=1, default=str)
    print("done", O["seconds"], "s")


if __name__ == "__main__":
    main()
