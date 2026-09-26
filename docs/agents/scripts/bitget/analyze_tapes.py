#!/usr/bin/env python3
"""Descriptive statistics of Bitget's public trade tapes (hist/trades/<SYM>/*.zip).

NOT a profit-and-loss backtest: no quote is simulated, no position, no inventory, no exit.
Per book and per calendar month:
  prints, USD volume, median print in USD, share of prints under $1 ("dust"),
  GAP = the PR5-comparable spread proxy: for each print whose taker side differs from the
        previous print's and which came <= 60 s after it, (buy price - sell price) / their
        mean, in bps; monthly median and 90th percentile (PR5's USDT/GBP read 9-24 bps before
        2026-08-24 and 2.7-5.4 bps after, as weekly medians);
  for the books with a reference (EUR and BRL books, from Binance's public 1-minute klines,
  the open of the print's minute = the previous minute's close):
        OFFSET = volume-weighted median of price / reference - 1 (bps): where the book sits;
        THROUGH = for a buy, price / ref - 1; for a sell, 1 - price / ref (bps): how far a
        print went past the reference; shares of USD volume with THROUGH >= 10 / 20 / 30 bps;
  for stablecoin/stablecoin books the same against par (1.0000), for orientation only.
Writes out/tapes_summary.json and prints a table.
"""
import csv, io, json, os, sys, zipfile, glob, datetime, bisect, statistics as st
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))


def load_binance(sym):
    """minute (ms) -> open price, from ref/binance/<sym>-1m-*.zip"""
    m = {}
    for f in sorted(glob.glob(os.path.join(HERE, "ref", "binance", f"{sym}-1m-*.zip"))):
        z = zipfile.ZipFile(f)
        for n in z.namelist():
            for row in csv.reader(io.StringIO(z.read(n).decode())):
                if not row or not row[0].isdigit():
                    continue
                t = int(row[0])
                if t > 10 ** 14:  # microseconds (Binance switched some files to us in 2025)
                    t //= 1000
                m[t // 60000 * 60000] = float(row[1])
    return m


def load_tape(sym):
    rows = []
    for f in sorted(glob.glob(os.path.join(HERE, "hist", "trades", sym, "*.zip"))):
        try:
            z = zipfile.ZipFile(f)
        except zipfile.BadZipFile:
            continue
        for n in z.namelist():
            rd = csv.reader(io.StringIO(z.read(n).decode()))
            for row in rd:
                if not row or row[0] == "trade_id":
                    continue
                rows.append((int(row[1]), int(row[0]), float(row[2]), row[3].strip().lower(), float(row[4]), float(row[5])))
    rows = sorted(set(rows))
    return rows


def wmedian(vals, wts):
    if not vals:
        return None
    z = sorted(zip(vals, wts))
    tot = sum(w for _, w in z)
    acc = 0
    for v, w in z:
        acc += w
        if acc >= tot / 2:
            return v
    return z[-1][0]


def pct(xs, q):
    if not xs:
        return None
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(q * (len(xs) - 1) + 0.5))]


REF = {"USDCEUR": ("EURUSDC", True), "USDTEUR": ("EURUSDT", True), "USDTBRL": ("USDTBRL", False)}
QUOTE_USD = {"EUR": "EURUSDT", "BRL": "USDTBRL"}


def main():
    syms = sys.argv[1:] or sorted(os.listdir(os.path.join(HERE, "hist", "trades")))
    eur = load_binance("EURUSDT")  # USD (USDT) per EUR, for converting EUR volume
    brl = load_binance("USDTBRL")  # BRL per USDT
    refs = {k: load_binance(v[0]) for k, v in REF.items()}
    out = {}
    for sym in syms:
        tape = load_tape(sym)
        if not tape:
            continue
        quote = "EUR" if sym.endswith("EUR") else "BRL" if sym.endswith("BRL") else "VND" if sym.endswith("VND") else "USD"
        par = sym.endswith(("USDT", "USDC")) or sym in ("USDTUSD", "USDCUSD")
        mon = defaultdict(lambda: {"n": 0, "usd": 0.0, "sizes": [], "dust": 0, "gaps": [], "off": [], "offw": [],
                                   "thr": [], "thrw": [], "days": set()})
        prev = None
        eur_keys = sorted(eur)
        for t, tid, p, side, qv, bv in tape:
            mk = datetime.datetime.utcfromtimestamp(t / 1000).strftime("%Y-%m")
            d = mon[mk]
            minute = t // 60000 * 60000
            if quote == "EUR":
                fx = eur.get(minute) or eur.get(minute - 60000)
                if fx is None:
                    i = bisect.bisect_left(eur_keys, minute)
                    fx = eur[eur_keys[max(0, i - 1)]]
                usd = qv * fx
            elif quote == "BRL":
                fx = brl.get(minute) or brl.get(minute - 60000) or 5.3
                usd = qv / fx
            elif quote == "VND":
                usd = bv  # base is USDT
            else:
                usd = qv
            d["n"] += 1
            d["usd"] += usd
            d["sizes"].append(usd)
            d["dust"] += usd < 1
            d["days"].add(t // 86400000)
            if prev and prev[3] != side and t - prev[0] <= 60000:
                pb, ps = (p, prev[2]) if side == "buy" else (prev[2], p)
                d["gaps"].append((pb - ps) / ((pb + ps) / 2) * 1e4)
            prev = (t, tid, p, side)
            ref = None
            if sym in REF:
                r = refs[sym].get(minute)
                if r:
                    ref = 1 / r if REF[sym][1] else r
            elif par:
                ref = 1.0
            if ref:
                off = (p / ref - 1) * 1e4
                thr = off if side == "buy" else -off
                d["off"].append(off)
                d["offw"].append(usd)
                d["thr"].append(thr)
                d["thrw"].append(usd)
        rows = {}
        for mk in sorted(mon):
            d = mon[mk]
            r = {"prints": d["n"], "days_with_prints": len(d["days"]), "usd_volume": round(d["usd"]),
                 "median_print_usd": round(st.median(d["sizes"]), 2), "dust_share": round(d["dust"] / d["n"], 3),
                 "gap_n": len(d["gaps"]), "gap_median_bps": None if not d["gaps"] else round(st.median(d["gaps"]), 2),
                 "gap_p90_bps": None if not d["gaps"] else round(pct(d["gaps"], 0.9), 2)}
            if d["off"]:
                tot = sum(d["thrw"])
                r["offset_vw_median_bps"] = round(wmedian(d["off"], d["offw"]), 2)
                r["through_vw_median_bps"] = round(wmedian(d["thr"], d["thrw"]), 2)
                for k in (10, 20, 30):
                    r[f"usd_share_through_ge_{k}bps"] = round(sum(w for x, w in zip(d["thr"], d["thrw"]) if x >= k) / tot, 3)
                r["ref"] = REF[sym][0] + (" (1/x)" if REF[sym][1] else "") if sym in REF else "par 1.0000"
            rows[mk] = r
        allgaps = [g for mk in mon for g in mon[mk]["gaps"]]
        out[sym] = {"first_print": datetime.datetime.utcfromtimestamp(tape[0][0] / 1000).isoformat() + "Z",
                    "last_print": datetime.datetime.utcfromtimestamp(tape[-1][0] / 1000).isoformat() + "Z",
                    "prints": len(tape), "gap_median_bps_all": None if not allgaps else round(st.median(allgaps), 2),
                    "months": rows}
        print(f"\n== {sym}: {len(tape):,} prints {out[sym]['first_print'][:10]} -> {out[sym]['last_print'][:10]}; "
              f"gap median {out[sym]['gap_median_bps_all']} bps")
        print(f"{'month':8} {'prints':>7} {'days':>4} {'USD vol':>11} {'medUSD':>7} {'dust':>5} {'gapMed':>7} {'gapP90':>7}"
              f" {'offset':>7} {'thrMed':>7} {'>=10':>5} {'>=20':>5} {'>=30':>5}")
        for mk, r in rows.items():
            g = lambda k, p=1: "-" if r.get(k) is None else f"{r[k]:.{p}f}"
            print(f"{mk:8} {r['prints']:>7} {r['days_with_prints']:>4} {r['usd_volume']:>11,} {r['median_print_usd']:>7.1f} "
                  f"{r['dust_share']:>5.2f} {g('gap_median_bps'):>7} {g('gap_p90_bps'):>7} {g('offset_vw_median_bps'):>7} "
                  f"{g('through_vw_median_bps'):>7} {g('usd_share_through_ge_10bps',2):>5} {g('usd_share_through_ge_20bps',2):>5} "
                  f"{g('usd_share_through_ge_30bps',2):>5}")
    os.makedirs(os.path.join(HERE, "out"), exist_ok=True)
    path = os.path.join(HERE, "out", "tapes_summary.json")
    old = json.load(open(path)) if os.path.exists(path) else {}
    old.update(out)
    json.dump(old, open(path, "w"), indent=1)


if __name__ == "__main__":
    main()
