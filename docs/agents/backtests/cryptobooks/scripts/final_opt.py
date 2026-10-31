# CRYPTOBOOKS-3 (2026-10-31): the last optimisation pass on the XRP/GBP card before its paper test is frozen. Each question
# changes one thing on xrp_study.CARD (rule.sim) and is read three ways:
#   - the 15 days of full tape (10-17 -> 10-31 11:06), split in (10-17 -> 10-23) and out (10-24 -> 10-30), with P(mean <= 0)
#     by a circular block bootstrap of days (3-day blocks) and of hours (12-hour blocks);
#   - the year's 363 sampled 13:30-16:00 windows (hist_replay.py's), each alone, starting in pounds, with P(mean <= 0) by
#     5-window blocks: the sample the realistic expectation comes from;
#   - neighbours: a change is taken only when it wins in, out and on the year, and its neighbours do too (the plateau).
# The questions: the quote's size against the capital; holding a small inventory and quoting both sides around it (TARGET);
# the basis window (replay.TRAIL); the skew (KAPPA); re-pricing on a move (THETA) or on a clock (U with THETA 0); the stop
# and its cool-down; the regime as a size modifier (SIZE_GATE / SIZE_TIGHT); XRP-GBP alone or with SOL-GBP on half each.
# Writes results/final_opt.json. Pure Python, no network.
#   CRYPTOBOOKS_BN=<binance_1s.py's output> CRYPTOBOOKS_HF=<hist_fair.py's output> python3 -I final_opt.py
import array, collections, datetime as dt, json, os, statistics, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import replay  # noqa: E402
from common import ROOT, Fair, Minutes  # noqa: E402
from best import regimes  # noqa: E402
from hist_replay import HF, W0, WinBook, WinFair  # noqa: E402
from regimes_hist import WIDE, day_spread, read  # noqa: E402
from rule import boot, sim  # noqa: E402
from xrp_study import CARD, summ  # noqa: E402

TAG = "1031b"


def windows(book):
    """The year's windows of BOOK, loaded once: [(day, t_day, WinBook, WinFair, wide)]."""
    coin = book.split("-")[0]
    tape = read(os.path.join(ROOT, "data", f"hist_{book}.txt.gz"))
    by = collections.defaultdict(list)
    for r in tape:
        by[dt.datetime.utcfromtimestamp(r[0] / 1000).date().isoformat()].append(r)
    out = []
    for day in sorted(by):
        fp, xp = os.path.join(HF, f"{coin}_{day}.f64"), os.path.join(HF, f"fx_{day}.json")
        if not (os.path.exists(fp) and os.path.exists(xp)):
            continue
        a = array.array("d")
        a.frombytes(open(fp, "rb").read())
        fx = {int(k): v for k, v in json.load(open(xp)).items()}
        if not fx or any(x != x for x in a[:10]):
            continue
        t_day = int(dt.datetime.fromisoformat(day).replace(tzinfo=dt.timezone.utc).timestamp())
        t0 = t_day + W0
        mins = sorted(fx)
        F = array.array("d")
        j = 0
        for i, v in enumerate(a):
            s = t0 + i
            while j + 1 < len(mins) and mins[j + 1] <= s:
                j += 1
            g, u = fx[mins[j]]
            F.append(v * (u or 1.0) / g if book.endswith("-GBP") else v * (u or 1.0))
        gm = Minutes([(m, fx[m][0]) for m in mins])
        t = sorted(r for r in by[day] if t0 + 2 <= r[0] // 1000 < t0 + len(F) - 400)
        if len(t) < 20:
            continue
        bk = WinBook(book, F, t0, gm, t)
        if not bk.steps:
            continue
        sp, _ = day_spread(t)
        out.append((day, t_day, bk, WinFair(len(F), t0), sp is not None and sp >= WIDE))
    return out


def year(ws, kw):
    g = []
    for day, t_day, bk, wf, wide in ws:
        r = sim(bk, wf, **(CARD | kw | {"t_from": t_day + 13 * 3600 + 1800, "t_to": t_day + 16 * 3600}))
        g.append(r["total"])
    return g


def yr_summ(g):
    return {"windows": len(g), "mean": round(statistics.mean(g), 4), "p": boot(g, 5), "pos": sum(1 for x in g if x > 0),
            "worst": round(min(g), 3), "a_day_x10.6": round(10.6 * statistics.mean(g), 3)}


def short(s):
    return {k: s[k] for k in ("a_day", "in_a_day", "out_a_day", "p_days", "p_hours", "placed_a_day", "fills_a_day", "stops",
                              "worst_day", "worst_hour", "inv_mean", "inv_max", "edge_bps")}


def main():
    fair = Fair()
    out = {"card": CARD, "tag": TAG}
    bk = replay.Book("XRP-GBP", fair, tag=TAG)
    reg = regimes(bk)
    wx = windows("XRP-GBP")
    print("windows", len(wx), flush=True)
    res = {}

    def run(name, kw, yr=True, b=bk):
        s = summ(sim(b, fair, **(CARD | kw)), reg)
        res[name] = {"kw": kw, "days15": short(s), "days": s["days"]}
        if yr:
            res[name]["year"] = yr_summ(year(wx, kw))
        y = res[name].get("year", {})
        print(name, s["a_day"], s["in_a_day"], s["out_a_day"], s["p_days"], s["placed_a_day"], "| year", y.get("mean"), y.get("p"),
              flush=True)

    run("card", {})
    # 1. size against the capital (£600)
    for q in (100.0, 150.0, 250.0, 300.0, 400.0, 600.0):
        run(f"Q{int(q)}", {"Q": q})
    # 2. a small inventory, both sides around it
    for t in (0.1, 0.25, 0.5):
        run(f"target{t}", {"target": t})
    # 3. the skew
    for kap in (0.0, 0.25, 0.75, 1.0):
        run(f"kappa{kap}", {"kappa": kap})
    # 4. re-pricing: on a move, or on a clock
    for th in (3.0, 4.0, 6.0, 8.0):
        run(f"theta{int(th)}", {"theta": th})
    for u in (5, 10, 30):
        run(f"clock{u}", {"U": u, "theta": 0.0})
    # 5. the stop and its cool-down
    for st in (100.0, 150.0, 200.0, 300.0, 500.0):
        for cd in (600, 3600, 14400):
            run(f"stop{int(st)}_cd{cd}", {"stop": st, "cooldown": cd})
    # 6. the regime as a size modifier: m x Q while the fast layer is present (median paid < w bps)
    for w in (4.0, 8.0):
        for m in (0.5, 0.75, 1.5):
            run(f"size_w{int(w)}_m{m}", {"size_gate": w, "size_tight": m})
    # 7. the basis window (15 days only: the year's windows warm their basis on 35 minutes)
    for hrs in (1, 2, 6, 12):
        replay.TRAIL = hrs * 3600
        b2 = replay.Book("XRP-GBP", fair, tag=TAG)
        run(f"trail{hrs}h", {}, yr=False, b=b2)
    replay.TRAIL = 3 * 3600
    # 8. XRP-GBP alone, or with SOL-GBP on half the capital each
    sol = replay.Book("SOL-GBP", fair, tag=TAG)
    ws = windows("SOL-GBP")
    half = {"cap": 300.0, "Q": 100.0}
    rx = sim(bk, fair, **(CARD | half))
    rs = sim(sol, fair, **(CARD | half))
    days = {k: rx["days"].get(k, 0) + rs["days"].get(k, 0) for k in rx["days"]}
    dk = sorted(days)
    ins = [days[k] for k in dk if k < "2026-10-24"]
    o = [days[k] for k in dk if "2026-10-24" <= k < "2026-10-31"]
    yx = {d: g for (d, *_), g in zip(wx, year(wx, half))}
    ys = {d: g for (d, *_), g in zip(ws, year(ws, half))}
    both = [yx[d] + ys.get(d, 0.0) for d in yx]
    res["xrp300_sol300"] = {"kw": half, "days15": {"a_day": round((rx["total"] + rs["total"]) / rx["span_days"], 3),
                                                   "in_a_day": round(sum(ins) / len(ins), 3), "out_a_day": round(sum(o) / len(o), 3),
                                                   "p_days": boot(list(days.values()), 3),
                                                   "xrp_a_day": rx["a_day"], "sol_a_day": rs["a_day"]},
                            "year": yr_summ(both)}
    print("xrp300_sol300", res["xrp300_sol300"], flush=True)
    out["variants"] = res
    with open(os.path.join(ROOT, "results", "final_opt.json"), "w") as f:
        json.dump(json.loads(json.dumps(out)), f, indent=1, sort_keys=True)


if __name__ == "__main__":
    main()
