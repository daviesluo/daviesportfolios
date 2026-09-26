#!/usr/bin/env python3
"""Per-book statistics from raw/samples.jsonl (the once-a-minute keyless samples).

For each book: samples, tick size in bps of the mid, touch spread in bps (median, max),
top-of-book depth in USD (median of the smaller side, and of each side), 24 h volume in USD
(Bitget's own `usdtVolume`, median over samples), and, where a reference exists, the
mid's distance from it in bps (median, min, max):
  USDCEUR  vs Kraken USDC/EUR mid, and vs Binance 1/EURUSDC mid
  USDTEUR  vs Kraken USDT/EUR mid, and vs Binance 1/EURUSDT mid
  USDTUSD  vs Kraken USDT/USD mid;  USDCUSD vs Kraken USDC/USD mid
  USDTBRL  vs Binance USDT/BRL mid
  stablecoin/stablecoin books vs 1.0000 (par), for orientation only
Writes out/samples_summary.json and prints a table.
"""
import json, os, statistics as st

HERE = os.path.dirname(os.path.abspath(__file__))
SYMS = json.load(open(os.path.join(HERE, "raw", "symbols_2026-09-26T2004Z.json")))["data"]
PP = {s["symbol"]: int(s["pricePrecision"]) for s in SYMS}
STATUS = {s["symbol"]: s["status"] for s in SYMS}


def mid_kraken(k, key):
    r = k["result"][key]
    return (float(r["a"][0]) + float(r["b"][0])) / 2


def main():
    rows = [json.loads(l) for l in open(os.path.join(HERE, "raw", "samples.jsonl"))]
    per = {}
    for s in rows:
        kr = s["kraken"]["json"] if s["kraken"].get("ok") else None
        bn = {x["symbol"]: x for x in s["binance"]["json"]} if s["binance"].get("ok") else {}
        tk = {x["symbol"]: x for x in s["tickers"]["json"]["data"]} if s["tickers"].get("ok") else {}
        eurusd = mid_kraken(kr, "ZEURZUSD") if kr else None
        usdtusd = mid_kraken(kr, "USDTZUSD") if kr else 1.0
        vnd = None
        ob_vnd = s["orderbook"].get("USDTVND", {})
        if ob_vnd.get("ok") and ob_vnd["json"]["data"]["bids"] and ob_vnd["json"]["data"]["asks"]:
            vnd = (float(ob_vnd["json"]["data"]["bids"][0][0]) + float(ob_vnd["json"]["data"]["asks"][0][0])) / 2
        brl = None
        if "USDTBRL" in bn:
            brl = (float(bn["USDTBRL"]["bidPrice"]) + float(bn["USDTBRL"]["askPrice"])) / 2
        for sym, r in s["orderbook"].items():
            d = per.setdefault(sym, {"spread": [], "dmin": [], "dbid": [], "dask": [], "vol": [], "ref": {}, "tick": [],
                                     "rpi_top_share": [], "empty": 0, "d10": []})
            if not r.get("ok") or not r["json"].get("data"):
                d["empty"] += 1
                continue
            bids, asks = r["json"]["data"]["bids"], r["json"]["data"]["asks"]
            if not bids or not asks:
                d["empty"] += 1
                continue
            b, a = float(bids[0][0]), float(asks[0][0])
            m = (a + b) / 2
            quote = sym[-3:] if sym[-3:] in ("EUR", "BRL", "USD", "VND") else ("USDT" if sym.endswith("USDT") else "USDC")
            q2usd = {"EUR": eurusd, "BRL": (usdtusd / brl) if brl else None, "USD": 1.0,
                     "VND": (usdtusd / vnd) if vnd else None, "USDT": usdtusd, "USDC": 1.0}[quote]
            if sym.endswith("USDC") and kr:
                q2usd = mid_kraken(kr, "USDCUSD")
            d["spread"].append((a - b) / m * 1e4)
            d["tick"].append(10 ** -PP[sym] / m * 1e4)
            if q2usd:
                bu = float(bids[0][1]) * b * q2usd
                au = float(asks[0][1]) * a * q2usd
                d["dbid"].append(bu)
                d["dask"].append(au)
                d["dmin"].append(min(bu, au))
                # depth within 10 bps of the mid, smaller side, USD
                b10 = sum(float(q) * float(p) for p, q in bids if float(p) >= m * (1 - 10e-4)) * q2usd
                a10 = sum(float(q) * float(p) for p, q in asks if float(p) <= m * (1 + 10e-4)) * q2usd
                d["d10"].append(min(b10, a10))
            if sym in tk:
                d["vol"].append(float(tk[sym]["usdtVolume"]))
            refs = {}
            if kr:
                if sym == "USDCEUR":
                    refs["kraken"] = mid_kraken(kr, "USDCEUR")
                if sym == "USDTEUR":
                    refs["kraken"] = mid_kraken(kr, "USDTEUR")
                if sym == "USDTUSD":
                    refs["kraken"] = mid_kraken(kr, "USDTZUSD")
                if sym == "USDCUSD":
                    refs["kraken"] = mid_kraken(kr, "USDCUSD")
            if sym == "USDCEUR" and "EURUSDC" in bn:
                refs["binance"] = 2 / (float(bn["EURUSDC"]["bidPrice"]) + float(bn["EURUSDC"]["askPrice"]))
            if sym == "USDTEUR" and "EURUSDT" in bn:
                refs["binance"] = 2 / (float(bn["EURUSDT"]["bidPrice"]) + float(bn["EURUSDT"]["askPrice"]))
            if sym == "USDTBRL" and brl:
                refs["binance"] = brl
            base = sym[:-4] if sym.endswith(("USDT", "USDC")) else sym[:-3]
            if base in ("USDC", "USDE", "USD1", "U", "PYUSD", "RLUSD", "TUSD", "USDS", "USDGO", "GHO") and not sym.endswith(("EUR", "BRL", "VND")):
                refs["par"] = 1.0
            for k2, v in refs.items():
                d["ref"].setdefault(k2, []).append((m - v) / v * 1e4)
        for sym, r in s.get("rpi_orderbook", {}).items():
            if r.get("ok") and r["json"].get("data"):
                dd = r["json"]["data"]
                if dd["a"] and dd["b"]:
                    top = [dd["a"][0], dd["b"][0]]
                    nonrpi = sum(float(x[1]) for x in top)
                    rpi = sum(float(x[2]) for x in top)
                    per[sym]["rpi_top_share"].append(rpi / (rpi + nonrpi) if rpi + nonrpi > 0 else None)

    out = {}
    med = lambda xs: st.median(xs) if xs else None
    for sym, d in per.items():
        out[sym] = {
            "status": STATUS.get(sym),
            "n_samples": len(d["spread"]),
            "empty_books": d["empty"],
            "tick_bps": med(d["tick"]),
            "spread_bps_median": med(d["spread"]),
            "spread_bps_max": max(d["spread"]) if d["spread"] else None,
            "top_depth_usd_median_smaller_side": med(d["dmin"]),
            "top_depth_usd_median_bid": med(d["dbid"]),
            "top_depth_usd_median_ask": med(d["dask"]),
            "depth_within_10bps_usd_median_smaller_side": med(d["d10"]),
            "vol24h_usd_median": med(d["vol"]),
            "mid_vs_ref_bps": {k: {"median": med(v), "min": min(v), "max": max(v), "n": len(v)} for k, v in d["ref"].items()},
            "rpi_share_of_top_qty_median": med([x for x in d["rpi_top_share"] if x is not None]),
        }
    os.makedirs(os.path.join(HERE, "out"), exist_ok=True)
    json.dump({"samples": len(rows), "first": rows[0]["t_utc"], "last": rows[-1]["t_utc"], "books": out},
              open(os.path.join(HERE, "out", "samples_summary.json"), "w"), indent=1)
    print(f"samples {len(rows)}  {rows[0]['t_utc']} -> {rows[-1]['t_utc']}")
    print(f"{'book':10} {'n':>3} {'tick':>6} {'sprMed':>7} {'sprMax':>7} {'topMin$':>10} {'d10bps$':>10} {'vol24h$':>12}  mid-vs-ref(bps, median)")
    for sym in sorted(out, key=lambda k: -(out[k]["vol24h_usd_median"] or 0)):
        o = out[sym]
        refs = " ".join(f"{k}:{v['median']:+.1f}[{v['min']:+.1f},{v['max']:+.1f}]" for k, v in o["mid_vs_ref_bps"].items())
        f = lambda x, p=1: "-" if x is None else f"{x:.{p}f}"
        print(f"{sym:10} {o['n_samples']:>3} {f(o['tick_bps'],2):>6} {f(o['spread_bps_median']):>7} {f(o['spread_bps_max']):>7} "
              f"{f(o['top_depth_usd_median_smaller_side'],0):>10} {f(o['depth_within_10bps_usd_median_smaller_side'],0):>10} {f(o['vol24h_usd_median'],0):>12}  {refs}"
              + (f"  rpiShare={o['rpi_share_of_top_qty_median']:.2f}" if o['rpi_share_of_top_qty_median'] is not None else ""))


if __name__ == "__main__":
    main()
