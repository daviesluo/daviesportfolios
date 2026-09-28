# C* for MX-1: the chase when a post-only order resting at its own side's touch MISSES, measured at the rules' own
# decision minutes (decisions.json, from the repository's simulator) and, for comparison, at every hour close and
# every 4-hour close over the same span. Binance 1-minute klines (trade prices) stand in for the book.
#
# One event = (t0, side, T). m0 = open of the minute starting at t0; half-spread h = S_BPS / 2.
#   buy : rests at P = m0(1 - h), taker K = m0(1 + h). FILLED if a minute starting in [t0, t0 + T) has low < P.
#         else MISS, chase = (open(t0 + T)(1 + h) - K) / K * 1e4.
#   sell: rests at P = m0(1 + h), taker K = m0(1 - h). FILLED if a minute starting in [t0, t0 + T) has high > P.
#         else MISS, chase = (K - open(t0 + T)(1 - h)) / K * 1e4.
# Saving when filled (MX-1 draft's A_T): gap + 9, gap = (K - P) / P (buy) or (P - K) / P (sell), in bps.
# An event with any of the minutes t0 .. t0 + T missing from the tape is not scored and is counted.
#
#   python3 cstar.py            -> results.json, and the tables on stdout
import gzip, json, random, statistics as st, sys, datetime as dt
import numpy as np
from scipy.stats import t as tdist

S_BPS = 2.0
H = S_BPS / 2 / 1e4
FEE_BPS = 9.0
TS = (15, 60)
BOOT_B = 4000
PAIR = {"BTC/USD": "BTCUSDT", "ETH/USD": "ETHUSDT", "SOL/USD": "SOLUSDT"}
FILES = {  # every file that holds 1-minute rows, later files win on a duplicate open time
    s: [f"{s}_1m_2022-08-20_2023-08-21.json.gz", f"{s}_1m_2023-08-21_2026-07-01.json.gz", f"{s}_1m.json.gz"] for s in PAIR.values()
}
MIN = 60000
HOUR = 3600000
iso = lambda ms: dt.datetime.fromtimestamp(ms / 1000, dt.timezone.utc).strftime("%Y-%m-%dT%H:%MZ")
ms = lambda s: int(dt.datetime.strptime(s, "%Y-%m-%dT%H:%MZ").replace(tzinfo=dt.timezone.utc).timestamp() * 1000)


class Tape:
    """Open / high / low per minute on a dense grid, NaN where Binance has no kline."""
    def __init__(self, sym):
        rows = {}
        for f in FILES[sym]:
            try:
                for r in json.load(gzip.open(f, "rt")): rows[r[0]] = r
            except FileNotFoundError:
                pass
        keys = sorted(rows)
        self.base, self.n = keys[0], (keys[-1] - keys[0]) // MIN + 1
        self.o = np.full(self.n, np.nan); self.h = np.full(self.n, np.nan); self.l = np.full(self.n, np.nan)
        idx = (np.array(keys) - self.base) // MIN
        arr = np.array([rows[k] for k in keys])
        self.o[idx], self.h[idx], self.l[idx] = arr[:, 1], arr[:, 2], arr[:, 3]
        self.first, self.last, self.rows = keys[0], keys[-1], len(keys)

    def event(self, t0, side, T):
        """('fill', saving) | ('miss', chase) | ('nodata', reason)"""
        i = (t0 - self.base) // MIN
        if (t0 - self.base) % MIN or i < 0 or i + T >= self.n: return ("nodata", "outside the tape")
        o, hi, lo = self.o[i:i + T + 1], self.h[i:i + T], self.l[i:i + T]
        if np.isnan(o).any() or np.isnan(hi).any() or np.isnan(lo).any(): return ("nodata", "a minute missing")
        m0 = o[0]
        if side == "buy":
            P, K = m0 * (1 - H), m0 * (1 + H)
            if lo.min() < P: return ("fill", (K - P) / P * 1e4 + FEE_BPS)
            return ("miss", (o[T] * (1 + H) - K) / K * 1e4)
        P, K = m0 * (1 + H), m0 * (1 - H)
        if hi.max() > P: return ("fill", (P - K) / P * 1e4 + FEE_BPS)
        return ("miss", (K - o[T] * (1 - H)) / K * 1e4)


def boot_upper(c):
    """97.5 % upper bound of the mean: 4,000 resamples with replacement, a fresh random.Random(1) per cell."""
    if not c: return None
    rng, n = random.Random(1), len(c)
    means = sorted(sum(rng.choices(c, k=n)) / n for _ in range(BOOT_B))
    return means[int(0.975 * BOOT_B)]


def summarise(events):
    """events: list of ('fill'|'miss', value). Returns the cell's numbers."""
    chase = [v for s, v in events if s == "miss"]
    save = [v for s, v in events if s == "fill"]
    n = len(events)
    out = {"n": n, "misses": len(chase), "missRate": len(chase) / n if n else None,
           "meanChase": st.mean(chase) if chase else None, "medianChase": st.median(chase) if chase else None,
           "p90Chase": sorted(chase)[int(0.9 * len(chase))] if chase else None, "upper975": boot_upper(chase),
           "maxChase": max(chase) if chase else None,
           # secondary, not the pre-registration's statistic: Student-t 97.5 % upper bound of the mean, for small cells
           "upperT975": (st.mean(chase) + tdist.ppf(0.975, len(chase) - 1) * st.stdev(chase) / len(chase) ** 0.5) if len(chase) > 1 else None,
           "meanSaving": st.mean(save) if save else None,
           "meanAdvantage": st.mean([v if s == "fill" else -v for s, v in events]) if n else None}
    if out["meanSaving"] is not None and out["meanChase"] is not None:
        out["breakEvenMissRate"] = out["meanSaving"] / (out["meanSaving"] + out["meanChase"]) if out["meanSaving"] + out["meanChase"] > 0 else None
        out["breakEvenMissRateAtUpper"] = out["meanSaving"] / (out["meanSaving"] + out["upper975"]) if out["meanSaving"] + out["upper975"] > 0 else None
    return out


def main():
    dec = json.load(open("decisions.json"))
    tapes = {s: Tape(PAIR[s]) for s in PAIR}
    res = {"method": {"spreadBps": S_BPS, "feeBps": FEE_BPS, "T": TS, "bootstrap": f"{BOOT_B} resamples, random.Random(1) per cell, sorted means[int(0.975*B)]",
                      "p90": "sorted(chase)[int(0.9*n)]"},
           "tapes": {s: {"file_rows": t.rows, "first": iso(t.first), "last": iso(t.last), "gridMinutes": t.n, "missingMinutes": int(t.n - t.rows)} for s, t in tapes.items()}}
    # ── the rules' decisions ──────────────────────────────────────────────────────────────────────────────────────
    groups = {"ABC": ("A", "B", "C"), "D": ("D",), "ABCD": ("A", "B", "C", "D")}
    per_event, cells, excluded = [], {}, {}
    for d in dec["decisions"]:
        if d["reason"] == "stop":
            excluded.setdefault(f'{d["rule"]} {d["window"]}', []).append(d); continue
        side = "buy" if d["reason"] == "entry" else "sell"
        row = {k: d[k] for k in ("rule", "symbol", "window", "reason", "decisionIso", "decisionTs")}
        for T in TS:
            row[f"T{T}"] = tapes[d["symbol"]].event(d["decisionTs"], side, T)
        per_event.append(row)
    res["excludedStops"] = {k: [x["symbol"] + " " + x["decisionIso"] for x in v] for k, v in excluded.items()}
    nodata = [e for e in per_event if any(e[f"T{T}"][0] == "nodata" for T in TS)]
    res["decisionsNotScored"] = [(e["rule"], e["symbol"], e["decisionIso"], [e[f"T{T}"] for T in TS]) for e in nodata]
    # "both": the two rules pooled, one event per (symbol, side, decision minute) -- MX-1's unit, which counts a minute
    # two rows both act on once.
    seen, both = set(), []
    for e in sorted(per_event, key=lambda e: (e["decisionTs"], e["rule"] != "trend-4h")):
        k = (e["symbol"], e["reason"], e["decisionTs"])
        if k in seen: continue
        seen.add(k); both.append({**e, "rule": "both"})
    res["sharedDecisionMinutes"] = len(per_event) - len(both)
    for g, wins in groups.items():
        for rule in ("trend-4h", "trend-1h", "both"):
            src = both if rule == "both" else per_event
            for reason in ("entry", "exit"):
                for T in TS:
                    for scope in ("pooled", "BTC/USD", "ETH/USD", "SOL/USD"):
                        ev = [e[f"T{T}"] for e in src if e["rule"] == rule and e["reason"] == reason and e["window"] in wins
                              and (scope == "pooled" or e["symbol"] == scope) and e[f"T{T}"][0] != "nodata"]
                        cells[f"{g}|{rule}|{reason}|T{T}|{scope}"] = summarise(ev)
                # per window, pooled over the coins (T = 15 and 60)
                for w in wins:
                    for T in TS:
                        ev = [e[f"T{T}"] for e in src if e["rule"] == rule and e["reason"] == reason and e["window"] == w and e[f"T{T}"][0] != "nodata"]
                        cells[f"win{w}|{rule}|{reason}|T{T}|pooled"] = summarise(ev)
    # ── every hour close and every 4-hour close over the same span ──────────────────────────────────────────────────
    spans = {"ABC": (ms("2023-08-22T00:00Z"), ms("2026-09-20T04:00Z")), "D": (ms("2022-08-22T00:00Z"), ms("2023-08-22T00:00Z")),
             "ABCD": (ms("2022-08-22T00:00Z"), ms("2026-09-20T04:00Z"))}
    win_spans = {  # the 4-hour windows' out-of-sample spans (decisions.json provenance), for the per-window random rows
        "A": (ms("2025-09-10T00:00Z"), ms("2026-09-20T04:00Z")), "B": (ms("2024-08-31T00:00Z"), ms("2025-09-10T00:00Z")),
        "C": (ms("2023-08-22T00:00Z"), ms("2024-08-31T00:00Z")), "D": (ms("2022-08-22T00:00Z"), ms("2023-08-22T00:00Z"))}
    rnd_nodata = {}
    for label, step in (("hour", HOUR), ("4h", 4 * HOUR)):
        for side in ("buy", "sell"):
            for T in TS:
                evs = {}
                for s, t in tapes.items():
                    lo_all, hi_all = min(v[0] for v in spans.values()), max(v[1] for v in spans.values())
                    t0 = ((max(lo_all, t.first) + step - 1) // step) * step
                    for x in range(t0, hi_all, step):
                        r = t.event(x, side, T)
                        if r[0] == "nodata":
                            rnd_nodata[f"{label}|{side}|T{T}|{s}"] = rnd_nodata.get(f"{label}|{side}|T{T}|{s}", 0) + 1; continue
                        evs.setdefault(s, []).append((x, r))
                for g, (a, b) in list(spans.items()) + [(f"win{w}", v) for w, v in win_spans.items()]:
                    for scope in ("pooled", "BTC/USD", "ETH/USD", "SOL/USD"):
                        if g.startswith("win") and scope != "pooled": continue
                        ev = [r for s in PAIR if scope in ("pooled", s) for x, r in evs.get(s, []) if a <= x < b]
                        cells[f"{g}|random-{label}|{'entry' if side == 'buy' else 'exit'}|T{T}|{scope}"] = summarise(ev)
    res["randomNotScored"] = rnd_nodata
    res["cells"] = cells
    res["events"] = per_event
    json.dump(res, open("results.json", "w"), indent=1, default=float)
    print(json.dumps({k: v for k, v in res.items() if k not in ("cells", "events")}, indent=1, default=str)[:4000])


if __name__ == "__main__":
    main()
