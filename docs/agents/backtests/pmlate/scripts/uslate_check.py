"""USLATE's determinism check (the pre-registration's "Determinism" section), as fp4's `check_samples.py` did.

From the committed input, the primary arm's fills are made again by `uslate_test.run` (the test's own function, the
test's own parameters). Twenty of them are drawn with `random.Random(20260926)`; for each:
* the input print it came from (same bucket, same second, stale side, the fill's price);
* the market's prints read again from a FRESH `/v2/trades?condition=` walk (every page carries the read's own
  millisecond, so no cached copy answers it; not the raw pulls the input was built from), and the fill matched to a
  print there: the same second, the stale side, the same YES-equivalent price (to 1e-6) and the same size (to 1e-4);
* the payout read again from Gamma, and the fill's P&L recomputed from it.
Then every market with a fill has its payout read again from Gamma, fifty a request. Writes the result as JSON.

usage: uslate_check.py <input json.gz> <out json>
"""
import gzip
import json
import os
import random
import sys
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402
import uslate_test as T  # noqa: E402
from explore import yes_dir  # noqa: E402

N_SAMPLE = 20


def gamma_payouts(conds):
    out = {}
    conds = sorted(set(conds))
    for i in range(0, len(conds), 50):
        q = [("limit", "100"), ("closed", "true")] + [("condition_ids", c) for c in conds[i:i + 50]]
        for m in C.pmnet.get(C.GAMMA + "/markets?" + urllib.parse.urlencode(q)) or []:
            try:
                op = [float(x) for x in json.loads(m.get("outcomePrices") or "[]")]
            except (TypeError, ValueError):
                op = []
            out[m.get("conditionId")] = op[0] if len(op) == 2 else None
    return out


def main():
    inp, outp = sys.argv[1], sys.argv[2]
    with gzip.open(inp, "rt") as g:
        data = json.load(g)
    events = data["events"]
    by_id = {e["event"]: e for e in events}
    fills = T.run(events)
    rng = random.Random(T.SEED)
    picks = sorted(rng.sample(range(len(fills)), min(N_SAMPLE, len(fills))))
    samples, n_match, n_src = [], 0, 0
    pay = gamma_payouts([by_id[f[1]]["buckets"][f[2]]["cond"] for f in fills])
    for i in picks:
        f = fills[i]
        e = by_id[f[1]]
        b = e["buckets"][f[2]]
        dead = b["state"] == "dead"
        ts_, sh, px = f[3], f[4], f[5]
        # the input print this fill came from
        src = [p for p in b["prints"] if p[0] == ts_ and p[1] == 1 and abs((1.0 - p[2] if dead else p[2]) - px) < 1e-9
               and sh <= T.SHARE * p[3] + 1e-9]
        n_src += bool(src)
        fresh = C.prints_of(b["cond"])
        hit = None
        for p in src:
            for r in fresh["prints"]:
                if r["ts"] != ts_:
                    continue
                d, y = yes_dir(r["side"], r["oi"], r["price"])
                stale = (dead and d == "SELL") or ((not dead) and d == "BUY")
                if stale and abs(y - p[2]) < 1e-6 and abs(r["size"] - p[3]) < 1e-4:
                    hit = {"ts": r["ts"], "side": r["side"], "oi": r["oi"], "price": r["price"], "size": r["size"],
                           "tx_tail": str(r.get("tx") or "")[-10:]}
                    break
            if hit:
                break
        n_match += bool(hit)
        g = pay.get(b["cond"])
        tok = None if g is None else (1.0 - g if dead else g)
        pnl_in = T.pnl(f)
        pnl_fresh = None if tok is None else sh * (tok - px) - f[6]
        samples.append({"fill_index": i, "event": f[1], "date": f[0], "cond": b["cond"], "bucket": b["bucket"],
                        "state": b["state"], "ts": ts_, "iso": C.iso(ts_), "shares": round(sh, 6), "price": round(px, 6),
                        "input_print": src[0] if src else None, "fresh_walk_complete": fresh["complete"],
                        "fresh_prints": len(fresh["prints"]), "fresh_match": hit,
                        "payout_yes_input": b["payout_yes"], "payout_yes_gamma": g,
                        "pnl_input": round(pnl_in, 6), "pnl_from_gamma_payout": None if pnl_fresh is None else round(pnl_fresh, 6)})
        print(C.iso(ts_), b["cond"][:12], b["state"], "match", bool(hit), "payout", b["payout_yes"], "gamma", g, flush=True)
    conds = {by_id[f[1]]["buckets"][f[2]]["cond"]: by_id[f[1]]["buckets"][f[2]]["payout_yes"] for f in fills}
    agree = sum(1 for c, v in conds.items() if pay.get(c) is not None and abs(pay[c] - v) < 1e-9)
    diffs = [abs(s["pnl_input"] - s["pnl_from_gamma_payout"]) for s in samples if s["pnl_from_gamma_payout"] is not None]
    out = {"input": os.path.basename(inp), "fills": len(fills), "seed": T.SEED, "samples": samples,
           "summary": {"sampled_fills": len(samples), "traced_to_an_input_print": n_src,
                       "matched_to_a_fresh_print": n_match,
                       "sampled_payouts_agree": sum(1 for s in samples if s["payout_yes_gamma"] is not None
                                                    and abs(s["payout_yes_gamma"] - s["payout_yes_input"]) < 1e-9),
                       "largest_pnl_difference": round(max(diffs), 9) if diffs else None,
                       "markets_with_a_fill": len(conds), "their_payouts_agree_with_gamma": agree,
                       "their_payouts_gamma_missing": sum(1 for c in conds if pay.get(c) is None)}}
    with open(outp, "w") as fh:
        json.dump(out, fh, indent=1, sort_keys=True)
        fh.write("\n")
    print(json.dumps(out["summary"], indent=1))


if __name__ == "__main__":
    main()
