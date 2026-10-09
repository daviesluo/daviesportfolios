"""PARITY: put-call parity against the dated future on Deribit (snapshot), and VRP: BTC/ETH volatility risk premium (history).

PARITY (keyless public API): every BTC and ETH option whose expiry has a dated future. A conversion (buy call at ask, sell
put at bid, sell K USD of the inverse future at its bid) locks 1 - K/F BTC at expiry for C_ask - P_bid now; the reversal
is the mirror. Net of taker fees: 0.03 % of the underlying per option leg (capped at 12.5 % of the option's price),
0.05 % on the future's notional, and the option delivery fee 0.015 % on the one leg that settles in the money.
Edge in bps of the underlying; any positive one is then read on the full book for its size. Writes
results/deribit_parity_<UTC>.json and keeps the raw summaries in inputs/deribit/.

VRP: DVOL (Deribit's 30-day implied vol index, daily) against the next 30 days' realised vol from Binance's daily
closes (data-api.binance.vision, keyless). VRP = DVOL - RV_fwd30 in vol points; a variance-swap proxy
(IV^2 - RV^2) / (2 IV) per unit vega. Descriptive. Writes results/vrp.json and keeps its inputs.
"""
import gzip, json, math, os, sys, time, statistics as st
import datetime as dt

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from netget import get_json

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INP = os.path.join(HERE, "inputs", "deribit")
os.makedirs(INP, exist_ok=True)
API = "https://www.deribit.com/api/v2/public/"


def save(name, obj):
    open(os.path.join(INP, name), "wb").write(gzip.compress(json.dumps(obj, sort_keys=True).encode(), mtime=0))


def opt1():
    stamp = dt.datetime.utcnow().strftime("%Y-%m-%dT%H%MZ")
    out = {"read_at": stamp, "by_currency": {}}
    for cur in ("BTC", "ETH"):
        _, o = get_json(API + f"get_book_summary_by_currency?currency={cur}&kind=option")
        _, f = get_json(API + f"get_book_summary_by_currency?currency={cur}&kind=future")
        save(f"summary_{cur}_options_{stamp}.json.gz", o)
        save(f"summary_{cur}_futures_{stamp}.json.gz", f)
        fut = {x["instrument_name"].split("-")[1]: x for x in f["result"] if x["instrument_name"].count("-") == 1
               and x.get("bid_price") and x.get("ask_price")}
        opts = {}
        for x in o["result"]:
            _, exp, k, cp = x["instrument_name"].split("-")
            opts.setdefault((exp, float(k)), {})[cp] = x
        rows = []
        for (exp, K), d in opts.items():
            if exp not in fut or "C" not in d or "P" not in d:
                continue
            c, p = d["C"], d["P"]
            Fb, Fa = fut[exp]["bid_price"], fut[exp]["ask_price"]
            fee_opt = lambda price: min(0.0003, 0.125 * price) if price else 0.0003
            best = None
            if c.get("ask_price") and p.get("bid_price"):
                lock = 1 - K / Fb
                cost = c["ask_price"] - p["bid_price"]
                fees = fee_opt(c["ask_price"]) + fee_opt(p["bid_price"]) + 0.0005 * K / Fb + 0.00015
                best = ("conversion", lock - cost - fees)
            if c.get("bid_price") and p.get("ask_price"):
                lock = 1 - K / Fa
                got = c["bid_price"] - p["ask_price"]
                fees = fee_opt(c["bid_price"]) + fee_opt(p["ask_price"]) + 0.0005 * K / Fa + 0.00015
                e = got - lock - fees
                if best is None or e > best[1]:
                    best = ("reversal", e)
            if best:
                rows.append({"expiry": exp, "strike": K, "side": best[0], "net_bps": round(1e4 * best[1], 2),
                             "F_mid": (Fb + Fa) / 2})
        rows.sort(key=lambda r: -r["net_bps"])
        pos = [r for r in rows if r["net_bps"] > 0]
        for r in pos[:10]:  # read the size at the touch for the positive ones
            sz = {}
            for cp in ("C", "P"):
                name = f"{cur}-{r['expiry']}-{int(r['strike'])}-{cp}"
                _, b = get_json(API + f"get_order_book?instrument_name={name}&depth=1")
                bk = (b or {}).get("result", {})
                sz[cp] = {"best_bid": bk.get("best_bid_price"), "bid_amount": bk.get("best_bid_amount"),
                          "best_ask": bk.get("best_ask_price"), "ask_amount": bk.get("best_ask_amount")}
                time.sleep(0.2)
            r["touch"] = sz
        out["by_currency"][cur] = {"pairs_scored": len(rows), "positive_after_fees": len(pos),
                                   "net_bps_quantiles": {q: rows[int(q * (len(rows) - 1))]["net_bps"] for q in (0, 0.01, 0.05, 0.5)} if rows else {},
                                   "top": rows[:10]}
    json.dump(out, open(os.path.join(HERE, "results", f"deribit_parity_{stamp}.json"), "w"), indent=1, sort_keys=True)
    return out


def opt2():
    out = {}
    end = int(time.time() * 1000)
    for cur, sym in (("BTC", "BTCUSDT"), ("ETH", "ETHUSDT")):
        dv = []
        start = int(dt.datetime(2021, 3, 1, tzinfo=dt.timezone.utc).timestamp() * 1000)
        t = start
        while t < end:
            t2 = min(t + 900 * 86400 * 1000, end)
            _, j = get_json(API + f"get_volatility_index_data?currency={cur}&start_timestamp={t}&end_timestamp={t2}&resolution=1D")
            dv += j["result"]["data"]
            t = t2
        dv = sorted({r[0]: r for r in dv}.values())
        save(f"dvol_{cur}_daily.json.gz", dv)
        kl = []
        t = start
        while t < end:
            _, k = get_json(f"https://data-api.binance.vision/api/v3/klines?symbol={sym}&interval=1d&startTime={t}&limit=1000")
            if not k:
                break
            kl += k
            t = k[-1][0] + 86400000
        save(f"binance_{sym}_1d.json.gz", kl)
        close = {int(r[0]) // 86400000: float(r[4]) for r in kl}
        rows = []
        for r in dv:
            d0 = int(r[0]) // 86400000
            iv = float(r[4]) / 100  # the day's DVOL close
            rets = []
            for i in range(30):
                a, b = close.get(d0 + i), close.get(d0 + i + 1)
                if a and b:
                    rets.append(math.log(b / a))
            if len(rets) < 30:
                continue
            rv = math.sqrt(365 / 30 * sum(x * x for x in rets))
            rows.append((dt.date.fromordinal(dt.date(1970, 1, 1).toordinal() + d0), iv, rv))
        vrp = [iv - rv for _, iv, rv in rows]
        proxy = [(iv * iv - rv * rv) / (2 * iv) for _, iv, rv in rows]
        by_year = {}
        for (d, iv, rv) in rows:
            by_year.setdefault(d.year, []).append(iv - rv)
        out[cur] = {"days": len(rows), "from": str(rows[0][0]), "to": str(rows[-1][0]),
                    "vrp_vol_pts_mean": round(100 * sum(vrp) / len(vrp), 2), "vrp_vol_pts_median": round(100 * st.median(vrp), 2),
                    "share_iv_above_rv": round(sum(1 for v in vrp if v > 0) / len(vrp), 3),
                    "worst_vol_pts": round(100 * min(vrp), 1), "var_swap_proxy_mean": round(100 * sum(proxy) / len(proxy), 2),
                    "by_year_mean_vol_pts": {y: round(100 * sum(v) / len(v), 2) for y, v in sorted(by_year.items())}}
    json.dump(out, open(os.path.join(HERE, "results", "vrp.json"), "w"), indent=1, sort_keys=True)
    return out


if __name__ == "__main__":
    which = sys.argv[1:] or ["opt1", "opt2"]
    if "opt1" in which:
        r = opt1()
        for cur, v in r["by_currency"].items():
            print(cur, v["pairs_scored"], "positive", v["positive_after_fees"], v["net_bps_quantiles"], v["top"][:3])
    if "opt2" in which:
        print(json.dumps(opt2(), indent=1))
