# CRYPTOBOOKS-3 (2026-10-31): the reading of "Crypto quotes XRP/GBP"'s paper test, frozen with its pre-registration
# (docs/agents/reviews/2026-10-31-xrp-gbp-paper-prereg.md §6-§8). It reads one export of the test's own tables (the statements are
# the pre-registration's §9) and prints, and writes beside the export, the verdict:
#   - the window: the 28 UTC days from the £600 arm's start (`startAt`, a 00:00 UTC);
#   - VOID when the arm had no fair for more than 10 % of the window's seconds (Binance, USDT/USD or GBP/USD missing), or Revolut X
#     printed nothing for 24 hours running (a halt, or the recorder down);
#   - the bar at £600, each day marked at the fair (agent_mm_days.pnl_gbp): PASS when all four hold, else FAIL:
#       1. the 28 days' sum is above 0;
#       2. P(mean <= 0) < 0.10 by a circular block bootstrap of the days, 3-day blocks, 10,000 resamples, random.Random(20261031)
#          (rule.boot);
#       3. the decay stop's test: the P&L of the window's tight hours (the book's pair spread under 16 bps, regimes_hist.WIDE;
#          an hour with too few pairs to measure counts as tight) is 0 or more; with fewer than 100 tight hours this condition
#          counts as passed and the verdict says so;
#       4. at least 100 fills;
#   - reported, not judged: the £120 and £1,200 arms' sums, P and fills; the wide hours' P&L; placements a day; the stale
#     seconds; the arbitrageur's and the stop's fills.
#   python3 -I paper_reading.py <export.json>
import collections, datetime as dt, json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from regimes_hist import WIDE, day_spread  # noqa: E402
from rule import boot  # noqa: E402

DAYS = 28
P_BAR = 0.10
MIN_TIGHT_HOURS = 100
MIN_FILLS = 100
VOID_STALE = 0.10
VOID_SILENT_S = 24 * 3600


def iso_s(x):
    """Seconds since the epoch of an ISO time, or of milliseconds (the state's `startAt`)."""
    if isinstance(x, (int, float)) or str(x).isdigit():
        return int(x) // 1000
    return int(dt.datetime.fromisoformat(str(x).replace("Z", "+00:00")).timestamp())


def read(path):
    """The export: {"arms": {arm: {"start": iso, "days": [agent_mm_days rows], "hours": [[hour iso, equity at its last minute]],
    "fills": [[ts iso, kind]]}}, "prints": [[ms, price, qty, "buy"|"sell"]]}."""
    return json.load(open(path))


def hour_pnl(hours, cap, t0, t1):
    """Each hour's P&L in [t0, t1): its last equity less the hour before's (the capital before the first)."""
    out, prev = {}, cap
    for h, eq in sorted((iso_s(h), float(e)) for h, e in hours):
        if h >= t1:
            break
        if h >= t0:
            out[h] = eq - prev
        prev = eq
    return out


def hour_regimes(prints, t0, t1):
    by = collections.defaultdict(list)
    for ms, px, q, side in prints:
        h = (int(ms) // 1000) // 3600 * 3600
        if t0 <= h < t1:
            by[h].append((int(ms), float(px), float(q), 1 if side == "buy" else -1))
    out = {}
    for h in range(t0, t1, 3600):
        s, _ = day_spread(sorted(by.get(h, [])))
        out[h] = "wide" if s is not None and s >= WIDE else "tight"
    return out


def arm_reading(a, cap):
    t0 = iso_s(a["start"])
    t1 = t0 + DAYS * 86400
    days = {str(d["day"])[:10]: d for d in a["days"]}
    keys = [(dt.datetime.utcfromtimestamp(t0) + dt.timedelta(days=i)).date().isoformat() for i in range(DAYS)]
    pnl = [float(days[k]["pnl_gbp"]) if k in days else 0.0 for k in keys]
    fills = sum(int(days[k]["fills"]) for k in keys if k in days)
    stale = sum(int(days[k]["stale_s"]) for k in keys if k in days)
    return {"window": [keys[0], keys[-1]], "days_recorded": sum(k in days for k in keys), "sum": round(sum(pnl), 4),
            "mean_a_day": round(sum(pnl) / DAYS, 4), "p_mean_le_0": boot(pnl, 3, n=10000, seed=20261031), "fills": fills,
            "stale_share": round(stale / (DAYS * 86400), 4),
            "placed_a_day": round(sum(int(days[k]["orders"]) for k in keys if k in days) / DAYS, 1),
            "days": dict(zip(keys, [round(x, 4) for x in pnl])), "t0": t0, "t1": t1}


def main(path):
    ex = read(path)
    caps = {"p600": 600.0, "p120": 120.0, "p1200": 1200.0}
    res = {"export": os.path.basename(path), "arms": {}}
    for arm, a in ex["arms"].items():
        res["arms"][arm] = arm_reading(a, caps[arm])
        res["arms"][arm]["by_kind"] = dict(collections.Counter(k for _, k in a.get("fills", [])))
    m = res["arms"]["p600"]
    t0, t1 = m.pop("t0"), m.pop("t1")
    for x in res["arms"].values():
        x.pop("t0", None), x.pop("t1", None)
    # void
    ts = sorted(int(p[0]) // 1000 for p in ex["prints"] if t0 <= int(p[0]) // 1000 < t1)
    gaps = [b - a for a, b in zip([t0] + ts, ts + [t1])]
    silent = max(gaps) if gaps else t1 - t0
    void = []
    if m["stale_share"] > VOID_STALE:
        void.append(f"no fair for {m['stale_share']:.1%} of the window's seconds")
    if silent >= VOID_SILENT_S:
        void.append(f"Revolut X printed nothing for {silent / 3600:.1f} hours running")
    # regimes
    hp = hour_pnl(ex["arms"]["p600"]["hours"], 600.0, t0, t1)
    reg = hour_regimes(ex["prints"], t0, t1)
    tight = [v for h, v in hp.items() if reg.get(h) == "tight"]
    wide = [v for h, v in hp.items() if reg.get(h) == "wide"]
    m["tight_hours"], m["tight_sum"] = len(tight), round(sum(tight), 4)
    m["wide_hours"], m["wide_sum"] = len(wide), round(sum(wide), 4)
    conds = {
        "1_sum_above_0": m["sum"] > 0,
        "2_p_below_0.10": m["p_mean_le_0"] is not None and m["p_mean_le_0"] < P_BAR,
        "3_tight_hours_not_negative": len(tight) < MIN_TIGHT_HOURS or sum(tight) >= 0,
        "4_at_least_100_fills": m["fills"] >= MIN_FILLS,
    }
    res["conditions"] = conds
    res["notes"] = [] if len(tight) >= MIN_TIGHT_HOURS else [f"only {len(tight)} tight hours: condition 3 counts as passed"]
    res["verdict"] = "VOID" if void else "PASS" if all(conds.values()) else "FAIL"
    res["void"] = void
    out = os.path.splitext(path)[0] + "_reading.json"
    with open(out, "w") as f:
        json.dump(res, f, indent=1, sort_keys=True)
    print(json.dumps({k: res[k] for k in ("verdict", "conditions", "void", "notes")}, indent=1))
    print({k: m[k] for k in ("sum", "mean_a_day", "p_mean_le_0", "fills", "tight_hours", "tight_sum", "wide_hours", "wide_sum", "stale_share")})


if __name__ == "__main__":
    main(sys.argv[1])
