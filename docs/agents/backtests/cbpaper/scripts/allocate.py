"""The budget split, read from compare.py's per-book yearly rates (../results/compare.json), and each split tried in every
other window: a split chosen on one stretch of the market and judged on another.

For each budget (£500, £1,000, £2,000, £5,000) and each choosing window, the per-book split that maximises £ a year
(dynamic programming over the six books, each at a rung of the grid or left out, capital 6 × rung), then what that same
split earned, a year, in each of the four windows; and the ROBUST split, the one whose worst shortfall against each
window's own best is smallest (minimax regret). Plus two fixed references: PR5 live's shape (Revolut X's two books
at £100, £1,200) and Coinbase's four books at £100 (£2,400).
usage: python3 -I allocate.py   -> ../results/allocation.json
"""
import json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
R = json.load(open(os.path.join(ROOT, "results", "compare.json")))
W = ["last_12_months", "last_90_days", "since_2026-08-24", "last_28_days"]
BOOKS = sorted(R["books"])
RUNGS = [int(r) for r in R["rungs"]]


def rate(k, w, r):
    return 0.0 if r == 0 else R["books"][k][w]["by_rung"][str(r)]["gbp_per_year"]


def best(budget, w):
    units = budget // 10
    table = {0: (0.0, {})}
    for k in BOOKS:
        nxt = dict(table)
        for used, (val, pick) in table.items():
            for r in RUNGS:
                u = 6 * r // 10
                if used + u <= units and (used + u not in nxt or val + rate(k, w, r) > nxt[used + u][0] + 1e-9):
                    nxt[used + u] = (val + rate(k, w, r), {**pick, k: r})
        table = nxt
    return max(table.values(), key=lambda x: x[0])[1]


def judge(pick):
    cap = {v: sum(6 * r for k, r in pick.items() if k.startswith(v)) for v in ("revx", "coinbase")}
    return {"rungs": dict(sorted(pick.items())), "revx_capital": cap["revx"], "coinbase_capital": cap["coinbase"],
            "gbp_per_year": {w: round(sum(rate(k, w, r) for k, r in pick.items()), 2) for w in W}}


def robust(budget, opt):
    """The split whose worst shortfall against each window's own best is smallest (minimax regret), over the four books
    that matter (Revolut X's two, Coinbase's USDC-GBP and USDC-EUR: its USDT books add nothing in any window's best)."""
    keys = ["revx:USDT-GBP", "revx:USDC-GBP", "coinbase:USDC-GBP", "coinbase:USDC-EUR"]
    grid = [0] + RUNGS
    top = {w: sum(rate(k, w, r) for k, r in opt[w].items()) for w in W}
    bestv, bestp = None, None
    def rec(i, used, pick):
        nonlocal bestv, bestp
        if i == len(keys):
            regret = max(1 - sum(rate(k, w, r) for k, r in pick.items()) / top[w] for w in W)
            if bestv is None or regret < bestv - 1e-12:
                bestv, bestp = regret, dict(pick)
            return
        for r in grid:
            if used + 6 * r > budget:
                break
            if r:
                pick[keys[i]] = r
            rec(i + 1, used + 6 * r, pick)
            pick.pop(keys[i], None)
    rec(0, 0, {})
    return bestp, bestv


out = {"references": {"revx_100_both_books": judge({"revx:USDC-GBP": 100, "revx:USDT-GBP": 100}),
                      "coinbase_100_four_books": judge({k: 100 for k in BOOKS if k.startswith("coinbase")})}, "splits": {}}
for budget in (500, 1000, 2000, 5000):
    opt = {w: best(budget, w) for w in W}
    out["splits"][str(budget)] = {w: judge(p) for w, p in opt.items()}
    rp, rv = robust(budget, opt)
    out["splits"][str(budget)]["robust"] = {**judge(rp), "worst_shortfall_vs_each_windows_best": round(rv, 4)}
json.dump(out, open(os.path.join(ROOT, "results", "allocation.json"), "w"), indent=1, sort_keys=True)
for b, d in out["splits"].items():
    for w, j in d.items():
        print(b, w, j["revx_capital"], j["coinbase_capital"], j["rungs"], j["gbp_per_year"])
print(out["references"])
