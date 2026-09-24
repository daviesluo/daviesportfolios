"""Re-derive a test's sample trades from a FRESH read of the public feeds (fp4 checks).

For each trade in a result's `sample_trades` (fav_test.py and wx_test.py write
twenty, chosen by a fixed seed): the market's taker prints are read again from
/v2/trades?condition= (not from the raw pulls the test's inputs were built from),
and every fill is matched to a print at its second, on the favoured side, at or
below the fill price (to the sample's six decimals) and at least its size; the
payout is read again from Gamma; the P&L is recomputed
from the fills, the payout and the fee `r × p × (1 − p)`. Prints the result:
matched fills, payout agreement, and the largest P&L difference.

usage: check_samples.py <result json> [horizon]   (FAV results carry trades per horizon; default 24)
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import pmnet  # noqa: E402

DATA_API = "https://data-api.polymarket.com"
GAMMA = "https://gamma-api.polymarket.com"


def prints_around(cond, t_lo, t_hi):
    rows, cursor = [], None
    for _ in range(200):
        params = {"condition": cond, "limit": 1000}
        if cursor:
            params["cursor"] = cursor
        d = pmnet.get(DATA_API + "/v2/trades", params)
        data = d.get("data") or []
        for r in data:
            if t_lo <= r.get("timestamp", 0) <= t_hi:
                rows.append(r)
        cursor = (d.get("pagination") or {}).get("next_cursor")
        if not cursor or not data or data[-1].get("timestamp", 0) < t_lo:
            break
    return rows


def main():
    res = json.load(open(sys.argv[1]))
    h = sys.argv[2] if len(sys.argv) > 2 else "24"
    samples = res["horizons"][h]["sample_trades"] if "horizons" in res else res["sample_trades"]
    tot_f = ok_f = ok_pay = 0
    worst = 0.0
    for s in samples:
        cond = s["cond"]
        # FAV names the token index; WX names the side of a YES/NO market (YES is outcome 0)
        fav = s["fav"] if "fav" in s else (0 if s["side"] == "YES" else 1)
        t_lo = min(f[0] for f in s["fills"])
        t_hi = max(f[0] for f in s["fills"])
        rows = prints_around(cond, t_lo, t_hi)
        for t, px, q in s["fills"]:
            tot_f += 1
            hit = False
            for r in rows:
                if r.get("timestamp") != t:
                    continue
                oi, side, p = r.get("outcome_index"), r.get("side"), r.get("price")
                pfav = p if (oi == fav and side == "BUY") else (1.0 - p if (oi is not None and oi != fav and side == "SELL") else None)
                if pfav is not None and pfav <= px + 1e-6 and (r.get("size") or 0) >= q - 1e-6:
                    hit = True
                    break
            ok_f += hit
        d = pmnet.get(GAMMA + "/markets/keyset", {"condition_ids": [cond], "closed": "true", "limit": 5})
        ms = d.get("markets") or []
        pay = None
        if ms:
            pay = [float(x) for x in json.loads(ms[0].get("outcomePrices") or "[]")][fav]
        ok_pay += (pay is not None and abs(pay - s["payout"]) < 1e-9)
        r = s.get("r", 0.05)  # WX charges the weather rate, 0.05
        pnl = sum(q * (s["payout"] - px) - r * px * (1 - px) * q for _, px, q in s["fills"])
        worst = max(worst, abs(pnl - s["pnl"]))
        print(cond[:12], "fills", len(s["fills"]), "payout", s["payout"], "gamma", pay, "pnl", s["pnl"], "recomputed", round(pnl, 6), flush=True)
    print(json.dumps({"samples": len(samples), "fills": tot_f, "fills_matched_to_a_fresh_print": ok_f,
                      "payouts_agree": ok_pay, "largest_pnl_difference": round(worst, 9)}))


if __name__ == "__main__":
    main()
