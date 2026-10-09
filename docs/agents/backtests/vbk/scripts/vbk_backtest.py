"""VB-K design backtest: value bets at UK bookmakers against a sharp fair price, chosen in sample, tested out of sample.

Davies, 2026-10-09: "VB-K也可以自动化，只要策略制定好交给grokbot给我点就可以了，你仔细研究下具体策略和年化收益，并且和polymarket也可以结合".
Inputs: football-data.co.uk's season files as STATARB-2 pulled them (../statarb_search2/inputs/football/, 132 files, 22
divisions, 2021-22 -> 2026-27; sha256 in this folder's MANIFEST.json). Keyless, read-only. Output: results/vbk_backtest.json
and results/oos_bets_<rule>.csv.gz (deterministic: a re-run gives the same bytes).

The procedure, written before this script's first run (STATARB-2's figures had been seen; every choice below that leans on
them is named in the write-up's disclosures):
  1. De-vig method: multiplicative, additive, power, Shin and odds-ratio are all computed. The one used by the design is
     the one with the lowest mean log loss on Pinnacle's CLOSING 1X2 prices over 2021-24 (calibration, not betting ROI).
  2. Anchor: Pinnacle is the only sharp price in 2021-24, so the rule's threshold and odds cap are chosen on it. The design
     runs on the Betfair Exchange's price (Pinnacle's public API closed on 2025-07-23 and its columns stop in 2025-26), so
     the out-of-sample test (2024-27) is on the exchange anchor; Pinnacle (2024-26, where present), the bookmakers'
     average and a Pinnacle/exchange blend are reported beside it.
  3. Grid: edge threshold theta in {1,2,3,4,5,6,8,10} % x odds cap in {2, 2.5, 3, 4, 5, 7, 10, none}. The chosen cell
     maximises the in-sample t of its 3x3 neighbourhood's mean (cells with >= 600 in-sample bets); the single best cell
     is reported too. Every cell's out-of-sample result is published, so the pick can be seen against the whole grid.
  4. Walk-forward: for each season s from 2023-24, choose the cell on every season before s (Pinnacle anchor) and test it
     on s (exchange anchor where present, else Pinnacle).
  5. Leagues: all 22 divisions. Whether a division's in-sample ROI predicts its out-of-sample ROI is measured (Spearman);
     no league filter is applied.
  6. Markets: 1X2 at the best of the UK books football-data carries that season; over/under 2.5 and Asian handicap at
     Bet365 only (the one UK book with those columns), same procedure.
  7. Snapshots: CLOSE (kick-off) and PRE (Friday / Tuesday afternoon). A PRE bet's closing-line value is its price x the
     exchange's closing fair - 1.
  8. Staleness: for each CLOSE bet, whether its book's closing price equals its PRE price (the book never moved).
UK books: Bet365, Betfred, BetMGM, BetVictor, bwin, Coral, Ladbrokes, William Hill, VC Bet, Paddy Power, Sky Bet (never
"Max" or "Avg" as a venue: they include books a UK resident cannot use; Interwetten is left out as not UK-facing).
"""
import csv, gzip, io, json, math, os, datetime
import numpy as np

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INP = os.path.join(os.path.dirname(HERE), "statarb_search2", "inputs", "football")
OUT = os.path.join(HERE, "results")
SOFT = ["B365", "BFD", "BMGM", "BV", "BW", "CL", "LB", "WH", "VC", "PP", "SKB"]
METHODS = ["mult", "add", "power", "shin", "oddsratio"]
IS = {"2122", "2223", "2324"}
OOS = {"2425", "2526", "2627"}
THETAS = [0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.08, 0.10]
CAPS = [2.0, 2.5, 3.0, 4.0, 5.0, 7.0, 10.0, 1e9]
MIN_IS_BETS = 600


def fl(x):
    try:
        v = float(x)
        return v if v > 1.0 else np.nan
    except Exception:
        return np.nan


def load():
    rows = []
    for fn in sorted(os.listdir(INP)):
        season, div = fn.split(".")[0].split("_")
        txt = gzip.open(os.path.join(INP, fn)).read().decode("utf-8-sig", errors="replace")
        for r in csv.DictReader(io.StringIO(txt)):
            if r.get("FTR") not in ("H", "D", "A"):
                continue
            try:
                d = datetime.datetime.strptime(r["Date"] + " " + (r.get("Time") or "15:00"), "%d/%m/%Y %H:%M")
            except Exception:
                d = datetime.datetime.strptime(r["Date"], "%d/%m/%y")
            r["_season"], r["_div"], r["_dt"] = season, div, d.strftime("%Y-%m-%d %H:%M")
            rows.append(r)
    rows.sort(key=lambda r: (r["_dt"], r["_div"], r["HomeTeam"]))
    return rows


# ---- de-vig, vectorised over rows (n x k odds; nan where missing) --------------------------------------------------
def bisect(fn, lo, hi, n, it=60):
    lo = np.full(n, lo, float)
    hi = np.full(n, hi, float)
    for _ in range(it):
        mid = (lo + hi) / 2
        over = fn(mid)  # True where the sum of probabilities is above 1 at mid
        lo = np.where(over, mid, lo)
        hi = np.where(over, hi, mid)
    return (lo + hi) / 2


def devig(O, m):
    q = 1.0 / O
    s = q.sum(axis=1)
    n, k = O.shape
    ok = np.isfinite(s)
    P = np.full_like(O, np.nan)
    if not ok.any():
        return P
    q, s = q[ok], s[ok]
    mult = q / s[:, None]
    if m == "mult":
        p = mult
    elif m == "add":
        p = q - ((s - 1) / k)[:, None]
        bad = (p <= 0).any(axis=1)
        p[bad] = np.nan
    elif m == "power":
        kk = bisect(lambda e: (q ** e[:, None]).sum(axis=1) > 1, 1.0, 4.0, len(s))
        p = q ** kk[:, None]
    elif m == "shin":
        def pz(z):
            return (np.sqrt(z[:, None] ** 2 + 4 * (1 - z[:, None]) * q ** 2 / s[:, None]) - z[:, None]) / (2 * (1 - z[:, None]))
        z = bisect(lambda z: pz(z).sum(axis=1) > 1, 0.0, 0.5, len(s))
        p = pz(z)
    elif m == "oddsratio":
        def pc(c):
            return q / (c[:, None] + q - c[:, None] * q)
        c = bisect(lambda c: pc(c).sum(axis=1) > 1, 1.0, 50.0, len(s))
        p = pc(c)
    under = s <= 1.0  # a book summing to <= 1 (exchange back prices can): scaled up, every method alike
    p = np.where(under[:, None], mult, p)
    p = p / np.nansum(p, axis=1)[:, None]
    P[ok] = p
    return P


# ---- market tables -------------------------------------------------------------------------------------------------
def col(rows, name):
    return np.array([fl(r.get(name)) for r in rows])


def best_soft(rows, names_by_outcome):
    """names_by_outcome[i] = list of column names (one per UK book) -> (best price n x k, book index n x k)."""
    k = len(names_by_outcome)
    nb = len(names_by_outcome[0])
    A = np.stack([np.stack([col(rows, names_by_outcome[i][b]) for b in range(nb)], axis=1) for i in range(k)], axis=1)
    A2 = np.where(np.isfinite(A), A, -1.0)
    idx = A2.argmax(axis=2)
    best = np.take_along_axis(A2, idx[:, :, None], axis=2)[:, :, 0]
    best = np.where(best > 1, best, np.nan)
    return best, idx, A


def market_1x2(rows, sfx):
    res = np.array([{"H": 0, "D": 1, "A": 2}[r["FTR"]] for r in rows])
    best, idx, A = best_soft(rows, [[f"{b}{sfx}{x}" for b in SOFT] for x in "HDA"])
    win = np.zeros_like(best)
    for i in range(3):
        win[:, i] = np.where(res == i, best[:, i] - 1, -1.0)
    anchors = {"pin": np.stack([col(rows, f"PS{sfx}{x}") for x in "HDA"], 1),
               "exc": np.stack([col(rows, f"BFE{sfx}{x}") for x in "HDA"], 1),
               "avg": np.stack([col(rows, f"Avg{sfx}{x}") for x in "HDA"], 1)}
    hit = np.stack([(res == i).astype(float) for i in range(3)], 1)
    return {"best": best, "book": idx, "all": A, "win": win, "anchors": anchors, "hit": hit, "books": SOFT}


def market_ou(rows, sfx):
    goals = np.array([int(r["FTHG"]) + int(r["FTAG"]) for r in rows])
    best = np.stack([col(rows, f"B365{sfx}>2.5"), col(rows, f"B365{sfx}<2.5")], 1)
    over = (goals > 2.5).astype(float)
    hit = np.stack([over, 1 - over], 1)
    win = np.where(hit == 1, best - 1, -1.0)
    anchors = {"pin": np.stack([col(rows, f"P{sfx}>2.5"), col(rows, f"P{sfx}<2.5")], 1),
               "exc": np.stack([col(rows, f"BFE{sfx}>2.5"), col(rows, f"BFE{sfx}<2.5")], 1),
               "avg": np.stack([col(rows, f"Avg{sfx}>2.5"), col(rows, f"Avg{sfx}<2.5")], 1)}
    return {"best": best, "book": np.zeros(best.shape, int), "all": best[:, :, None], "win": win, "anchors": anchors,
            "hit": hit, "books": ["B365"]}


def ah_profit(margin, line, o):
    """One unit on a side whose goal margin is `margin` with handicap `line` (quarter lines split), at odds o."""
    parts = [line - 0.25, line + 0.25] if abs(line * 4) % 2 == 1 else [line]
    tot = 0.0
    for x in parts:
        v = margin + x
        tot += (o - 1) if v > 1e-9 else (0.0 if abs(v) <= 1e-9 else -1.0)
    return tot / len(parts)


def market_ah(rows, sfx):
    lname = "AHh" if sfx == "" else "AHCh"
    pre = "" if sfx == "" else "C"
    line = np.array([float(r[lname]) if (r.get(lname) or "").strip() not in ("",) else np.nan for r in rows])
    best = np.stack([col(rows, f"B365{pre}AHH"), col(rows, f"B365{pre}AHA")], 1)
    win = np.full(best.shape, np.nan)
    hit = np.full(best.shape, np.nan)
    for j, r in enumerate(rows):
        if not np.isfinite(line[j]):
            continue
        m = int(r["FTHG"]) - int(r["FTAG"])
        for i, (mg, ln) in enumerate(((m, line[j]), (-m, -line[j]))):
            if np.isfinite(best[j, i]):
                win[j, i] = ah_profit(mg, ln, best[j, i])
    anchors = {"pin": np.stack([col(rows, f"P{pre}AHH"), col(rows, f"P{pre}AHA")], 1),
               "exc": np.stack([col(rows, f"BFE{pre}AHH"), col(rows, f"BFE{pre}AHA")], 1),
               "avg": np.stack([col(rows, f"Avg{pre}AHH"), col(rows, f"Avg{pre}AHA")], 1)}
    return {"best": best, "book": np.zeros(best.shape, int), "all": best[:, :, None], "win": win, "anchors": anchors,
            "hit": hit, "books": ["B365"], "line": line}


# ---- statistics ----------------------------------------------------------------------------------------------------
def stats(p):
    p = np.asarray(p, float)
    n = len(p)
    if n < 2:
        return {"bets": int(n), "roi": (round(float(p.mean()), 4) if n else None)}
    m = p.mean()
    sd = max(p.std(ddof=1), 1e-12)
    cum = np.cumsum(p)
    dd = float((np.maximum.accumulate(np.concatenate([[0], cum]))[1:] - cum).max())
    streak = best = 0
    for x in p:
        streak = streak + 1 if x < 0 else 0
        best = max(best, streak)
    return {"bets": int(n), "roi": round(float(m), 4), "se": round(float(sd / math.sqrt(n)), 4),
            "t": (round(float(m / (sd / math.sqrt(n))), 2) if sd > 1e-9 else None), "units": round(float(cum[-1]), 2),
            "max_dd_units": round(dd, 2), "longest_losing_streak": int(best)}


def spearman(a, b):
    ra = np.argsort(np.argsort(a))
    rb = np.argsort(np.argsort(b))
    return float(np.corrcoef(ra, rb)[0, 1])


def main():
    rows = load()
    seasons = np.array([r["_season"] for r in rows])
    divs = np.array([r["_div"] for r in rows])
    dts = [r["_dt"] for r in rows]
    is_m = np.isin(seasons, list(IS))
    oos_m = np.isin(seasons, list(OOS))
    out = {"matches": len(rows), "matches_by_season": {s: int((seasons == s).sum()) for s in sorted(set(seasons))},
           "uk_books_by_season": {}, "procedure": __doc__.split("The procedure")[1].split("UK books:")[0].strip()}

    mk = {("1x2", "close"): market_1x2(rows, "C"), ("1x2", "pre"): market_1x2(rows, ""),
          ("ou", "close"): market_ou(rows, "C"), ("ou", "pre"): market_ou(rows, ""),
          ("ah", "close"): market_ah(rows, "C"), ("ah", "pre"): market_ah(rows, "")}
    for s in sorted(set(seasons)):
        A = mk[("1x2", "close")]["all"][seasons == s]
        out["uk_books_by_season"][s] = [b for i, b in enumerate(SOFT) if np.isfinite(A[:, 0, i]).mean() > 0.3]

    # fair prices: every market x snapshot x anchor x method (+ the blend of Pinnacle and the exchange)
    fair = {}
    for key, M in mk.items():
        for a, O in M["anchors"].items():
            for m in METHODS:
                fair[key + (a, m)] = devig(O, m)
        for m in METHODS:
            pa, pb = fair[key + ("pin", m)], fair[key + ("exc", m)]
            fair[key + ("blend", m)] = np.where(np.isfinite(pa) & np.isfinite(pb), (pa + pb) / 2, np.nan)
            # "agree": an edge must clear the threshold against BOTH the exchange and the books' average (min of the two)
            pc = fair[key + ("avg", m)]
            fair[key + ("agree", m)] = np.where(np.isfinite(pb) & np.isfinite(pc), np.minimum(pb, pc), np.nan)

    # 1. log loss (1X2 and O/U; on rows carrying every anchor compared)
    ll = {}
    for mkt in ("1x2", "ou"):
        for snap in ("close", "pre"):
            hit = mk[(mkt, snap)]["hit"]
            for scope, sm in (("2021-24", is_m), ("2024-27", oos_m)):
                for a in ("pin", "exc", "avg", "blend"):
                    for m in METHODS:
                        P = fair[(mkt, snap, a, m)]
                        okr = sm & np.isfinite(P).all(axis=1)
                        if okr.sum() < 100:
                            continue
                        lp = -np.log(np.clip((P[okr] * hit[okr]).sum(axis=1), 1e-9, 1))
                        ll[f"{mkt}.{snap}.{scope}.{a}.{m}"] = {"n": int(okr.sum()), "logloss": round(float(lp.mean()), 5)}
                # same-row comparison of pin vs exc where both exist
    out["logloss"] = ll
    cand = {m: ll.get(f"1x2.close.2021-24.pin.{m}", {}).get("logloss", 9) for m in METHODS}
    METHOD = min(METHODS, key=lambda m: (cand[m], m))
    out["devig_choice"] = {"by": "lowest log loss, Pinnacle closing 1X2, 2021-24", "logloss": cand, "chosen": METHOD}
    # same rows, both anchors, 2024-26 close
    for snap in ("close", "pre"):
        P1, P2 = fair[("1x2", snap, "pin", METHOD)], fair[("1x2", snap, "exc", METHOD)]
        P3 = fair[("1x2", snap, "avg", METHOD)]
        hit = mk[("1x2", snap)]["hit"]
        okr = np.isfinite(P1).all(1) & np.isfinite(P2).all(1) & np.isfinite(P3).all(1)
        out.setdefault("logloss_same_rows", {})[snap] = {
            "n": int(okr.sum()),
            **{a: round(float(-np.log((P[okr] * hit[okr]).sum(1)).mean()), 5) for a, P in (("pin", P1), ("exc", P2), ("avg", P3))}}

    # 2. bets
    def bets(mkt, snap, anchor, method, theta, cap, mask):
        M = mk[(mkt, snap)]
        P = fair[(mkt, snap, anchor, method)]
        E = M["best"] * P - 1
        sel = (E >= theta) & (M["best"] < cap) & np.isfinite(M["win"]) & mask[:, None]
        return sel, E

    def run(mkt, snap, anchor, method, theta, cap, mask):
        sel, E = bets(mkt, snap, anchor, method, theta, cap, mask)
        return mk[(mkt, snap)]["win"][sel], sel, E

    def grid(mkt, snap, anchor, method, mask):
        g = {}
        for th in THETAS:
            for cap in CAPS:
                w, _, _ = run(mkt, snap, anchor, method, th, cap, mask)
                g[(th, cap)] = stats(w)
        return g

    def pick(g):
        ok = {k: v for k, v in g.items() if v["bets"] >= MIN_IS_BETS and v.get("t") is not None}
        if not ok:
            return None, None
        single = max(ok, key=lambda k: (ok[k]["t"], -k[0], k[1]))
        def nb(k):
            i, j = THETAS.index(k[0]), CAPS.index(k[1])
            ts = [g[(THETAS[a], CAPS[b])].get("t", 0) or 0 for a in range(max(0, i - 1), min(len(THETAS), i + 2))
                  for b in range(max(0, j - 1), min(len(CAPS), j + 2))]
            return sum(ts) / len(ts)
        smooth = max(ok, key=lambda k: (round(nb(k), 6), -k[0], k[1]))
        return single, smooth

    def capname(c):
        return "none" if c > 1e8 else c

    res = {}
    for mkt in ("1x2", "ou", "ah"):
        for snap in ("close", "pre"):
            g_is = grid(mkt, snap, "pin", METHOD, is_m)
            single, smooth = pick(g_is)
            if smooth is None and mkt != "1x2":
                # no cell reaches MIN_IS_BETS at Bet365 alone: the 1X2 pick is carried over (named in the write-up)
                single = smooth = (THETAS[THETAS.index(res[f"1x2.{snap}"]["pick_smoothed"]["theta"])],
                                   1e9 if res[f"1x2.{snap}"]["pick_smoothed"]["cap"] == "none" else res[f"1x2.{snap}"]["pick_smoothed"]["cap"])
            r = {"in_sample_grid_pin": {f"th{int(k[0]*100)}_cap{capname(k[1])}": v for k, v in g_is.items()},
                 "pick_carried_from_1x2": mkt != "1x2" and pick(g_is)[1] is None,
                 "pick_single": single and {"theta": single[0], "cap": capname(single[1])},
                 "pick_smoothed": smooth and {"theta": smooth[0], "cap": capname(smooth[1])}}
            for a in ("exc", "pin", "avg", "blend", "agree"):
                g_o = grid(mkt, snap, a, METHOD, oos_m)
                r[f"oos_grid_{a}"] = {f"th{int(k[0]*100)}_cap{capname(k[1])}": v for k, v in g_o.items()}
            if smooth:
                for lab, k in (("single", single), ("smoothed", smooth)):
                    for a in ("exc", "pin", "avg", "blend", "agree"):
                        w, sel, E = run(mkt, snap, a, METHOD, k[0], k[1], oos_m)
                        st = stats(w)
                        rr = np.where(sel)[0]
                        st["by_season"] = {s: stats(mk[(mkt, snap)]["win"][sel & (seasons == s)[:, None]]) for s in sorted(OOS)}
                        st["mean_edge_at_bet"] = round(float(E[sel].mean()), 4) if sel.any() else None
                        st["mean_odds"] = round(float(mk[(mkt, snap)]["best"][sel].mean()), 3) if sel.any() else None
                        r[f"oos_{lab}_{a}"] = st
                    w, sel, E = run(mkt, snap, "pin", METHOD, k[0], k[1], is_m)
                    r[f"is_{lab}_pin"] = stats(w)
            # every method, the smoothed cell, exchange anchor out of sample (the design's anchor)
            if smooth:
                r["oos_smoothed_exc_by_method"] = {m: stats(run(mkt, snap, "exc", m, smooth[0], smooth[1], oos_m)[0]) for m in METHODS}
                r["is_smoothed_pin_by_method"] = {m: stats(run(mkt, snap, "pin", m, smooth[0], smooth[1], is_m)[0]) for m in METHODS}
            res[f"{mkt}.{snap}"] = r
    out["rules"] = res

    # 3. walk-forward on 1X2 close
    wf = {}
    allw = []
    wf_lines = ["dt,season,div,outcome,odds,fair_p,edge,profit,anchor"]
    for s in ("2324", "2425", "2526", "2627"):
        train = np.isin(seasons, [x for x in sorted(set(seasons)) if x < s])
        test = seasons == s
        g = grid("1x2", "close", "pin", METHOD, train)
        single, smooth = pick(g)
        anc = "exc" if s >= "2425" else "pin"
        w, sel, E = run("1x2", "close", anc, METHOD, smooth[0], smooth[1], test)
        wf[s] = {"chosen": {"theta": smooth[0], "cap": capname(smooth[1])}, "anchor": anc, **stats(w)}
        allw += list(w)
        Pw = fair[("1x2", "close", anc, METHOD)]
        for j, i in zip(*np.where(sel)):
            wf_lines.append(f"{dts[j]},{seasons[j]},{divs[j]},{'HDA'[i]},{mk[('1x2', 'close')]['best'][j, i]:.2f},{Pw[j, i]:.5f},{E[j, i]:.5f},"
                            f"{mk[('1x2', 'close')]['win'][j, i]:.4f},{anc}")
    with open(os.path.join(OUT, "wf_bets_1x2_close.csv.gz"), "wb") as fh:
        fh.write(gzip.compress(("\n".join(wf_lines) + "\n").encode(), mtime=0))
    wf["all"] = stats(allw)
    out["walk_forward_1x2_close"] = wf

    # 4. the design rule's bets (1X2 close, smoothed pick, exchange anchor), with leagues, books, staleness, CLV
    k = (res["1x2.close"]["pick_smoothed"]["theta"], res["1x2.close"]["pick_smoothed"]["cap"])
    capv = 1e9 if k[1] == "none" else k[1]
    M = mk[("1x2", "close")]
    Mp = mk[("1x2", "pre")]
    detail = {}
    for a, mask in (("exc", oos_m), ("pin", is_m)):
        sel, E = bets("1x2", "close", a, METHOD, k[0], capv, mask)
        P = fair[("1x2", "close", a, METHOD)]
        rr, oo = np.where(sel)
        books = [SOFT[M["book"][j, i]] for j, i in zip(rr, oo)]
        pre_same = []
        pre_lower = []
        for j, i in zip(rr, oo):
            b = M["book"][j, i]
            pc, pp = M["all"][j, i, b], Mp["all"][j, i, b]
            if np.isfinite(pp):
                pre_same.append(abs(pc - pp) < 1e-9)
                pre_lower.append(pp < pc - 1e-9)
        w = M["win"][sel]
        # split the bets by whether their book's price moved since the pre-closing snapshot
        moved = np.array([bool(np.isfinite(Mp["all"][j, i, M["book"][j, i]]) and abs(M["all"][j, i, M["book"][j, i]] - Mp["all"][j, i, M["book"][j, i]]) > 1e-9)
                          for j, i in zip(rr, oo)], bool)
        stale_split = {"price_unchanged_since_pre": stats(w[~moved]), "price_moved_since_pre": stats(w[moved])}
        by_book = {}
        for b, x in zip(books, w):
            by_book.setdefault(b, []).append(x)
        by_div = {}
        for j, x in zip(rr, w):
            by_div.setdefault(divs[j], []).append(x)
        detail[a] = {"bets": stats(w), "by_book": {b: stats(v) for b, v in sorted(by_book.items())},
                     "by_division": {d: stats(v) for d, v in sorted(by_div.items())},
                     "book_price_unchanged_since_pre": round(float(np.mean(pre_same)), 3) if pre_same else None,
                     "book_price_rose_since_pre": round(float(np.mean(pre_lower)), 3) if pre_lower else None,
                     "n_with_pre_price": len(pre_same), "by_staleness": stale_split}
        if a == "exc":
            lines = ["dt,season,div,home,away,outcome,book,odds,fair_p,edge,profit"]
            for j, i in zip(rr, oo):
                r = rows[j]
                lines.append(f"{dts[j]},{seasons[j]},{divs[j]},{r['HomeTeam']},{r['AwayTeam']},{'HDA'[i]},{SOFT[M['book'][j, i]]},"
                             f"{M['best'][j, i]:.2f},{P[j, i]:.5f},{E[j, i]:.5f},{M['win'][j, i]:.4f}")
            with open(os.path.join(OUT, "oos_bets_1x2_close_exc.csv.gz"), "wb") as fh:
                fh.write(gzip.compress(("\n".join(lines) + "\n").encode(), mtime=0))
        # edge bands of the design rule's bets
        eb = {}
        for lo, hi in ((0.0, 0.08), (0.08, 0.12), (0.12, 0.20), (0.20, 9.0)):
            mm = (E[sel] >= lo) & (E[sel] < hi)
            eb[f"{lo:.2f}-{hi:.2f}"] = stats(w[mm])
        detail[a]["by_edge_band"] = eb
        # the rule with one book removed from the best price (each book in turn), and with William Hill removed
        loo = {}
        for b in sorted(set(books)):
            keep = [i for i, x in enumerate(SOFT) if x != b]
            A2 = np.where(np.isfinite(M["all"][:, :, keep]), M["all"][:, :, keep], -1.0).max(axis=2)
            A2 = np.where(A2 > 1, A2, np.nan)
            E2 = A2 * P - 1
            res_i = np.array([{"H": 0, "D": 1, "A": 2}[r["FTR"]] for r in rows])
            W2 = np.stack([np.where(res_i == i, A2[:, i] - 1, -1.0) for i in range(3)], 1)
            s2 = (E2 >= k[0]) & (A2 < capv) & np.isfinite(A2) & mask[:, None]
            loo[f"without_{b}"] = stats(W2[s2])
        detail[a]["leave_one_book_out"] = loo
    # how often each book's closing price equals its pre-closing price, over every 1X2 price it quoted (base rate)
    base = {}
    for bi, b in enumerate(SOFT):
        c, p_ = M["all"][:, :, bi], Mp["all"][:, :, bi]
        both = np.isfinite(c) & np.isfinite(p_)
        if both.sum() > 1000:
            base[b] = {"prices": int(both.sum()), "unchanged_share": round(float((np.abs(c - p_) < 1e-9)[both].mean()), 3)}
    detail["book_close_equals_pre_base_rate"] = base
    # does a division's in-sample ROI predict its out-of-sample ROI?
    a_is, a_oos = detail["pin"]["by_division"], detail["exc"]["by_division"]
    common = sorted(d for d in a_is if d in a_oos and a_is[d]["bets"] >= 20 and a_oos[d]["bets"] >= 10)
    detail["division_persistence"] = {"divisions": len(common),
                                      "spearman_is_vs_oos_roi": round(spearman([a_is[d]["roi"] for d in common], [a_oos[d]["roi"] for d in common]), 3) if len(common) > 3 else None}
    out["design_rule_detail"] = {"rule": {"market": "1x2", "snap": "close", "method": METHOD, "theta": k[0], "cap": k[1]}, **detail}

    # 5. PRE snapshot as a slip window: bets placed at the Friday/Tuesday price, against each anchor, with CLV vs exchange close
    pre = {}
    Pexc_close = fair[("1x2", "close", "exc", METHOD)]
    Ppin_close = fair[("1x2", "close", "pin", METHOD)]
    kp = res["1x2.pre"]["pick_smoothed"]
    kpv = (kp["theta"], 1e9 if kp["cap"] == "none" else kp["cap"]) if kp else (k[0], capv)
    for a, mask in (("pin", is_m), ("pin", oos_m), ("avg", is_m), ("avg", oos_m), ("exc", oos_m)):
        sel, E = bets("1x2", "pre", a, METHOD, kpv[0], kpv[1], mask)
        w = Mp["win"][sel]
        best = Mp["best"]
        clv_e = (best * Pexc_close - 1)[sel]
        clv_p = (best * Ppin_close - 1)[sel]
        st = stats(w)
        st["mean_edge_at_bet"] = round(float(E[sel].mean()), 4) if sel.any() else None
        st["clv_vs_exchange_close"] = round(float(np.nanmean(clv_e)), 4) if np.isfinite(clv_e).any() else None
        st["clv_vs_pinnacle_close"] = round(float(np.nanmean(clv_p)), 4) if np.isfinite(clv_p).any() else None
        st["share_clv_exc_positive"] = round(float(np.mean(clv_e[np.isfinite(clv_e)] > 0)), 3) if np.isfinite(clv_e).any() else None
        pre[f"{a}.{'2021-24' if mask is is_m else '2024-27'}"] = st
    out["pre_window_1x2"] = {"rule": {"theta": kpv[0], "cap": capname(kpv[1])}, **pre}

    # 5a. the same matches under each anchor: 2024-26 rows carrying both Pinnacle's and the exchange's closing prices
    both = oos_m & np.isfinite(fair[("1x2", "close", "pin", METHOD)]).all(1) & np.isfinite(fair[("1x2", "close", "exc", METHOD)]).all(1)
    same = {"matches": int(both.sum())}
    for th, cp in ((k[0], capv), (0.02, 5.0), (0.04, 5.0)):
        for a in ("pin", "exc", "avg", "agree"):
            sel_, E_ = bets("1x2", "close", a, METHOD, th, cp, both)
            st_ = stats(mk[("1x2", "close")]["win"][sel_])
            st_["by_season"] = {s_: stats(mk[("1x2", "close")]["win"][sel_ & (seasons == s_)[:, None]]) for s_ in ("2425", "2526")}
            same[f"th{int(round(th*100))}_cap{capname(cp)}.{a}"] = st_
    out["same_rows_2024_26_by_anchor"] = same

    # 5b. how often the rule fires, per 1,000 matches, by season and book set (exchange anchor, close)
    rate = {}
    for th, cp in ((k[0], capv), (0.04, 4.0), (0.02, 5.0), (0.01, 5.0)):
        rr_ = {}
        for s_ in sorted(OOS):
            sm_ = seasons == s_
            sel_, E_ = bets("1x2", "close", "exc", METHOD, th, cp, sm_)
            w_ = mk[("1x2", "close")]["win"][sel_]
            rr_[s_] = {"matches": int(sm_.sum()), "bets": int(sel_.sum()), "per_1000_matches": round(1000 * sel_.sum() / sm_.sum(), 1),
                       "roi": round(float(w_.mean()), 4) if len(w_) else None}
        rate[f"th{int(round(th*100))}_cap{capname(cp)}"] = rr_
        if (th, cp) == (0.02, 5.0):
            sel_, E_ = bets("1x2", "close", "exc", METHOD, th, cp, oos_m)
            P_ = fair[("1x2", "close", "exc", METHOD)]
            M_ = mk[("1x2", "close")]
            lines = ["dt,season,div,home,away,outcome,book,odds,fair_p,edge,profit"]
            for j, i in zip(*np.where(sel_)):
                r = rows[j]
                lines.append(f"{dts[j]},{seasons[j]},{divs[j]},{r['HomeTeam']},{r['AwayTeam']},{'HDA'[i]},{SOFT[M_['book'][j, i]]},"
                             f"{M_['best'][j, i]:.2f},{P_[j, i]:.5f},{E_[j, i]:.5f},{M_['win'][j, i]:.4f}")
            with open(os.path.join(OUT, "oos_bets_1x2_close_exc_th2_cap5.csv.gz"), "wb") as fh:
                fh.write(gzip.compress(("\n".join(lines) + "\n").encode(), mtime=0))
    out["bet_rate_by_season_exc_close"] = rate

    # 6. baselines: every outcome at the best UK price
    out["baseline_every_outcome_best_uk"] = {snap: {sc: stats(mk[("1x2", snap)]["win"][np.isfinite(mk[("1x2", snap)]["win"]) & m[:, None]])
                                                    for sc, m in (("2021-24", is_m), ("2024-27", oos_m))} for snap in ("close", "pre")}
    json.dump(out, open(os.path.join(OUT, "vbk_backtest.json"), "w"), indent=1, sort_keys=True)
    print(json.dumps({"devig": out["devig_choice"], "picks": {k2: (v["pick_single"], v["pick_smoothed"]) for k2, v in res.items()},
                      "wf": wf, "design": out["design_rule_detail"]["exc"]["bets"]}, indent=1))


if __name__ == "__main__":
    main()
