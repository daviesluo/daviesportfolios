"""VB: value betting against Pinnacle's no-vig price, at UK bookmakers and at the Betfair Exchange.

The rule, written before the first run:
  * fair = Pinnacle's odds with the margin removed proportionally (p_i = (1/o_i) / sum_j 1/o_j), same snapshot.
  * a bet of 1 unit on an outcome when price x fair - 1 >= theta, theta in {2, 4, 6} %; every qualifying outcome bets.
  * "soft": the best price among the UK-licensed books football-data names in that season (Bet365, Betfred, BetMGM,
    BetVictor, bwin, Coral, Ladbrokes, William Hill, VC Bet; never "Max", which includes books a UK resident may not use).
  * "exchange": the Betfair Exchange back price, with commission c on net winnings (2 % as Smarkets charges, 5 %).
  * two snapshots: PRE-closing (collected Friday / Tuesday afternoon; a bet there could have been placed) and CLOSING
    (kick-off; placing there needs a live odds feed the repo does not have keylessly).
  * markets: 1X2, and over/under 2.5 goals where a UK book's price exists (Bet365 only, and the exchange).
  * a pre-closing bet's closing-line value: price x Pinnacle's closing fair - 1 (lower variance than the result).
Settled on the full-time result. Output: results/vb_football.json (deterministic).
"""
import csv, gzip, io, json, math, os

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INP = os.path.join(HERE, "inputs", "football")
SOFT = ["B365", "BFD", "BMGM", "BV", "BW", "CL", "LB", "WH", "VC"]
THETAS = [0.02, 0.04, 0.06]


def f(x):
    try:
        v = float(x)
        return v if v > 1.0 else None
    except Exception:
        return None


METHOD = {"m": "prop"}


def devig(odds):
    """prop: p_i = (1/o_i)/sum; power: p_i = (1/o_i)^k with k solved so sum p_i = 1 (takes more margin off longshots)."""
    if any(o is None for o in odds):
        return None
    inv = [1 / o for o in odds]
    s = sum(inv)
    if METHOD["m"] == "prop" or s <= 1.0:
        return [x / s for x in inv]
    lo, hi = 1.0, 3.0
    for _ in range(60):
        k = (lo + hi) / 2
        if sum(x ** k for x in inv) > 1:
            lo = k
        else:
            hi = k
    return [x ** hi for x in inv]


def band(o):
    return "<2" if o < 2 else "2-3" if o < 3 else "3-5" if o < 5 else ">=5"


def load():
    rows = []
    for fn in sorted(os.listdir(INP)):
        season, div = fn.split(".")[0].split("_")
        txt = gzip.open(os.path.join(INP, fn)).read().decode("utf-8-sig", errors="replace")
        for r in csv.DictReader(io.StringIO(txt)):
            if r.get("FTR") not in ("H", "D", "A"):
                continue
            r["_season"], r["_div"] = season, div
            rows.append(r)
    return rows


class Book:
    def __init__(self):
        self.p = []  # profits per unit
        self.clv = []
        self.by_season = {}
        self.by_band = {}

    def add(self, profit, season, clv=None, odds=None):
        if odds is not None:
            b = self.by_band.setdefault(band(odds), [0, 0.0, 0.0, 0])
            b[0] += 1
            b[1] += profit
            if clv is not None:
                b[2] += clv
                b[3] += 1
        self.p.append(profit)
        self.by_season.setdefault(season, []).append(profit)
        if clv is not None:
            self.clv.append(clv)

    def out(self):
        n = len(self.p)
        if n == 0:
            return {"bets": 0}
        m = sum(self.p) / n
        sd = math.sqrt(sum((x - m) ** 2 for x in self.p) / max(n - 1, 1))
        cum, peak, dd = 0.0, 0.0, 0.0
        for x in self.p:
            cum += x
            peak = max(peak, cum)
            dd = max(dd, peak - cum)
        o = {"bets": n, "roi": round(m, 4), "se": round(sd / math.sqrt(n), 4), "t": round(m / (sd / math.sqrt(n)), 2),
             "units": round(sum(self.p), 2), "max_dd_units": round(dd, 2),
             "by_season": {s: {"bets": len(v), "roi": round(sum(v) / len(v), 4)} for s, v in sorted(self.by_season.items())}}
        if self.by_band:
            o["by_odds_band"] = {k: {"bets": v[0], "roi": round(v[1] / v[0], 4),
                                     "mean_clv": (round(v[2] / v[3], 4) if v[3] else None)} for k, v in sorted(self.by_band.items())}
        if self.clv:
            o["mean_clv"] = round(sum(self.clv) / len(self.clv), 4)
            o["clv_positive_share"] = round(sum(1 for c in self.clv if c > 0) / len(self.clv), 3)
        return o


def run(rows):
    books = {}
    def B(k):
        return books.setdefault(k, Book())
    seasons = {}
    for r in rows:
        seasons.setdefault(r["_season"], 0)
        seasons[r["_season"]] += 1
        res = {"H": 0, "D": 1, "A": 2}[r["FTR"]]
        goals = None
        try:
            goals = int(r["FTHG"]) + int(r["FTAG"])
        except Exception:
            pass
        # The exchange as the anchor (added after Pinnacle was found missing from 2026-27): fair = the Betfair
        # Exchange back prices de-vigged the same way; soft bets as above. Also each anchor's log loss where both exist.
        for snap, sfx in (("pre", ""), ("close", "C")):
            ex = devig([f(r.get(f"BFE{sfx}{x}")) for x in "HDA"])
            if ex is None:
                continue
            ex_close = devig([f(r.get(f"BFEC{x}")) for x in "HDA"])
            pin = devig([f(r.get(f"PS{sfx}{x}")) for x in "HDA"])
            if pin is not None:
                B(f"logloss.{snap}.pinnacle").add(-math.log(pin[res]), r["_season"])
                B(f"logloss.{snap}.exchange").add(-math.log(ex[res]), r["_season"])
            for i, x in enumerate("HDA"):
                best = max([o for o in (f(r.get(f"{b}{sfx}{x}")) for b in SOFT) if o], default=None)
                if not best:
                    continue
                win = (best - 1) if i == res else -1.0
                clv = (best * ex_close[i] - 1) if (snap == "pre" and ex_close) else None
                for th in THETAS:
                    if best * ex[i] - 1 >= th:
                        B(f"1x2.{snap}.soft_vs_exch.th{int(th*100)}").add(win, r["_season"], clv, best)
                        if best < 5:
                            B(f"1x2.{snap}.soft_vs_exch_odds_lt5.th{int(th*100)}").add(win, r["_season"], clv, best)
        for snap, sfx in (("pre", ""), ("close", "C")):
            pin = devig([f(r.get(f"PS{sfx}{x}")) for x in "HDA"])
            pin_close = devig([f(r.get(f"PSC{x}")) for x in "HDA"])
            if pin is None:
                continue
            # baseline: Pinnacle itself
            for i, x in enumerate("HDA"):
                o = f(r.get(f"PS{sfx}{x}"))
                B(f"1x2.{snap}.pinnacle_all").add((o - 1) if i == res else -1.0, r["_season"])
            for i, x in enumerate("HDA"):
                best = max([o for o in (f(r.get(f"{b}{sfx}{x}")) for b in SOFT) if o], default=None)
                if best:
                    win = (best - 1) if i == res else -1.0
                    clv = (best * pin_close[i] - 1) if (snap == "pre" and pin_close) else None
                    B(f"1x2.{snap}.soft_all").add(win, r["_season"], clv)
                    for th in THETAS:
                        if best * pin[i] - 1 >= th:
                            B(f"1x2.{snap}.soft.th{int(th*100)}").add(win, r["_season"], clv, best)
                bfe = f(r.get(f"BFE{sfx}{x}"))
                if bfe:
                    for c in (0.02, 0.05):
                        eff = 1 + (bfe - 1) * (1 - c)
                        win = (eff - 1) if i == res else -1.0
                        clv = (eff * pin_close[i] - 1) if (snap == "pre" and pin_close) else None
                        B(f"1x2.{snap}.exch_c{int(c*100)}_all").add(win, r["_season"], clv)
                        for th in THETAS:
                            if eff * pin[i] - 1 >= th:
                                B(f"1x2.{snap}.exch_c{int(c*100)}.th{int(th*100)}").add(win, r["_season"], clv, bfe)
            # over/under 2.5
            if goals is None:
                continue
            pin_ou = devig([f(r.get(f"P{sfx}>2.5")), f(r.get(f"P{sfx}<2.5"))])
            pin_ou_close = devig([f(r.get("PC>2.5")), f(r.get("PC<2.5"))])
            if pin_ou is None:
                continue
            for i, side in enumerate([">2.5", "<2.5"]):
                won = (goals > 2.5) if i == 0 else (goals < 2.5)
                for src, key in (("soft", f"B365{sfx}{side}"), ("exch", f"BFE{sfx}{side}")):
                    o = f(r.get(key))
                    if not o:
                        continue
                    cs = (0.0,) if src == "soft" else (0.02, 0.05)
                    for c in cs:
                        eff = 1 + (o - 1) * (1 - c)
                        win = (eff - 1) if won else -1.0
                        clv = (eff * pin_ou_close[i] - 1) if (snap == "pre" and pin_ou_close) else None
                        tag = src if src == "soft" else f"exch_c{int(c*100)}"
                        B(f"ou.{snap}.{tag}_all").add(win, r["_season"], clv)
                        for th in THETAS:
                            if eff * pin_ou[i] - 1 >= th:
                                B(f"ou.{snap}.{tag}.th{int(th*100)}").add(win, r["_season"], clv)
    return seasons, {k: books[k].out() for k in sorted(books)}


def main():
    rows = load()
    out = {"matches": len(rows), "devig": {}}
    for m in ("prop", "power"):
        METHOD["m"] = m
        seasons, strat = run(rows)
        out["matches_by_season"] = dict(sorted(seasons.items()))
        out["devig"][m] = strat
        for k, o in strat.items():
            if ".th" in k or "pinnacle" in k:
                print(f"{m:5s} {k:30s} n={o['bets']:6d} roi={o.get('roi',0):+.4f} se={o.get('se',0):.4f} t={o.get('t',0):+.2f} clv={o.get('mean_clv','')}")
    json.dump(out, open(os.path.join(HERE, "results", "vb_football.json"), "w"), indent=1, sort_keys=True)


if __name__ == "__main__":
    main()
