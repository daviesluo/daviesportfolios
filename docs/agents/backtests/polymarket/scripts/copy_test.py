"""COPY: follow five May ladder wallets into the next three months (fp5).

The rule is this file. copy_inputs.py only fetches what the pre-registration names.
Reads the committed gzip. `--self-check` pins the fill and the ranking on a hand
case and does not read a file.

usage: copy_test.py --self-check
       copy_test.py <inputs.json.gz> <out.json>
"""
import gzip
import json
import random
import sys
from collections import defaultdict
from datetime import datetime, timezone

STAKE = 5.0
MIN_FILL = 2.0
LIMIT = 0.99
LAG = 300
MIN_PRINTS = 5
MIN_POSITIONS = 10
TOP_N = 5
NULL_DRAWS = 10000
SEED = 20260925
OOS_DAYS = 102.0

# Seen before the freeze and excluded by name. The 25 are the crypto month
# leaderboard read on 2026-09-25; the last one is the single May page whose
# June trade count was read (it was zero) while checking the endpoint.
EXCLUDED = frozenset({
    "0x111f73e91f85b6fe4de1ddec3de2fe32122e355b",
    "0x1465b79bff7992bc703e1aafb3683b1089647072",
    "0x06dc51826bc524d9a83770e7de9dd7e005b04524",
    "0x0cb038487586d1119b165466072e9baf666f3a90",
    "0x41e2e1ccf1e4940029af02259a31c6b89b9fa354",
    "0x32ed2e546b187ca15e2841edc82b22c713cf8ec3",
    "0xc2ad03f79ca3f3c17d8c7de2612ce0c89b7d40ed",
    "0xb87532a1a04c654700aa8153b3a95675ac4f4b16",
    "0x3725d52f3c252e8374999cc8617292ea2608ad88",
    "0x974da1d69a42f1db94b481a39621bfbafd41b050",
    "0xf53e7cc2894cba22dcdc40de936513a502ef16e3",
    "0xe609d476ebecc64e55788b4595fc53c343a1d4d4",
    "0x20d2309cd92b797ae7ca175ed828ed8a27fbe29d",
    "0xa19cbababc312f9df185e49d7004c249ed1ade6b",
    "0x4f1d5ae26fc31472966e951af3183308736d8de2",
    "0x19c3b385be5667154fc69c87d8f7914be84087c1",
    "0x42d150e0171590b28332a61b3f4cfca0a34cdab6",
    "0xce50c96b976203b53342a0a801067d2cdcfcf46e",
    "0x44832d0d2ec11187c1e77d786feb15f6a50254c6",
    "0x074a3a0ffc6e1077a9d7fcbd774029e0cc6ef0e0",
    "0x091ccc435273c422260279c8a8277170b2dc182e",
    "0xc387c2a40d389f17b723b6bba9b18b7dbd2de4f4",
    "0x21d0a97aac03917e752857a551bbe5103a00e8d7",
    "0xc53375ff94e96100f2b30a4b5775db35218d69a9",
    "0xca79076e2d13b8930e0c3a4649c06c65449a4796",
    "0x229ac650228719605849362bb1bd4271af78e62b",
})


def utc_date(y, m, d):
    return int(datetime(y, m, d, tzinfo=timezone.utc).timestamp())


MAY_START = utc_date(2026, 5, 1)
CUT = utc_date(2026, 6, 1)
SPLIT = utc_date(2026, 7, 21)
OOS_END = utc_date(2026, 9, 11)


def r6(x):
    return None if x is None else round(float(x), 6)


def fee(rate, p):
    return rate * p * (1.0 - p)


def rank_wallets(may_counts, closed, closed_incomplete):
    """Top TOP_N by pre-June ladder realised P&L. Ties: lower address.

    A wallet with an incomplete closed-position pull is not ranked.
    """
    incomplete = {w.lower() for w in (closed_incomplete or [])}
    scored = []
    for wallet, n in (may_counts or {}).items():
        w = str(wallet).lower()
        if w in EXCLUDED or w in incomplete or int(n) < MIN_PRINTS:
            continue
        rows = []
        for rec in closed.get(w) or []:
            ts = float(rec["timestamp"])
            if ts >= CUT or not event_ok(rec.get("eventSlug")):
                continue
            rows.append(float(rec["realizedPnl"]))
        if len(rows) < MIN_POSITIONS:
            continue
        scored.append((sum(rows), w, len(rows)))
    scored.sort(key=lambda x: (-x[0], x[1]))
    return scored[:TOP_N]


def event_ok(slug):
    if not slug or not isinstance(slug, str):
        return False
    parts = slug.split("-")
    # bitcoin-above-on-<month>-<day> or bitcoin-above-on-<month>-<day>-<year>
    if len(parts) < 5 or parts[0] != "bitcoin" or parts[1] != "above" or parts[2] != "on":
        return False
    if "am" in parts or "pm" in parts or "et" in parts:
        return False
    month, day = parts[3], parts[4]
    if not month.isalpha() or not day.isdigit():
        return False
    if len(parts) == 5:
        return True
    if len(parts) == 6 and parts[5].isdigit() and len(parts[5]) == 4:
        return True
    return False


def _qualifies(buy, print_row):
    ts, side, oi, price, size, wallet = print_row[:6]
    if side != "BUY":
        return False
    if str(wallet).lower() == buy["wallet"]:
        return False
    if int(oi) != int(buy["outcomeIndex"]):
        return False
    if not (buy["ts"] < float(ts) <= buy["ts"] + LAG):
        return False
    if float(price) + 1e-12 < float(buy["price"]):
        return False
    if float(price) > LIMIT:
        return False
    if float(size) * float(price) < MIN_FILL:
        return False
    return True


def copies_of(buys, tapes):
    """One copy per leader BUY. A tape print fills at most one copy."""
    by_cond = defaultdict(list)
    for b in buys or []:
        w = str(b["wallet"]).lower()
        if w in EXCLUDED:
            continue
        if b.get("side") != "BUY":
            continue
        if not event_ok(b.get("eventSlug")):
            continue
        ts = float(b["ts"])
        if not (CUT <= ts < OOS_END):
            continue
        by_cond[b["condition"]].append({
            "wallet": w, "ts": ts, "price": float(b["price"]),
            "outcomeIndex": int(b["outcomeIndex"]), "tx": str(b.get("tx") or ""),
            "eventSlug": b.get("eventSlug"), "condition": b["condition"],
        })
    trades = []
    skipped = defaultdict(int)
    for cond, bs in by_cond.items():
        tape = (tapes or {}).get(cond)
        if not tape or tape.get("incomplete"):
            skipped["incomplete"] += len(bs)
            continue
        if tape.get("outcomes") != ["Yes", "No"]:
            skipped["outcomes"] += len(bs)
            continue
        prints = sorted(tape.get("prints") or [], key=lambda p: (float(p[0]), str(p[6]), str(p[5]).lower()))
        used = set()
        for b in sorted(bs, key=lambda x: (x["ts"], x["tx"], x["wallet"])):
            if b["ts"] >= float(tape["end"]):
                skipped["after_end"] += 1
                continue
            chosen = None
            for i, p in enumerate(prints):
                if i in used or not _qualifies(b, p):
                    continue
                chosen = i
                break
            if chosen is None:
                skipped["no_fill"] += 1
                continue
            p = prints[chosen]
            price = float(p[3])
            dollars = min(STAKE, float(p[4]) * price)
            shares = dollars / price
            oi = int(b["outcomeIndex"])
            used.add(chosen)
            trades.append({
                "wallet": b["wallet"], "condition": cond, "slug": b["eventSlug"],
                "side": "YES" if oi == 0 else "NO",
                "fills": [(float(p[0]), price, shares)],
                "first": b["ts"], "payout": float(tape["payouts"][oi]),
                "end": float(tape["end"]), "closed": float(tape["closed"]),
                "rate": float(tape["rate"]), "tick": float(tape["tick"]),
            })
    trades.sort(key=lambda c: (c["first"], c["condition"], c["wallet"], c["side"]))
    return trades, dict(skipped)


def pnl_of(c, tick_shift=0, fee_mult=1.0):
    tot = 0.0
    for _, px, qty in c["fills"]:
        p = px + tick_shift * c["tick"]
        tot += qty * (c["payout"] - p) - fee_mult * fee(c["rate"], p) * qty
    return tot


def cost_of(c):
    return sum(px * qty for _, px, qty in c["fills"])


def shares_of(c):
    return sum(qty for _, _, qty in c["fills"])


def fees_of(c):
    return sum(fee(c["rate"], px) * qty for _, px, qty in c["fills"])


def peak_capital(trades):
    ev = []
    for c in trades:
        ev.append((c["fills"][0][0], cost_of(c)))
        ev.append((max(c["closed"], c["fills"][0][0]), -cost_of(c)))
    ev.sort()
    cur = peak = 0.0
    for _, d in ev:
        cur += d
        peak = max(peak, cur)
    return peak


def summarise(trades):
    if not trades:
        return {"trades": 0, "pnl": 0.0, "cost": 0.0, "fees": 0.0, "won": 0, "lost": 0,
                "partial_payout": 0, "buy_yes": 0, "buy_no": 0, "pnl_per_dollar": None}
    p = [pnl_of(c) for c in trades]
    cost = sum(cost_of(c) for c in trades)
    wins = sum(1 for c in trades if c["payout"] >= 1.0 - 1e-12)
    part = sum(1 for c in trades if 0.0 < c["payout"] < 1.0 - 1e-12)
    yes = sum(1 for c in trades if c["side"] == "YES")
    return {
        "trades": len(trades), "pnl": r6(sum(p)), "cost": r6(cost), "fees": r6(sum(fees_of(c) for c in trades)),
        "won": wins, "partial_payout": part, "lost": len(trades) - wins - part,
        "buy_yes": yes, "buy_no": len(trades) - yes,
        "pnl_per_dollar": r6(sum(p) / cost) if cost else None,
    }


def null_p95(trades):
    rng = random.Random(SEED)
    base = []
    for c in trades:
        sh, co = shares_of(c), cost_of(c)
        base.append((sh, co, fees_of(c), co / sh))
    draws = []
    for _ in range(NULL_DRAWS):
        tot = 0.0
        for sh, co, fe, q in base:
            tot += (sh if rng.random() < q else 0.0) - co - fe
        draws.append(tot)
    draws.sort()
    return {"mean": r6(sum(draws) / len(draws)), "p95": r6(draws[int(0.95 * len(draws))]), "draws": NULL_DRAWS}


def month_of(ts):
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m")


def evaluate(trades, skipped, buys_incomplete):
    halves = {"OOS1": [], "OOS2": []}
    for c in trades:
        if CUT <= c["first"] < SPLIT:
            halves["OOS1"].append(c)
        elif SPLIT <= c["first"] < OOS_END:
            halves["OOS2"].append(c)
    oos = halves["OOS1"] + halves["OOS2"]
    res = {w: summarise(halves[w]) for w in ("OOS1", "OOS2")}
    res["OOS"] = summarise(oos)
    oos_pnl = sum(pnl_of(c) for c in oos)
    stress = sum(pnl_of(c, 1, 2.0) for c in oos)
    res["stress_OOS_pnl"] = r6(stress)
    nl = null_p95(oos) if oos else {"p95": None, "mean": None, "draws": 0}
    res["null"] = nl
    months = defaultdict(float)
    for c in oos:
        months[month_of(c["first"])] += pnl_of(c)
    res["oos_by_month"] = {k: r6(v) for k, v in sorted(months.items())}
    best_m = max(months.values()) if months else 0.0
    peak = peak_capital(oos)
    ann = (oos_pnl * 365.0 / OOS_DAYS / peak) if peak > 0 else None
    res["oos_peak_capital"] = r6(peak)
    res["oos_days"] = OOS_DAYS
    res["oos_return_per_year_on_peak"] = r6(ann)
    res["skipped"] = skipped
    res["buys_incomplete"] = list(buys_incomplete or [])
    res["bar"] = {
        "1_oos_pos_and_both_halves": oos_pnl > 0 and sum(pnl_of(c) for c in halves["OOS1"]) > 0 and sum(pnl_of(c) for c in halves["OOS2"]) > 0,
        "2_beats_null_p95": nl.get("p95") is not None and oos_pnl > nl["p95"],
        "3_stress_pos": stress > 0,
        "4_at_least_80_trades": len(oos) >= 80,
        "5_not_one_month": oos_pnl > 0 and best_m <= 0.40 * oos_pnl and (oos_pnl - best_m) > 0,
        "6_beats_cash": ann is not None and ann > 0.04,
    }
    # A missing page is not a sample. Positive or negative, it cannot pass.
    res["passes"] = all(res["bar"].values()) and skipped.get("incomplete", 0) == 0 and not buys_incomplete
    return res


def run(data):
    leaders = rank_wallets(data.get("may_counts"), data.get("closed"), data.get("closed_incomplete"))
    names = [w for _, w, _ in leaders]
    pulled = [str(w).lower() for w in data.get("leaders_pulled") or []]
    if names != pulled:
        raise SystemExit("leaders mismatch: rule %s, pull %s" % (names, pulled))
    trades, skipped = copies_of(data.get("buys"), data.get("tapes"))
    out = evaluate(trades, skipped, data.get("buys_incomplete"))
    out["leaders"] = [{"wallet": w, "pre_june_pnl": r6(pnl), "positions": n} for pnl, w, n in leaders]
    out["trades_n"] = len(trades)
    return {
        "rule": "COPY",
        "prereg": "reviews/2026-09-25-polymarket-fp5-prereg-copy-wallets.md",
        "leaders": names,
        "result": out,
    }


def _tape(prints, payouts=("1", "0")):
    return {
        "prints": prints, "payouts": [float(payouts[0]), float(payouts[1])],
        "outcomes": ["Yes", "No"], "end": OOS_END, "closed": OOS_END,
        "rate": 0.07, "tick": 0.01, "incomplete": False,
    }


def _buy(wallet, ts, price, oi=0, tx="L"):
    return {
        "wallet": wallet, "condition": "C", "eventSlug": "bitcoin-above-on-june-2",
        "side": "BUY", "ts": ts, "price": price, "outcomeIndex": oi, "tx": tx,
    }


def self_check():
    assert CUT - MAY_START == 31 * 86400
    assert OOS_END - CUT == 102 * 86400
    assert SPLIT - CUT == 50 * 86400
    assert event_ok("bitcoin-above-on-june-2")
    assert event_ok("bitcoin-above-on-september-10-2026")
    assert not event_ok("bitcoin-above-on-june-2-8am-et")
    assert not event_ok("bitcoin-above-76k-on-may-1")
    assert len(EXCLUDED) == 26

    leader = "0x" + "ab" * 20
    other = "0x" + "cd" * 20
    t0 = CUT + 1000
    # Earliest qualifying print: someone else buys YES at 0.42, size large, 100s later.
    # A better price, a same-wallet print, a sell, a late print and a tiny print do not fill.
    prints = [
        [t0 + 10, "BUY", 0, 0.39, 100.0, other, "a"],
        [t0 + 20, "BUY", 0, 0.42, 100.0, leader, "b"],
        [t0 + 30, "SELL", 0, 0.50, 100.0, other, "c"],
        [t0 + 40, "BUY", 0, 0.42, 1.0, other, "d"],
        [t0 + 50, "BUY", 0, 0.42, 100.0, other, "e"],
        [t0 + 301, "BUY", 0, 0.42, 100.0, other, "f"],
        [t0 + 60, "BUY", 0, 0.42, 100.0, other, "g"],
    ]
    trades, skipped = copies_of([_buy(leader, t0, 0.40)], {"C": _tape(prints)})
    if len(trades) != 1 or abs(trades[0]["fills"][0][1] - 0.42) > 1e-12:
        raise SystemExit("fill pin failed %s %s" % (len(trades), skipped))
    if trades[0]["fills"][0][0] != t0 + 50:
        raise SystemExit("took the wrong print %s" % trades[0]["fills"][0])
    shares = 5.0 / 0.42
    hand = shares * (1.0 - 0.42) - 0.07 * 0.42 * 0.58 * shares
    if abs(pnl_of(trades[0]) - hand) > 1e-9:
        raise SystemExit("pnl %s != %s" % (pnl_of(trades[0]), hand))
    hand_s = shares * (1.0 - 0.43) - 2 * 0.07 * 0.43 * 0.57 * shares
    if abs(pnl_of(trades[0], 1, 2.0) - hand_s) > 1e-9:
        raise SystemExit("stress pin failed")

    # Two leader buys, one later print: only the earlier buy is filled.
    prints2 = [[t0 + 50, "BUY", 0, 0.42, 100.0, other, "e"]]
    two, _ = copies_of([_buy(leader, t0, 0.40, tx="1"), _buy(leader, t0 + 10, 0.40, tx="2")], {"C": _tape(prints2)})
    if len(two) != 1:
        raise SystemExit("a print filled two copies")

    # Over 0.99 does not fill.
    dear = [[t0 + 50, "BUY", 0, 0.995, 100.0, other, "e"]]
    none, _ = copies_of([_buy(leader, t0, 0.40)], {"C": _tape(dear)})
    if none:
        raise SystemExit("filled through the limit")

    # Ranking: excluded, short history, post-cut rows, incomplete, and a tie.
    low = "0x" + "11" * 20
    high = "0x" + "ff" * 20
    closed = {}
    counts = {}
    for w, pnl in ((low, 10.0), (high, 10.0), (leader, 50.0)):
        counts[w] = 5
        closed[w] = [{"eventSlug": "bitcoin-above-on-may-2", "timestamp": MAY_START + 10, "realizedPnl": pnl / 10.0} for _ in range(10)]
    counts["0x111f73e91f85b6fe4de1ddec3de2fe32122e355b"] = 100
    closed["0x111f73e91f85b6fe4de1ddec3de2fe32122e355b"] = [
        {"eventSlug": "bitcoin-above-on-may-2", "timestamp": MAY_START + 10, "realizedPnl": 1e9} for _ in range(10)]
    short = "0x" + "22" * 20
    counts[short] = 5
    closed[short] = [{"eventSlug": "bitcoin-above-on-may-2", "timestamp": MAY_START + 10, "realizedPnl": 1.0} for _ in range(9)]
    late = "0x" + "33" * 20
    counts[late] = 5
    closed[late] = [{"eventSlug": "bitcoin-above-on-may-2", "timestamp": CUT, "realizedPnl": 1e6} for _ in range(10)]
    inc = "0x" + "44" * 20
    counts[inc] = 5
    closed[inc] = [{"eventSlug": "bitcoin-above-on-may-2", "timestamp": MAY_START, "realizedPnl": 1e6} for _ in range(10)]
    ranked = rank_wallets(counts, closed, [inc])
    got = [w for _, w, _ in ranked]
    if got != [leader, low, high]:
        raise SystemExit("rank pin %s" % got)

    empty = evaluate([], {}, [])
    if empty["passes"] or empty["bar"]["1_oos_pos_and_both_halves"]:
        raise SystemExit("empty book passed")
    print("self-check ok", round(hand, 6))


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "--self-check":
        self_check()
    else:
        with gzip.open(sys.argv[1], "rt") as f:
            data = json.load(f)
        out = run(data)
        with open(sys.argv[2], "w") as f:
            json.dump(out, f, indent=2, sort_keys=True)
            f.write("\n")
        print("passes", out["result"]["passes"], "oos", out["result"]["OOS"], "bar", out["result"]["bar"])
