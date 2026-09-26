"""DRAW-X check: twenty trades read again from the public feeds ("Fills read again" in the pre-registration).

Twenty trades are drawn with random.Random(20260926).sample from the scorer's trades, in the scorer's order.
For each one:
* every fill is found again in /v2/trades?condition=...&taker_only=true, which is not the feed the input was
  pulled from, at its second: a YES buy at or below the fill price, or a NO sell at or above one minus it, of
  at least the fill's size, and no print is used for two fills;
* the payout and the fee schedule are read again from Gamma (/markets/keyset by condition id);
* the P&L recomputed from those agrees with the scorer's within $0.00001.
It also checks that the scorer's trade list in drawx.json is the one the committed input gives.
Keyless GETs only; nothing is placed.

usage: drawx_check.py <drawx_inputs.json.gz> <drawx.json> <out.json>
"""
import gzip
import hashlib
import json
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import drawbase as db  # noqa: E402
import drawx_pull as pull  # noqa: E402
import drawx_score as score  # noqa: E402

SEED = 20260926
SAMPLE = 20
TOLERANCE = 1e-5
MAX_PAGES = 400


def v2_rows(cond, t_lo, t_hi):
    rows, cursor = [], None
    for _ in range(MAX_PAGES):
        params = {"condition": cond, "limit": 1000, "taker_only": "true"}
        if cursor:
            params["cursor"] = cursor
        d = pull.get(pull.DATA + "/v2/trades", params)
        data = d.get("data") or []
        for r in data:
            ts = float(r.get("timestamp") or 0)
            if t_lo <= ts <= t_hi:
                rows.append(r)
        cursor = (d.get("pagination") or {}).get("next_cursor")
        if not cursor or not data or float(data[-1].get("timestamp") or 0) < t_lo:
            return rows, True
    return rows, False


def find(fills, rows):
    used, found = set(), 0
    for ts, px, qty in fills:
        for i, r in enumerate(rows):
            if i in used or int(float(r.get("timestamp") or 0)) != int(ts):
                continue
            oi, side = r.get("outcome_index"), r.get("side")
            price, size = float(r.get("price")), float(r.get("size"))
            ok_price = (oi == 0 and side == "BUY" and price <= px + 1e-9) or \
                       (oi == 1 and side == "SELL" and price >= 1.0 - px - 1e-9)
            if ok_price and size >= qty - 1e-9:
                used.add(i)
                found += 1
                break
    return found


def gamma_market(cond):
    for path, params in (("/markets/keyset", {"condition_ids": cond, "closed": "true", "limit": 5}),
                         ("/markets", {"condition_ids": cond, "closed": "true", "limit": 5})):
        try:
            d = pull.get(pull.GAMMA + path, params)
        except RuntimeError:
            continue
        ms = d.get("markets") if isinstance(d, dict) else d
        for m in ms or []:
            if m.get("conditionId") == cond:
                return m
    return None


def payout_of(m):
    try:
        pay = float(json.loads(m.get("outcomePrices") or "[]")[0])
    except (TypeError, ValueError, IndexError):
        return None
    if pay >= 0.99:
        return 1.0
    if pay <= 0.01:
        return 0.0
    return pay


def main():
    inputs_path, result_path, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
    with gzip.open(inputs_path, "rt") as f:
        data = json.load(f)
    trades, _counts, _inc = score.trades_from(data.get("events"), data.get("scores"))
    with open(result_path, "rb") as f:
        body = f.read()
    listed = json.loads(body)["descriptive"]["trades"]
    same = len(listed) == len(trades) and all(
        row[0] == c["slug"] and abs(row[10] - db.r6(db.pnl_of(c))) < 1e-12 for row, c in zip(listed, trades))
    conds = {ev["slug"]: ev["markets"]["D"]["condition"] for ev in data.get("events") or []}
    sample = random.Random(SEED).sample(trades, min(SAMPLE, len(trades)))
    out, n_fills, n_found, n_pay, n_rate, worst = [], 0, 0, 0, 0, 0.0
    for c in sample:
        cond = conds[c["slug"]]
        t_lo = min(ts for ts, _, _ in c["fills"])
        t_hi = max(ts for ts, _, _ in c["fills"])
        rows, complete = v2_rows(cond, t_lo, t_hi)
        found = find(c["fills"], rows)
        m = gamma_market(cond)
        pay = None if m is None else payout_of(m)
        rate = None if m is None else db.rate_of(m)
        if pay is None or rate is None:
            again = None
        else:
            again = sum(q * (pay - px) - rate * px * (1.0 - px) * q for _, px, q in c["fills"])
        pnl = db.pnl_of(c)
        diff = None if again is None else abs(again - pnl)
        n_fills += len(c["fills"])
        n_found += found
        n_pay += 1 if pay is not None and abs(pay - c["payout"]) < 1e-12 else 0
        n_rate += 1 if rate is not None and abs(rate - c["rate"]) < 1e-12 else 0
        worst = max(worst, diff if diff is not None else float("inf"))
        out.append({"slug": c["slug"], "league": c["league"], "fills": len(c["fills"]), "fills_found": found,
                    "feed_walk_complete": complete, "payout": c["payout"], "payout_gamma": pay,
                    "rate": c["rate"], "rate_gamma": rate, "pnl": db.r6(pnl),
                    "pnl_recomputed": db.r6(again), "difference": diff})
        print(c["slug"], "fills", found, "/", len(c["fills"]), "payout", c["payout"], pay, "diff", diff, flush=True)
    res = {
        "drawx_json_sha256": hashlib.sha256(body).hexdigest(),
        "input_sha256": hashlib.sha256(open(inputs_path, "rb").read()).hexdigest(),
        "trade_list_matches_input": same,
        "seed": SEED, "sampled": len(sample),
        "fills": n_fills, "fills_found_again": n_found,
        "payouts_agree": n_pay, "fee_rates_agree": n_rate,
        "largest_pnl_difference": worst,
        "tolerance": TOLERANCE,
        "passes": same and n_found == n_fills and n_pay == len(sample) and n_rate == len(sample) and worst <= TOLERANCE,
        "samples": out,
    }
    with open(out_path, "w") as f:
        json.dump(res, f, indent=2, sort_keys=True)
        f.write("\n")
    print("passes", res["passes"], "fills", n_found, "/", n_fills, "payouts", n_pay, "rates", n_rate,
          "largest difference", worst)


if __name__ == "__main__":
    main()
