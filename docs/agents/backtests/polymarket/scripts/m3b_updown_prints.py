"""M3b: were M3's apparent mispricings on the hourly up/down markets ever executable? (fp4, a check)

M3 compares the markets' price-history points with a Binance model and finds the
model better calibrated. A price-history point can be a stale last trade; a taker
pays the ask. This check takes a fixed sample of M3's markets (one in SAMPLE by
condition id), pulls every taker print of each (/v2/trades?condition=), and at
every 5-minute point where the EARLY model (Binance read at the bucket's start)
beats the history price by at least DELTA, asks what a taker actually paid for
the favoured side in the next 60 seconds: the first buy-equivalent print of that
side (a BUY of it, or a SELL of the other side at 1 - q). P&L per share at that
print: payout - price - 0.07 p (1 - p). Descriptive, in sample.

usage: m3b_updown_prints.py <out json> [sample] [delta]
"""
import hashlib
import json
import math
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(__file__))
import pmnet  # noqa: E402

DATA_API = "https://data-api.polymarket.com"
GAMMA = "https://gamma-api.polymarket.com"
FEE = 0.07


def phi(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def main():
    outp = sys.argv[1]
    sample = int(sys.argv[2]) if len(sys.argv) > 2 else 8
    delta = float(sys.argv[3]) if len(sys.argv) > 3 else 0.10
    cache = os.path.join(pmnet.DATA, "m3")
    pdir = os.path.join(pmnet.DATA, "m3b")
    os.makedirs(pdir, exist_ok=True)
    res = defaultdict(lambda: {"signals": 0, "with_print": 0, "pnl_hist": 0.0, "pnl_print": 0.0, "gap_sum": 0.0})
    examples = []
    for slug in ("btc-up-or-down-hourly", "eth-up-or-down-hourly", "solana-up-or-down-hourly", "xrp-up-or-down-hourly"):
        blob = pmnet.load(os.path.join(cache, slug + ".json"))
        kl = {int(k): v for k, v in blob["klines"].items()}

        def model_at(k, opn, end):
            if k not in kl:
                return None
            rets = []
            for j in range(120):
                a, b = kl.get(k - 60 * (j + 1)), kl.get(k - 60 * j)
                if a and b:
                    rets.append(math.log(b[1] / a[1]))
            if len(rets) < 60:
                return None
            sig = math.sqrt(sum(r * r for r in rets) / len(rets))
            tau = (end - (k + 60)) / 60.0
            if tau <= 0 or sig <= 0:
                return None
            return phi(math.log(kl[k][1] / opn) / (sig * math.sqrt(tau)))

        for m in blob["markets"]:
            if len(m["hist"]) <= 2 or int(hashlib.md5(m["slug"].encode()).hexdigest()[:8], 16) % sample != 0:
                continue
            o = kl.get(int(m["start"]))
            if not o:
                continue
            sigs = []
            for t, p, rs in m["hist"]:
                if rs == 0 or t < m["start"] or t + 300 >= m["end"]:
                    continue
                pe = model_at(int(t // 60 * 60) - 60, o[0], m["end"])
                if pe is None or abs(pe - p) < delta:
                    continue
                sigs.append((t, p, pe))
            if not sigs:
                continue
            # the market's condition id and prints
            pp = os.path.join(pdir, m["slug"] + ".json")
            if os.path.exists(pp):
                pr = pmnet.load(pp)
            else:
                g = pmnet.get(GAMMA + "/markets/slug/" + m["slug"])
                cond = g.get("conditionId")
                outs = json.loads(g.get("outcomes") or "[]")
                rows, cursor = [], None
                while True:
                    params = {"condition": cond, "limit": 1000}
                    if cursor:
                        params["cursor"] = cursor
                    d = pmnet.get(DATA_API + "/v2/trades", params)
                    data = d.get("data") or []
                    rows.extend([[r["timestamp"], r["side"], r["outcome_index"], r["price"], r["size"]] for r in data])
                    cursor = (d.get("pagination") or {}).get("next_cursor")
                    if not cursor or not data or data[-1]["timestamp"] < m["start"] - 600:
                        break
                pr = {"up_index": outs.index("Up") if "Up" in outs else 0, "rows": sorted(rows)}
                pmnet.dump(pp, pr)
            iu = pr["up_index"]
            for t, p, pe in sigs:
                side_up = pe > p
                fav = iu if side_up else 1 - iu
                payout = m["up"] if side_up else 1 - m["up"]
                hist_px = p if side_up else 1 - p
                r = res[slug]
                r["signals"] += 1
                r["pnl_hist"] += payout - hist_px - FEE * hist_px * (1 - hist_px)
                first = None
                for ts, sd, oi, price, size in pr["rows"]:
                    if ts <= t or ts > t + 60:
                        continue
                    if oi == fav and sd == "BUY":
                        first = price
                        break
                    if oi is not None and oi != fav and sd == "SELL":
                        first = 1 - price
                        break
                if first is None:
                    continue
                r["with_print"] += 1
                r["pnl_print"] += payout - first - FEE * first * (1 - first)
                r["gap_sum"] += first - hist_px
                if len(examples) < 15:
                    examples.append({"slug": m["slug"], "t": t, "hist_price": hist_px, "model": pe if side_up else 1 - pe,
                                     "first_print": first, "payout": payout})
    out = {"sample": f"1 in {sample} markets", "delta": delta, "by_series": {}, "examples": examples}
    tot = defaultdict(float)
    for k, r in res.items():
        out["by_series"][k] = {"signals": r["signals"], "with_print_in_60s": r["with_print"],
                               "pnl_per_share_at_history_price": round(r["pnl_hist"] / max(1, r["signals"]), 4),
                               "pnl_per_share_at_first_print": round(r["pnl_print"] / max(1, r["with_print"]), 4),
                               "mean_print_minus_history_price": round(r["gap_sum"] / max(1, r["with_print"]), 4)}
        for kk in ("signals", "with_print", "pnl_hist", "pnl_print", "gap_sum"):
            tot[kk] += r[kk]
    out["all"] = {"signals": tot["signals"], "with_print_in_60s": tot["with_print"],
                  "pnl_per_share_at_history_price": round(tot["pnl_hist"] / max(1, tot["signals"]), 4),
                  "pnl_per_share_at_first_print": round(tot["pnl_print"] / max(1, tot["with_print"]), 4),
                  "mean_print_minus_history_price": round(tot["gap_sum"] / max(1, tot["with_print"]), 4)}
    pmnet.dump(outp, out)
    print(json.dumps(out, indent=1)[:4000])


if __name__ == "__main__":
    main()
