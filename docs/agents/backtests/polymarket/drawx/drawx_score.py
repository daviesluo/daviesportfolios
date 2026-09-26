"""DRAW-X scorer: DRAWBASE's draw rule, unchanged, on La Liga, the Bundesliga, Ligue 1 and Serie A.

The pre-registration is docs/agents/reviews/2026-09-26-draw-x-prereg.md (frozen by commit 714a71c0).
The rule, the fill, the fee, the null and the stress are DRAWBASE's own code (drawbase.py). This file
adds only what the pre-registration replaced: the window (kickoff in [2025-08-01, 2026-09-21) UTC,
every trade scored together), each match's draw rate read from its own league's results, and the
nine conditions of the bar. It reads the committed input and nothing from the network.

Before it scores anything it proves that drawbase.py is DRAWBASE: it prints DRAWBASE's pin and, on
DRAWBASE's committed input, writes DRAWBASE's committed drawbase_run.json byte for byte. The two files
come from fp5's commit 31250cab:
  git show 31250cab:docs/agents/backtests/polymarket/inputs/drawbase_inputs.json.gz > drawbase_inputs.json.gz
  git show 31250cab:docs/agents/backtests/polymarket/results/drawbase_run.json > drawbase_run.json

usage: drawx_score.py --self-check <drawbase_inputs.json.gz> <drawbase_run.json>
       drawx_score.py <drawx_inputs.json.gz> <out.json> <drawbase_inputs.json.gz> <drawbase_run.json>
"""
import contextlib
import gzip
import hashlib
import io
import json
import os
import sys
from collections import defaultdict
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import drawbase as db  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
RULE = "DRAW-X"
PREREG = "reviews/2026-09-26-draw-x-prereg.md"
PREREG_PATH = os.path.normpath(os.path.join(HERE, "..", "..", "..", PREREG))
PREREG_SHA256 = "4d43a55253ac04ee23645a70a1ba99877e7f387890a3f80a2a1c5bbbab09f074"
DRAWBASE_INPUT_SHA256 = "772f9690ef83a87c79da214dd12bf9e5f5d5bac8c971e03995ea637495c89a81"
DRAWBASE_RUN_SHA256 = "07df6a9fd911e6a2748f86112a96acef9f08fd67aff6735ef534557d9e8af8c8"
PIN = "self-check ok D 0.25 88.560401\n"

# The four leagues, in the order that breaks a tie for the largest total (condition 7).
LEAGUES = ("laliga", "bundesliga", "ligue1", "seriea")
T_START = datetime(2025, 8, 1, tzinfo=timezone.utc).timestamp()
T_STOP = datetime(2026, 9, 21, tzinfo=timezone.utc).timestamp()
WINDOW_DAYS = (T_STOP - T_START) / 86400.0
MIN_TRADES = 300
MONTH_CAP = 0.40
CASH = 0.04
MAX_DISAGREEMENTS = 2
SCRIPTS = ("drawbase.py", "drawx_pull.py", "drawx_score.py", "drawx_check.py")
FROZEN = ("frozen_listed.txt", "frozen_kept.txt")


def in_window(end):
    return T_START <= end < T_STOP


def trades_from(events, scores):
    """epl_hold.trades_from, with DRAW-X's window where DRAWBASE's windows were, each match's draw rate read
    from its own league's results, and the league kept on the trade. Nothing else differs."""
    counts = defaultdict(int)
    incomplete = 0
    out = []
    for ev in events or []:
        end = ev.get("end")
        if end is None or not in_window(float(end)):
            counts["outside_window"] += 1
            continue
        counts["events"] += 1
        chosen = db.choose(ev, (scores or {}).get(ev.get("league")))
        stored = ev.get("picked")
        stored_side = None if not stored else stored.get("side")
        picked_side = None if chosen is None else chosen[0]
        if stored_side != picked_side:
            raise SystemExit(
                "picked side mismatch on %s: rule %s, pull %s" % (ev.get("slug"), picked_side, stored_side)
            )
        if chosen is None:
            counts["no_trade"] += 1
            continue
        side, fair = chosen
        market = (ev.get("markets") or {}).get(side)
        if market is None or stored.get("condition") != market.get("condition"):
            raise SystemExit("picked condition mismatch on %s" % ev.get("slug"))
        if stored.get("prints") == "incomplete":
            incomplete += 1
            counts["prints_incomplete"] += 1
            continue
        fills = db.walk_buys(
            stored.get("prints") or [], float(market["shown"]), float(market["tick"]), float(market["rate"]), fair,
        )
        if not fills:
            counts["under_min_fill"] += 1
            continue
        bought = sum(qty for _, _, qty in fills)
        closed = float(market.get("closed") or ev.get("closed") or end)
        counts["filled"] += 1
        out.append({
            "slug": ev["slug"], "series": ev.get("series"), "side": side,
            "fair": fair, "shown": float(market["shown"]),
            "fills": fills, "sells": [], "unsold": bought,
            "first": fills[0][0], "payout": float(market["payout_yes"]), "end": float(end),
            "closed": closed, "rate": float(market["rate"]), "tick": float(market["tick"]),
            "release": closed, "league": ev.get("league"),
        })
    out.sort(key=lambda c: (c["first"], c["slug"]))
    return out, dict(counts), incomplete


def best_league(totals):
    """The league with the largest total; a tie goes to the first of LEAGUES."""
    best = None
    for lg in LEAGUES:
        if best is None or totals[lg] > totals[best]:
            best = lg
    return best


def evaluate(trades, incomplete):
    """The nine conditions of the frozen bar, over every trade in the window."""
    pnl = [db.pnl_of(c) for c in trades]
    total = sum(pnl)
    stress = sum(db.pnl_of(c, 1, 2.0) for c in trades)
    nl = db.null_p95(trades) if trades else {"p95": None, "mean": None, "draws": 0}
    by_league = {lg: [c for c in trades if c["league"] == lg] for lg in LEAGUES}
    totals = {lg: sum(db.pnl_of(c) for c in by_league[lg]) for lg in LEAGUES}
    best = best_league(totals)
    others = [c for c in trades if c["league"] != best]
    others_total = sum(db.pnl_of(c) for c in others)
    nl_others = db.null_p95(others) if others else {"p95": None, "mean": None, "draws": 0}
    half = len(trades) // 2
    first_half = sum(pnl[:half])
    second_half = sum(pnl[half:])
    months = defaultdict(float)
    for c, p in zip(trades, pnl):
        months[db.month(c["first"])] += p
    best_m = max(months.values()) if months else 0.0
    best_month = None
    for k in sorted(months):
        if months[k] == best_m:
            best_month = k
            break
    peak = db.peak_capital(trades)
    ann = (total * 365.0 / WINDOW_DAYS / peak) if peak > 0 else None
    bar = {
        "1_at_least_300_trades": len(trades) >= MIN_TRADES,
        "2_total_pos_and_beats_null_p95": total > 0 and nl.get("p95") is not None and total > nl["p95"],
        "3_positive_in_three_leagues": sum(1 for lg in LEAGUES if totals[lg] > 0) >= 3,
        "4_both_halves_positive": first_half > 0 and second_half > 0,
        "5_not_one_month": total > 0 and best_m <= MONTH_CAP * total and (total - best_m) > 0,
        "6_stress_pos": stress > 0,
        "7_not_one_league": nl_others.get("p95") is not None and others_total > nl_others["p95"],
        "8_beats_cash": ann is not None and ann > CASH,
        "9_every_tape_complete": incomplete == 0,
    }
    res = {
        "ALL": db.summarise(trades),
        "total_pnl": db.r6(total),
        "stress_pnl": db.r6(stress),
        "null": nl,
        "league_totals": {lg: db.r6(totals[lg]) for lg in LEAGUES},
        "leagues_positive": sum(1 for lg in LEAGUES if totals[lg] > 0),
        "not_one_league": {"best_league": best, "others_trades": len(others), "others_pnl": db.r6(others_total),
                           "others_null": nl_others},
        "halves": {"first": {"trades": half, "pnl": db.r6(first_half)},
                   "second": {"trades": len(trades) - half, "pnl": db.r6(second_half)}},
        "by_month": {k: db.r6(v) for k, v in sorted(months.items())},
        "best_month": {"month": best_month, "pnl": db.r6(best_m),
                       "share_of_total": db.r6(best_m / total) if total else None,
                       "total_without_it": db.r6(total - best_m)},
        "peak_capital": db.r6(peak),
        "window_days": WINDOW_DAYS,
        "return_per_year_on_peak": db.r6(ann),
        "prints_incomplete": incomplete,
        "bar": bar,
        "passes": all(bar.values()),
    }
    return res


def vwap(c):
    return db.cost_of(c) / db.shares_of(c)


def table(trades):
    s = db.summarise(trades)
    if trades:
        s["mean_fill_price"] = db.r6(sum(vwap(c) for c in trades) / len(trades))
        s["draw_rate"] = db.r6(s["won"] / float(len(trades)))
        s["mean_fair"] = db.r6(sum(c["fair"] for c in trades) / len(trades))
        s["stress_pnl"] = db.r6(sum(db.pnl_of(c, 1, 2.0) for c in trades))
    return s


def bucket(p):
    lo = min(int(round(p * 1e6)) // 50000, 19) * 0.05
    return "%.2f-%.2f" % (lo, lo + 0.05)


def rate_of_draws(rows):
    n = len(rows)
    d = sum(1 for r in rows if r[1] >= 1.0 - 1e-12)
    return {"matches": n, "draws": d, "draw_rate": db.r6(d / float(n)) if n else None,
            "mean_screen_price": db.r6(sum(r[0] for r in rows) / n) if n else None}


def descriptive(events, trades, counts):
    traded = {c["slug"] for c in trades}
    out = {
        "counts": counts,
        "by_league": {lg: table([c for c in trades if c["league"] == lg]) for lg in LEAGUES},
        "by_month": {},
        "by_fee_rate": {},
    }
    months = sorted({db.month(c["first"]) for c in trades})
    for m in months:
        out["by_month"][m] = table([c for c in trades if db.month(c["first"]) == m])
    for r in sorted({c["rate"] for c in trades}):
        out["by_fee_rate"]["%.4f" % r] = table([c for c in trades if c["rate"] == r])
    # Over every match kept, traded or not: the screen price against how often the draw came.
    cal = defaultdict(lambda: {"all": [], "traded": [], "not_traded": []})
    no_price = defaultdict(int)
    for ev in events:
        if not in_window(float(ev["end"])):
            continue
        d = ev["markets"]["D"]
        if d.get("shown") is None:
            no_price[ev["league"]] += 1
            continue
        row = (float(d["shown"]), float(d["payout_yes"]))
        b = bucket(float(d["shown"]))
        cal[b]["all"].append(row)
        cal[b]["traded" if ev["slug"] in traded else "not_traded"].append(row)
    out["screen_price_vs_draws"] = {
        b: {k: rate_of_draws(v) for k, v in sorted(cal[b].items())} for b in sorted(cal)
    }
    out["screen_price_vs_draws_by_league"] = {}
    for lg in LEAGUES:
        rows = [(float(ev["markets"]["D"]["shown"]), float(ev["markets"]["D"]["payout_yes"]), ev["slug"] in traded)
                for ev in events if ev["league"] == lg and in_window(float(ev["end"]))
                and ev["markets"]["D"].get("shown") is not None]
        out["screen_price_vs_draws_by_league"][lg] = {
            "all": rate_of_draws([(a, b) for a, b, _ in rows]),
            "traded": rate_of_draws([(a, b) for a, b, t in rows if t]),
            "not_traded": rate_of_draws([(a, b) for a, b, t in rows if not t]),
        }
    out["matches_without_a_screen_price"] = {lg: no_price[lg] for lg in LEAGUES}
    out["trades"] = [
        [c["slug"], c["league"], datetime.fromtimestamp(c["first"], timezone.utc).strftime("%Y-%m-%d %H:%M:%S"),
         db.r6(c["fair"]), db.r6(c["shown"]), db.r6(vwap(c)), db.r6(db.shares_of(c)), db.r6(db.cost_of(c)),
         db.r6(db.fees_of(c)), c["payout"], db.r6(db.pnl_of(c)), db.r6(db.pnl_of(c, 1, 2.0))]
        for c in trades
    ]
    out["trades_columns"] = ["slug", "league", "first_fill_utc", "fair", "screen_price", "fill_price", "shares",
                             "cost", "fees", "payout", "pnl", "stress_pnl"]
    return out


def payouts_against_results(events, scores, trades):
    """Validity: every traded match's draw payout against its score row (a draw pays 1, anything else 0)."""
    def check(ev):
        rows = [r for r in (scores.get(ev["league"]) or [])
                if int(float(r["kick"]) // 60) == int(float(ev["end"]) // 60)
                and frozenset((r["home"], r["away"])) == frozenset((ev["home"], ev["away"]))]
        if len(rows) != 1:
            return {"slug": ev["slug"], "score_rows": len(rows)}
        want = 1.0 if db.result_of(rows[0]) == "D" else 0.0
        got = float(ev["markets"]["D"]["payout_yes"])
        if abs(want - got) > 1e-12:
            return {"slug": ev["slug"], "payout": got, "score": "%s %d-%d %s" % (
                rows[0]["home"], int(rows[0]["hg"]), int(rows[0]["ag"]), rows[0]["away"])}
        return None

    by_slug = {ev["slug"]: ev for ev in events}
    traded = [check(by_slug[c["slug"]]) for c in trades]
    every = [check(ev) for ev in events if in_window(float(ev["end"]))]
    bad = [x for x in traded if x is not None]
    return {
        "traded_matches": len(trades),
        "disagreements": bad,
        "void": len(bad) > MAX_DISAGREEMENTS,
        "all_kept_matches": len(every),
        "all_kept_disagreements": [x for x in every if x is not None],
    }


def sha256_of(path):
    if not os.path.exists(path):
        return None
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def prove_drawbase(inputs_path, run_path):
    """DRAWBASE's pin, and drawbase_run.json written byte for byte from DRAWBASE's committed input."""
    got_in, got_run = sha256_of(inputs_path), sha256_of(run_path)
    if got_in != DRAWBASE_INPUT_SHA256 or got_run != DRAWBASE_RUN_SHA256:
        raise SystemExit("DRAWBASE's committed files do not hash as committed: %s %s" % (got_in, got_run))
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        db.self_check()
    if buf.getvalue() != PIN:
        raise SystemExit("DRAWBASE's pin: %r" % buf.getvalue())
    with gzip.open(inputs_path, "rt") as f:
        data = json.load(f)
    text = json.dumps(db.run(data), indent=2, sort_keys=True) + "\n"
    with open(run_path, "rb") as f:
        want = f.read()
    if text.encode() != want:
        raise SystemExit("drawbase_run.json was not reproduced byte for byte")
    return {"pin": PIN.strip(), "drawbase_run_reproduced_byte_for_byte": True,
            "drawbase_input_sha256": got_in, "drawbase_run_sha256": got_run, "commit": "31250cab"}


def drawx_pins():
    """DRAW-X's own additions on made-up trades: the window, league scores, the tie rule, halves, months."""
    if WINDOW_DAYS != 416.0:
        raise SystemExit("window days %s" % WINDOW_DAYS)
    if in_window(T_STOP) or not in_window(T_START) or in_window(T_START - 1):
        raise SystemExit("window edges")
    if best_league({"laliga": 5.0, "bundesliga": 5.0, "ligue1": 1.0, "seriea": 5.0}) != "laliga":
        raise SystemExit("tie")
    if best_league({"laliga": 0.0, "bundesliga": 0.0, "ligue1": 0.0, "seriea": 1.0}) != "seriea":
        raise SystemExit("best league")
    if bucket(0.249) != "0.20-0.25" or bucket(0.25) != "0.25-0.30" or bucket(1.0) != "0.95-1.00" \
            or bucket(0.0) != "0.00-0.05" or bucket(0.05 * 3) != "0.15-0.20":
        raise SystemExit("buckets")
    # One La Liga match, one Serie A match: each read against its own league's results only.
    end = datetime(2025, 9, 21, 14, 0, tzinfo=timezone.utc).timestamp()
    draws = [db.played(i, "A%d" % i, "B%d" % i, 1, 1) for i in range(8)]
    homes = [db.played(i, "A%d" % i, "B%d" % i, 1, 0) for i in range(8)]
    board = {"D": db.market("D", 0.10, payout=1.0, end=end)}
    ev1 = db.pack("lal-x", end, "HOT", "COLD", board, "D", db.prints_for(end))
    ev1["league"] = "laliga"
    ev2 = db.pack("sea-x", end, "HOT", "COLD", dict(board), None, None)
    ev2["league"] = "seriea"
    late = db.pack("lal-late", T_STOP + 3600, "HOT", "COLD", dict(board), None, None)
    late["league"] = "laliga"
    trades, counts, inc = trades_from([ev1, ev2, late], {"laliga": draws, "seriea": homes})
    if len(trades) != 1 or trades[0]["league"] != "laliga" or trades[0]["fair"] != 1.0 or inc != 0:
        raise SystemExit("league scores %s %s" % (trades, counts))
    if counts != {"events": 2, "filled": 1, "no_trade": 1, "outside_window": 1}:
        raise SystemExit("counts %s" % counts)
    # Condition 7 reads the three leagues other than the best one.
    base = trades[0]
    made = []
    for i, (lg, pay) in enumerate((("laliga", 1.0), ("laliga", 1.0), ("seriea", 0.0), ("ligue1", 0.0))):
        c = dict(base)
        c["slug"], c["league"], c["payout"] = "t%d" % i, lg, pay
        c["first"] = base["first"] + i * 40 * 86400.0
        made.append(c)
    res = evaluate(made, 0)
    if res["not_one_league"]["best_league"] != "laliga" or res["not_one_league"]["others_trades"] != 2:
        raise SystemExit("not one league %s" % res["not_one_league"])
    if res["halves"]["first"]["trades"] != 2 or res["bar"]["4_both_halves_positive"]:
        raise SystemExit("halves %s" % res["halves"])
    if res["bar"]["1_at_least_300_trades"] or res["leagues_positive"] != 1:
        raise SystemExit("counts in the bar")
    if len(res["by_month"]) != 4 or res["bar"]["5_not_one_month"]:
        raise SystemExit("months %s" % res["by_month"])
    return True


def main_self_check(inputs_path, run_path):
    proof = prove_drawbase(inputs_path, run_path)
    drawx_pins()
    print(proof["pin"], "| drawbase_run.json reproduced byte for byte, sha256", proof["drawbase_run_sha256"],
          "| DRAW-X pins ok")


def main_score(inputs_path, out_path, db_inputs, db_run):
    proof = prove_drawbase(db_inputs, db_run)
    drawx_pins()
    with gzip.open(inputs_path, "rt") as f:
        data = json.load(f)
    events, scores = data.get("events") or [], data.get("scores") or {}
    trades, counts, incomplete = trades_from(events, scores)
    result = evaluate(trades, incomplete)
    result["counts"] = counts
    checks = payouts_against_results(events, scores, trades)
    prereg_sha = sha256_of(PREREG_PATH)
    out = {
        "rule": RULE,
        "prereg": PREREG,
        "result": result,
        "descriptive": descriptive(events, trades, counts),
        "validity": {
            "drawbase": proof,
            "payouts_against_results": checks,
            "prereg_sha256_matches_freeze": prereg_sha == PREREG_SHA256,
            "void": bool(checks["void"]) or prereg_sha != PREREG_SHA256,
        },
        "hashes": {
            "prereg": prereg_sha,
            "prereg_frozen": PREREG_SHA256,
            "input": sha256_of(inputs_path),
            "pull_report": sha256_of(os.path.join(HERE, "pull_report.json")),
            "frozen_lists": {name: sha256_of(os.path.join(HERE, name)) for name in FROZEN},
            "scripts": {name: sha256_of(os.path.join(HERE, name)) for name in SCRIPTS},
        },
    }
    with open(out_path, "w") as f:
        json.dump(out, f, indent=2, sort_keys=True)
        f.write("\n")
    print("passes", result["passes"], "trades", result["ALL"]["trades"], "total", result["total_pnl"],
          "bar", result["bar"], "void", out["validity"]["void"])


if __name__ == "__main__":
    if len(sys.argv) == 4 and sys.argv[1] == "--self-check":
        main_self_check(sys.argv[2], sys.argv[3])
    elif len(sys.argv) == 5:
        main_score(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4])
    else:
        raise SystemExit(__doc__)
