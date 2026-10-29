"""FX-SPEED part 3: the Coinbase rows ("with Euros" and its weekend arm "- 1") on their production record, 2026-10-10 → 10-29,
with a faster GBP/USD and EUR/USD than Yahoo's bar.

The replay is the Coinbase/OKX fair-price study's (`fair_price_cb_okx/scripts/prod.py`, imported read-only): PR5's frozen
`pr5_sim.simulate` on each book's own minute record, £/€100 a rung, Coinbase's stop cost, orders priced at minute t live
from t + 60 s. The coin is priced as every Coinbase arm prices it since 2026-10-29 (`cb_live`: USDC 1, USDT Coinbase's
USDT-USD last one-minute close), so `yahoo` is cb_live / Yahoo's X, the production rule from now, and must equal the study's
committed `cb_live` run trip for trip (checked, `matches_study`). A candidate replaces Yahoo's X by `fast.py`'s at the same
minutes, outside FX closures; inside a closure the weekend arm keeps the held Yahoo X (Exness has no closure ticks), and the
base arm is dark there as in production. Dark minutes and the release blackouts are the engine's own (its fair's mask).

P&L in pounds (a EUR book's at the engine's own GBP per EUR of the exit minute), by exit day; paired with `yahoo` by UTC day,
3-day circular block bootstrap (10,000, seed 20261029). Halves 10-10 (10-13) → 10-20 → 10-29. Nothing is fitted; L2 primary.
usage: python3 -I cb.py OUT.json
"""
import collections, json, os, random, statistics as st, sys

HERE = os.path.dirname(os.path.abspath(__file__))
BT = os.path.normpath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(BT, "fair_price_cb_okx", "scripts"))
import prod as PD  # noqa: E402  (the study's production replay, read-only)
import fpc as C  # noqa: E402
import hist as HI  # noqa: E402
import fast as F  # noqa: E402

M, DAY = C.M, C.DAY
GOLIVE_S = 60
SEED, NB, BLOCK = 20261029, 10000, 3


def boot(v):
    n = len(v)
    rnd = random.Random(SEED); out = []
    for _ in range(NB):
        s = []
        while len(s) < n:
            i = rnd.randrange(n); s.extend(v[(i + j) % n] for j in range(BLOCK))
        out.append(st.fmean(s[:n]))
    out.sort()
    return [round(out[int(0.05 * NB)], 4), round(out[int(0.95 * NB)], 4), round(sum(1 for x in out if x <= 0) / NB, 4)]


def main(out):
    fx = C.load_fx()
    yahoo = {k: dict(zip(*v)) for k, v in fx.items()}
    fast = F.Fast(yahoo)
    cbu_t, cbu_v = C.load_cb_usdt_1m()
    study = json.load(__import__("gzip").open(os.path.join(BT, "fair_price_cb_okx", "results", "prod_runs.json.gz"), "rt"))["runs"]
    ins = F.instants(GOLIVE_S)
    names = ["yahoo"] + [f"{n}|aligned" for n in ins] + ["ex_ytime|raw", "L2|raw"]
    days = {}
    daily = collections.defaultdict(lambda: collections.defaultdict(float))    # (arm, name) -> day -> £
    per = {}
    for arm in ("base", "hold"):
        t0 = PD.T0[arm]
        key = "fair" if arm == "base" else "hfair"
        lb = 10 * M if arm == "base" else HI.HOLD_MS
        days[arm] = C.days_between(t0, PD.T1)
        for b in C.BOOKS:
            mm = C.load_minutes(b)
            rows = PD.rows_of(mm, t0, key)
            half = PD.R.BOOK[b][1]
            ms = [m for m in sorted(mm) if t0 <= m * M < PD.T1]
            pair = "GBPUSD" if C.QUOTE[b] == "GBP" else "EURUSD"
            coin = C.COIN[b]
            u = [1.0 if coin == "USDC" else C.bar_at(m * M, cbu_t, cbu_v) for m in ms]
            xs = [C.bar_at(m * M, *fx[pair], lookback=lb) for m in ms]
            mask = [mm[m][key] is not None for m in ms]
            lastx, lx = {}, None
            for m in sorted(mm):
                if mm[m]["x"]: lx = mm[m]["x"]
                lastx[m] = lx
            cands = {"yahoo": [(u[i] / xs[i]) if (mask[i] and u[i] and xs[i]) else None for i in range(len(ms))]}
            for n in names[1:]:
                nm, mode = n.split("|")
                rel = ins[nm]
                col = []
                for i, m in enumerate(ms):
                    t = m * M
                    if not (mask[i] and u[i] and xs[i]):
                        col.append(None); continue
                    if C.is_closure(t):
                        col.append(u[i] / xs[i]); continue
                    xc = fast.x(pair, t, rel, mode == "aligned")
                    col.append(u[i] / (xc if xc else xs[i]))
                cands[n] = col
            for n, Fv in cands.items():
                tr = [x for x in PD.run_book(b, rows, Fv, half) if x["t_entry"] < PD.T1]
                pnl_gbp = [x["pnl_usd"] * (lastx.get(x["t_exit"] // M) or 1.0) for x in tr]
                for x, g in zip(tr, pnl_gbp):
                    daily[(arm, n)][C.day_of(min(x["t_exit"], PD.T1 - 1))] += g
                    daily[(arm, n, b)][C.day_of(min(x["t_exit"], PD.T1 - 1))] += g
                per[f"{arm}|{b}|{n}"] = {"trips": len(tr), "pnl_gbp": round(sum(pnl_gbp), 4), "stops": sum(1 for x in tr if x["how"] == "taker"),
                                         "per_trip_bps": round(1e4 * sum(x["pnl_usd"] for x in tr) / max(1e-9, sum(x["notional_usd"] for x in tr)), 3)}
                if n == "yahoo":
                    ref = study.get(f"{arm}|{b}|cb_live")
                    mine = [[x["t_entry"], x["t_exit"], round(x["pnl_usd"], 6)] for x in tr]
                    per[f"{arm}|{b}|{n}"]["matches_study"] = ref is not None and [r[:3] for r in ref] == mine
            print(arm, b, {n: (per[f'{arm}|{b}|{n}']['trips'], per[f'{arm}|{b}|{n}']['pnl_gbp']) for n in ("yahoo", "L2|aligned", "L0|aligned", "ex_ytime|aligned")}, per[f"{arm}|{b}|yahoo"].get("matches_study"), flush=True)
    res = {"window": {"base": "2026-10-10", "hold": "2026-10-13", "end": "2026-10-29", "split": "2026-10-20"}, "golive_s": GOLIVE_S,
           "instants_rel_t_s": ins, "books": per, "paired": {}}
    for arm in ("base", "hold"):
        dd = days[arm]
        for n in names[1:]:
            for scope in [None] + C.BOOKS:
                kb = (arm, "yahoo") if scope is None else (arm, "yahoo", scope)
                kc = (arm, n) if scope is None else (arm, n, scope)
                v = [daily[kc].get(d, 0.0) - daily[kb].get(d, 0.0) for d in dd]
                h1 = [x for d, x in zip(dd, v) if d < "2026-10-20"]; h2 = [x for d, x in zip(dd, v) if d >= "2026-10-20"]
                r = {"diff_gbp_day": round(st.fmean(v), 4), "gbp_year": round(365 * st.fmean(v), 1), "boot90_pLe0": boot(v),
                     "h1_gbp_day": round(st.fmean(h1), 4), "h2_gbp_day": round(st.fmean(h2), 4), "days": len(v),
                     "days_ahead": sum(1 for x in v if x > 1e-9), "days_behind": sum(1 for x in v if x < -1e-9)}
                res["paired"][f"{arm}|{scope or 'all'}|{n}"] = r
            p = res["paired"][f"{arm}|all|{n}"]
            print(arm, n, p["gbp_year"], p["boot90_pLe0"], p["h1_gbp_day"], p["h2_gbp_day"], flush=True)
    json.dump(res, open(out, "w"), indent=1, sort_keys=True)


if __name__ == "__main__":
    main(sys.argv[1])
