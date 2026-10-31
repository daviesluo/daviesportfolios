# CRYPTOBOOKS (2026-10-31): what the seconds-level poll (poll.py) shows about Revolut X's crypto books against the outside
# price read at the same moments. The outside fair of a book at time t is Binance's bookTicker mid of COIN-USDT at its last
# read before t, times Kraken's USDT/USD mid, divided by Kraken's GBP/USD mid for a GBP book (both 24/7 venues; the poll ran
# on a Saturday, with the FX market shut). For every book read: spread, depth near the touch and near the fair, the touch
# against the fair, how often the touch's price changed between reads, the staleness slope (as tape.py's, on the mid), and
# the moments the touch sat beyond the fair by more than a taker's cost (a lag arbitrage), with the size there, and how
# long the book's mid took to follow half of a 5 or 10 bps outside move (within 30 s).
# Writes results/poll.json. Pure Python, no network.
#   python3 -I poll_an.py
import bisect, collections, json, math, os, statistics, sys, zlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import ROOT, pct  # noqa: E402

K = [2, 5, 10, 20, 30, 60, 120]
THRESH = [9, 15, 20, 30, 50]


def lines(path):
    raw = open(path, "rb").read()
    txt = zlib.decompressobj(31).decompress(raw).decode(errors="ignore")  # a poll cut off mid-write still reads
    for l in txt.splitlines():
        try:
            yield json.loads(l)
        except ValueError:
            pass


def load_ext():
    bn = collections.defaultdict(lambda: ([], []))
    kr = collections.defaultdict(lambda: ([], []))
    cb = collections.defaultdict(lambda: ([], []))
    for r in lines(os.path.join(ROOT, "data", "poll_ext.jsonl.gz")):
        if "error" in r:
            continue
        t = (r["t0"] + r["t"]) / 2
        if r["src"] == "binance":
            for s, (b, a) in r["q"].items():
                b, a = float(b), float(a)
                if b > 0 and a > 0:
                    bn[s[:-4]][0].append(t)
                    bn[s[:-4]][1].append((b + a) / 2)
        elif r["src"] == "kraken":
            for s, (b, a) in r["q"].items():
                kr[s][0].append(t)
                kr[s][1].append((float(b) + float(a)) / 2)
        elif r["src"] == "coinbase" and r["q"][0]:
            cb[r["p"]][0].append(t)
            cb[r["p"]][1].append((float(r["q"][0]) + float(r["q"][1])) / 2)
    return bn, kr, cb


def at(series, t):
    ts, vs = series
    i = bisect.bisect_right(ts, t) - 1
    return vs[i] if i >= 0 else None


def main():
    bn, kr, cb = load_ext()
    snaps = collections.defaultdict(list)
    tick = []
    errors = 0
    for r in lines(os.path.join(ROOT, "data", "poll_rx.jsonl.gz")):
        if "error" in r:
            errors += 1
        elif "tickers" in r:
            tick.append(r)
        else:
            snaps[r["book"]].append(r)
    span = [min(s[0]["t"] for s in snaps.values()), max(s[-1]["t"] for s in snaps.values())]
    out = {"window_utc": span, "rx_errors": errors, "books": {}}

    def fair(book, t):
        coin, q = book.split("-")
        m = at(bn[coin], t)
        u = at(kr["USDTZUSD"], t)
        if m is None or u is None:
            return None
        v = m * u
        if q == "GBP":
            g = at(kr["ZGBPZUSD"], t)
            if g is None:
                return None
            v /= g
        return v

    for book, ss in sorted(snaps.items()):
        rows = []
        for r in ss:
            if not r["b"] or not r["a"]:
                continue
            t = r["vts"] / 1000 if r.get("vts") else r["t"]
            f = fair(book, t)
            if f is None:
                continue
            bid, ask = float(r["b"][0][0]), float(r["a"][0][0])
            mid = (bid + ask) / 2
            usd = (at(kr["ZGBPZUSD"], t) or 1.34) if book.endswith("-GBP") else 1.0
            dep = {}
            for w in (10, 25, 50):
                db = sum(float(p) * float(q) for p, q in r["b"] if float(p) >= mid * (1 - w / 1e4)) * usd
                da = sum(float(p) * float(q) for p, q in r["a"] if float(p) <= mid * (1 + w / 1e4)) * usd
                dep[w] = (db, da)
            touch_usd = (float(r["b"][0][0]) * float(r["b"][0][1]) * usd, float(r["a"][0][0]) * float(r["a"][0][1]) * usd)
            rows.append({"t": t, "bid": bid, "ask": ask, "mid": mid, "f": f, "dep": dep, "touch": touch_usd,
                         "b": [(float(p), float(q) * float(p) * usd) for p, q in r["b"]],
                         "a": [(float(p), float(q) * float(p) * usd) for p, q in r["a"]]})
        if len(rows) < 10:
            continue
        sp = [1e4 * (x["ask"] - x["bid"]) / x["mid"] for x in rows]
        off = [1e4 * math.log(x["mid"] / x["f"]) for x in rows]
        basis = statistics.median(off)
        bidoff = [1e4 * math.log(x["bid"] / x["f"]) - basis for x in rows]
        askoff = [1e4 * math.log(x["ask"] / x["f"]) - basis for x in rows]
        gaps = [rows[i]["t"] - rows[i - 1]["t"] for i in range(1, len(rows))]
        chg = sum(1 for i in range(1, len(rows)) if rows[i]["bid"] != rows[i - 1]["bid"] or rows[i]["ask"] != rows[i - 1]["ask"])
        mid_chg = sum(1 for i in range(1, len(rows)) if rows[i]["mid"] != rows[i - 1]["mid"])
        # staleness: mid's deviation from the basis-corrected fair against the outside move over the last k s
        coin = book.split("-")[0]
        stale = {}
        for k in K:
            pts = []
            for x in rows:
                f_then = fair(book, x["t"] - k)
                if f_then is None:
                    continue
                pts.append((1e4 * math.log(x["mid"] / x["f"]) - basis, 1e4 * math.log(x["f"] / f_then)))
            if len(pts) > 30:
                mx = statistics.mean(p[1] for p in pts)
                my = statistics.mean(p[0] for p in pts)
                sxx = sum((p[1] - mx) ** 2 for p in pts)
                sxy = sum((p[1] - mx) * (p[0] - my) for p in pts)
                stale[k] = round(sxy / sxx, 3) if sxx > 0 else None
        # response: after the outside fair moved JUMP bps or more within 30 s, how long until the book's mid had moved half
        # as far the same way (later reads of this book, up to 300 s; None when it never did)
        resp = {}
        for jump in (5, 10):
            waits, never, last_ev = [], 0, -1e9
            for i, x in enumerate(rows):
                f_then = fair(book, x["t"] - 30)
                if f_then is None or x["t"] - last_ev < 60:
                    continue
                mv = 1e4 * math.log(x["f"] / f_then)
                if abs(mv) < jump:
                    continue
                last_ev = x["t"]
                m0 = rows[i - 1]["mid"] if i > 0 else x["mid"]
                got = None
                for y in rows[i:]:
                    if y["t"] - x["t"] > 300:
                        break
                    if (1e4 * math.log(y["mid"] / m0)) * (1 if mv > 0 else -1) >= abs(mv) / 2:
                        got = y["t"] - x["t"]
                        break
                if got is None:
                    never += 1
                else:
                    waits.append(got)
            resp[jump] = {"events": len(waits) + never, "half_way_s_p50": round(statistics.median(waits), 1) if waits else None,
                          "never_within_300s": never}
        # lag arbitrage: the touch beyond the (basis-corrected) fair by more than x bps, and the size beyond it
        arb = {}
        for x_ in THRESH:
            hit, usd_sum, edge_usd = 0, 0.0, 0.0
            for x in rows:
                fc = x["f"] * math.exp(basis / 1e4)
                lim_a = fc * (1 - x_ / 1e4)
                lim_b = fc * (1 + x_ / 1e4)
                sa = sum(u for p, u in x["a"] if p <= lim_a)
                sb = sum(u for p, u in x["b"] if p >= lim_b)
                if sa > 0 or sb > 0:
                    hit += 1
                    usd_sum += sa + sb
                    edge_usd += sum(u * (1 - p / fc) for p, u in x["a"] if p <= lim_a) + sum(u * (p / fc - 1) for p, u in x["b"] if p >= lim_b)
            arb[x_] = {"reads": hit, "share": round(hit / len(rows), 4), "usd_beyond_p_read": round(usd_sum / len(rows), 1),
                       "edge_usd_gross": round(edge_usd, 2)}
        # the same against the raw FX fair (no basis correction)
        arb_raw = {}
        for x_ in (9, 20):
            hit = 0
            for x in rows:
                if x["ask"] <= x["f"] * (1 - x_ / 1e4) or x["bid"] >= x["f"] * (1 + x_ / 1e4):
                    hit += 1
            arb_raw[x_] = round(hit / len(rows), 4)
        out["books"][book] = {
            "reads": len(rows), "gap_s_p50": round(statistics.median(gaps), 1),
            "spread_bps_p50": round(statistics.median(sp), 1), "spread_bps_p10_p90": [round(pct(sp, 0.1), 1), round(pct(sp, 0.9), 1)],
            "mid_vs_fair_bps_p50": round(basis, 1), "mid_vs_fair_p10_p90": [round(pct(off, 0.1), 1), round(pct(off, 0.9), 1)],
            "bid_from_fair_bps_p50": round(statistics.median(bidoff), 1), "ask_from_fair_bps_p50": round(statistics.median(askoff), 1),
            "touch_usd_p50": [round(statistics.median(x["touch"][0] for x in rows)), round(statistics.median(x["touch"][1] for x in rows))],
            "depth_usd_p50": {w: [round(statistics.median(x["dep"][w][0] for x in rows)), round(statistics.median(x["dep"][w][1] for x in rows))]
                              for w in (10, 25, 50)},
            "touch_changed_share": round(chg / (len(rows) - 1), 3), "response_to_outside_move": resp, "mid_changed_share": round(mid_chg / (len(rows) - 1), 3),
            "staleness_slope": stale, "arb_vs_basis_fair": arb, "arb_vs_fx_fair_share": arb_raw,
        }
    # every UK book from the tickers reads: spread and index_price against the mid
    sp = collections.defaultdict(list)
    vol = {}
    for r in tick:
        for sym, b, a, ix, qv in r["tickers"]:
            try:
                b, a = float(b), float(a)
            except (TypeError, ValueError):
                continue
            if b > 0 and a > 0:
                sp[sym].append(1e4 * (a - b) / ((a + b) / 2))
                vol[sym] = qv
    out["tickers"] = {s: {"spread_bps_p50": round(statistics.median(v), 1), "reads": len(v), "quote_volume_24h_last": vol.get(s)}
                      for s, v in sorted(sp.items())}
    with open(os.path.join(ROOT, "results", "poll.json"), "w") as f:
        json.dump(json.loads(json.dumps(out)), f, indent=1, sort_keys=True)
    for b, v in out["books"].items():
        print(b, v["reads"], v["spread_bps_p50"], v["mid_vs_fair_bps_p50"], v["bid_from_fair_bps_p50"], v["ask_from_fair_bps_p50"],
              v["touch_changed_share"], v["staleness_slope"], {k: v["arb_vs_basis_fair"][k]["share"] for k in (9, 20)})


if __name__ == "__main__":
    main()
