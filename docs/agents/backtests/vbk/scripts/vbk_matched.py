"""VB-K, bonus leg: what a free bet keeps when its lay is Smarkets or Polymarket, on the live snapshot's own books.

A stake-not-returned free bet F backed at odds B, laid so both outcomes pay the same, keeps F (B - 1) / (1 + r), where r
is the lay leg's loss per unit it wins (Smarkets: (L - 1) / (1 - 0.02) at its best bid L; Polymarket: c / (1 - c) for a NO
share costing c = n + 0.05 n (1 - n) at n = 1 - YES bid, sports_fees_v3). A qualifying bet Q at B laid the same way
returns Q (B / (1 + r) - 1) whichever side wins (negative: the qualifying loss). The bookmaker's B is taken as the Smarkets
fair odds x 0.95 (a 5 % book margin: an assumption, no UK book's price was read). Only outcomes with fair odds 2.5-8
(where free bets are usually placed) and a two-sided Smarkets book are used. Reads the newest results/live_snapshot_*.json;
writes results/vbk_matched.json. The sign-up arithmetic at the end uses the write-up's stated offer assumptions.
"""
import glob, json, os, statistics

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def retention_snr(B, r):
    return (B - 1) / (1 + r)


def qualifying(B, r):
    """Back 1 at B, lay to equalise: result per unit staked (negative = qualifying loss)."""
    W = B / (1 + r)  # amount the lay wins when the back loses, chosen so both outcomes pay the same
    return W - 1.0    # back loses: -1 + W


def main():
    f = sorted(glob.glob(os.path.join(HERE, "results", "live_snapshot_*.json")))[-1]
    d = json.load(open(f))
    rows = []
    for g in d["games"]:
        if not g.get("matched") or not g.get("fair_smarkets"):
            continue
        for k, v in g["sides"].items():
            p = g["fair_smarkets"][k]
            if not p or not (1 / 8 <= p <= 1 / 2.5):
                continue
            if v.get("pm_lay_cost") is None or v.get("sm_lay_cost") is None:
                continue
            B = 0.95 / p
            rows.append({"B": B, "s_spread": v.get("s_spread"), "pm": v["pm_lay_cost"], "sm": v["sm_lay_cost"]})
    out = {"snapshot": os.path.basename(f), "outcomes": len(rows)}
    for lab, sub in (("all", rows), ("smarkets_spread_le_3pt", [x for x in rows if x["s_spread"] is not None and x["s_spread"] <= 0.03])):
        if not sub:
            continue
        rp = [retention_snr(x["B"], x["pm"]) for x in sub]
        rs = [retention_snr(x["B"], x["sm"]) for x in sub]
        qp = [qualifying(x["B"], x["pm"]) for x in sub]
        qs = [qualifying(x["B"], x["sm"]) for x in sub]
        out[lab] = {"n": len(sub), "snr_retention_median_pm": round(statistics.median(rp), 3),
                    "snr_retention_median_smarkets": round(statistics.median(rs), 3),
                    "pm_better_share": round(sum(1 for a, b in zip(rp, rs) if a > b) / len(sub), 3),
                    "qualifying_result_per_unit_median_pm": round(statistics.median(qp), 4),
                    "qualifying_result_per_unit_median_smarkets": round(statistics.median(qs), 4)}
    # sign-up arithmetic: offers x free bet x retention + qualifying stake x qualifying result
    best = out.get("smarkets_spread_le_3pt", out["all"])
    ret = max(best["snr_retention_median_smarkets"], best["snr_retention_median_pm"])
    ql = max(best["qualifying_result_per_unit_median_smarkets"], best["qualifying_result_per_unit_median_pm"])
    plan = {}
    for lab, n_offers, fb, q in (("low", 15, 20, 10), ("central", 25, 30, 10), ("high", 35, 35, 10)):
        plan[lab] = {"offers": n_offers, "free_bet_gbp": fb, "qualifying_stake_gbp": q,
                     "gbp_one_off": round(n_offers * (fb * ret + q * ql))}
    out["signup_plan"] = {"retention_used": ret, "qualifying_result_used": ql, **plan}
    json.dump(out, open(os.path.join(HERE, "results", "vbk_matched.json"), "w"), indent=1, sort_keys=True)
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
