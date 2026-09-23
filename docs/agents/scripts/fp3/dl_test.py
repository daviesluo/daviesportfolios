"""Test DL (prereg_delisting_window.md, frozen 2026-09-23T15:56:56Z): buy a token an hour after Binance
announces its delisting, sell a day before trading stops.

usage: python3 analysis/dl_test.py OUT.json
Reads data/delist_events.json (announcement titles and release times) and data/bn_1h_dl/<SYM>.json
(hourly klines). Deterministic."""
import json, os, sys, random, datetime

S = os.environ.get("FP_ROOT", ".") + "/research_fp3"
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(S, "results", "dl_run.json")
HOUR = 3600000
SIZE = 100.0
SEED = 20260923
NULL_DRAWS = 2000
WIN = [("IS", "2022-01-01", "2023-01-01"), ("OOS1", "2023-01-01", "2025-01-01"), ("OOS2", "2025-01-01", "2026-09-22")]
DATA_END = "2026-09-22"
BAD = {"Support Rebranding", "Airdrop Plan on Binance Alpha"}


def ms(d):
    return int(datetime.datetime.fromisoformat(d).replace(tzinfo=datetime.timezone.utc).timestamp() * 1000)


def iso(t):
    return datetime.datetime.utcfromtimestamp(t / 1000).strftime("%Y-%m-%d %H:%M")


def win_of(t):
    for w, a, b in WIN:
        if ms(a) <= t < ms(b):
            return w
    return None


def events():
    ev = json.load(open(os.path.join(S, "data", "delist_events.json")))
    out = []
    for e in ev:
        if not e["date"]:
            continue
        for tok in e["tokens"]:
            if " " in tok or tok in BAD:
                continue
            out.append({"token": tok, "sym": tok + "USDT", "release": e["release"], "date": e["date"], "title": e["title"]})
    out.sort(key=lambda x: (x["release"], x["sym"]))
    return out


def load(sym):
    fn = os.path.join(S, "data", "bn_1h_dl", f"{sym}.json")
    return json.load(open(fn)) if os.path.exists(fn) else None


def trade(rows, entry_delay_h, release, fee, h):
    idx = {r[0]: i for i, r in enumerate(rows)}
    first_ok = release + entry_delay_h * HOUR
    e_i = None
    for i, r in enumerate(rows):
        if r[0] >= first_ok:
            e_i = i
            break
    if e_i is None or rows[e_i][0] - first_ok >= 24 * HOUR:
        return None, "no bar within a day after the entry time"
    # the pair's last hourly bar: the cease time is its end; it must fall on or after the announcement
    last_t = rows[-1][0]
    if last_t + HOUR > ms(DATA_END):
        return None, "data ends before the pair stops trading"
    x_t = last_t + HOUR - 24 * HOUR
    if x_t <= rows[e_i][0]:
        return None, "exit bar at or before entry bar"
    x_i = idx.get(x_t)
    if x_i is None:
        # nearest bar at or before the exit time
        cands = [i for i, r in enumerate(rows) if r[0] <= x_t]
        x_i = cands[-1]
    ep = rows[e_i][1] * (1 + fee + h)
    xp = rows[x_i][1] * (1 - fee - h)
    pnl = SIZE * (xp / ep - 1)
    return {"entry_t": rows[e_i][0], "exit_t": rows[x_i][0], "entry_open": rows[e_i][1], "exit_open": rows[x_i][1],
            "hours": (rows[x_i][0] - rows[e_i][0]) // HOUR, "pnl": round(pnl, 6)}, None


def main():
    evs = events()
    res = {"test": "DL", "prereg_sha256": open(os.path.join(S, "prereg_delisting_window.sha256")).read().strip()}
    arms = {"primary": (1, 0.0010, 0.0025), "doubled": (1, 0.0020, 0.0050), "entry_5h": (5, 0.0010, 0.0025)}
    out = {a: [] for a in arms}
    skipped = []
    for e in evs:
        rows = load(e["sym"])
        if not rows:
            skipped.append({"sym": e["sym"], "release": iso(e["release"]), "why": "no USDT pair in the archive"})
            continue
        # the archive must cover the announcement hour
        if not any(r[0] <= e["release"] < r[0] + HOUR for r in rows):
            skipped.append({"sym": e["sym"], "release": iso(e["release"]), "why": "no hourly bar at the announcement"})
            continue
        # keep only the rows up to the delisting (a later relisting under the same symbol is cut off)
        cut = [r for r in rows if r[0] <= ms(e["date"]) + 2 * 86400000]
        for a, (delay, fee, h) in arms.items():
            tr, why = trade(cut, delay, e["release"], fee, h)
            if tr is None:
                if a == "primary":
                    skipped.append({"sym": e["sym"], "release": iso(e["release"]), "why": why})
                continue
            tr.update({"sym": e["sym"], "release": e["release"], "win": win_of(e["release"]), "date": e["date"]})
            out[a].append(tr)
    res["skipped"] = skipped

    def summ(trs):
        tot = {w: 0.0 for w, _, _ in WIN}
        cnt = {w: 0 for w, _, _ in WIN}
        months = {}
        for t in trs:
            if t["win"] is None:
                continue
            tot[t["win"]] += t["pnl"]
            cnt[t["win"]] += 1
            if t["win"] != "IS":
                m = iso(t["release"])[:7]
                months[m] = months.get(m, 0.0) + t["pnl"]
        oos = tot["OOS1"] + tot["OOS2"]
        best = max(months.values()) if months else 0.0
        # capital: $100 x the largest number of OOS positions open at once
        pts = []
        for t in trs:
            if t["win"] in ("OOS1", "OOS2"):
                pts.append((t["entry_t"], 1))
                pts.append((t["exit_t"], -1))
        pts.sort(key=lambda x: (x[0], x[1]))
        cur = mx = 0
        for _, dlt in pts:
            cur += dlt
            mx = max(mx, cur)
        oos_days = (ms(DATA_END) - ms("2023-01-01")) / 86400000
        cap = SIZE * max(mx, 1)
        wins = sum(1 for t in trs if t["win"] in ("OOS1", "OOS2") and t["pnl"] > 0)
        r = lambda x: round(x, 4)
        return {"pnl": {k: r(v) for k, v in tot.items()}, "trips": cnt, "oos_pnl": r(oos), "oos_trips": cnt["OOS1"] + cnt["OOS2"],
                "oos_won": wins, "oos_months": {k: r(v) for k, v in sorted(months.items())},
                "best_month_share": r(best / oos) if oos > 0 else None, "oos_without_best_month": r(oos - best),
                "max_concurrent": mx, "locked_capital": cap, "ann_return_on_locked": round(oos / cap * 365 / oos_days, 6)}

    res["arms"] = {a: summ(v) for a, v in out.items()}
    # null: own-history twin
    rng = random.Random(SEED)
    oos = [t for t in out["primary"] if t["win"] in ("OOS1", "OOS2")]
    pools = {}
    for t in oos:
        rows = load(t["sym"])
        lo, hi = t["release"] - 180 * 86400000, t["release"]
        hrs = t["hours"]
        cand = []
        idx = {r[0]: i for i, r in enumerate(rows)}
        for i, r in enumerate(rows):
            if r[0] < lo:
                continue
            j = idx.get(r[0] + hrs * HOUR)
            if j is None or rows[j][0] >= hi:
                continue
            cand.append(SIZE * (rows[j][1] * (1 - 0.0010 - 0.0025) / (r[1] * (1 + 0.0010 + 0.0025)) - 1))
        pools[(t["sym"], t["release"])] = cand
    draws = []
    for _ in range(NULL_DRAWS):
        tot = 0.0
        for t in oos:
            c = pools[(t["sym"], t["release"])]
            if c:
                tot += c[rng.randrange(len(c))]
        draws.append(tot)
    draws.sort()
    res["null"] = {"draws": len(draws), "mean": round(sum(draws) / len(draws), 4), "p50": round(draws[len(draws) // 2], 4),
                   "p95": round(draws[int(0.95 * len(draws))], 4), "events_without_history": sum(1 for v in pools.values() if not v)}
    p, dd = res["arms"]["primary"], res["arms"]["doubled"]
    bar = {"1_oos_positive_each": p["oos_pnl"] > 0 and p["pnl"]["OOS1"] > 0 and p["pnl"]["OOS2"] > 0,
           "2_beats_null_p95": p["oos_pnl"] > res["null"]["p95"],
           "3_doubled_costs_positive": dd["oos_pnl"] > 0,
           "4_min_30_events": p["oos_trips"] >= 30,
           "5_not_one_month": p["best_month_share"] is not None and p["best_month_share"] <= 0.40 and p["oos_without_best_month"] > 0,
           "6_beats_cash": p["ann_return_on_locked"] > 0.04}
    bar["PASS"] = all(bar.values())
    res["bar"] = bar
    res["events_primary"] = sorted(out["primary"], key=lambda t: (t["release"], t["sym"]))
    json.dump(res, open(OUT, "w"), indent=1, sort_keys=True)
    print(json.dumps({"bar": bar, "primary": {k: p[k] for k in ("pnl", "trips", "oos_pnl", "oos_won", "best_month_share", "max_concurrent", "ann_return_on_locked")},
                      "null": res["null"], "doubled": dd["pnl"], "entry_5h": res["arms"]["entry_5h"]["pnl"], "skipped": len(skipped)}, indent=0))


if __name__ == "__main__":
    main()
