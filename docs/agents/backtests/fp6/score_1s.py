"""fp6, added after the freeze: the DESCRIPTIVE 1 s arms of H5 (DELIST-S) and H6 (LIST-S). No bar; they decide nothing.

    python3 docs/agents/backtests/fp6/score_1s.py          # writes speed_1s.json

Davies' standing rule (2026-09-26): a study prices speed at one second (pg_cron 1.6.4 runs jobs every 1–59 s). The
frozen H5 and H6 enter at the next daily open; each arm here enters 1 s after its event instead and changes nothing
else:
* H5: 1 s after the announcement's CMS releaseDate; H6: 1 s after the perpetual's first trade (fetch_1s.py).
* The fill is the first USDⓈ-M aggTrade at or after that instant, at the frozen costs: 0.05 % taker and the frozen
  3.56 bp half-spread, a $100 short at 1x.
* The exit is the frozen planned exit (the open of that day, or the close of the last bar if the perpetual stopped
  trading first); the stop is the frozen 1.5 x the entry price, read on the entry day's remaining trades (to the end of
  the fill's minute, then the day's 1-minute highs, filling at max(level, that minute's open)) and from the next day
  on the daily highs exactly as frozen; funding is every settlement after the fill up to the frozen exit (to the end of
  the stop day when stopped, the reading the frozen scorer took).
It sets each arm beside the frozen result, event by event: what a 1 s loop would have gained or lost against the frozen
daily entry. Writes speed_1s.json with sorted keys, fixed rounding and no clock.
"""

from __future__ import annotations

import bisect
import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import measure as M  # noqa: E402
import rules as R  # noqa: E402
import score_carry as SC  # noqa: E402
import vision as V  # noqa: E402

HERE = SC.HERE
IN = SC.IN
DAY = R.DAY
FEE = 0.0005
STAKE = 100.0
iso, r = SC.iso, SC.r


def main() -> int:
    d = M.load()
    d["books"] = V.read_gz(IN / "books.json.gz")
    hs = SC.book_tables(d)["perpP90"]
    if round(hs * 1e4, 2) != 3.56:
        raise SystemExit("the frozen half-spread does not reproduce: stop")
    man = json.loads((HERE / "manifest.d" / "speed_1s.json").read_text())
    if V.sha256_file(IN / "speed_1s.json.gz") != man["inputs"]["speed_1s.json.gz"]["sha256"]:
        raise SystemExit("inputs/speed_1s.json.gz does not match its manifest fragment: stop")
    ev = V.read_gz(IN / "speed_1s.json.gz")["events"]
    perp = {s: M.bars_by_day(rows) for s, rows in d["perp"].items()}
    days = {s: sorted(b) for s, b in perp.items()}
    fund = {}

    def F(p):
        if p not in fund:
            rows = d["funding"].get(p)
            fund[p] = R.Funding.of(rows) if rows else None
        return fund[p]

    def open_or_last(p, t):
        b = perp[p]
        if t in b:
            return b[t][1]
        ds = days[p]
        return b[ds[bisect.bisect_left(ds, t) - 1]][4]

    frozen = {"h5": {(x["perp"], x["entry"]): x for x in json.loads((HERE / "delist_short.json").read_text())["events"]},
              "h6": {(x["perp"], x["entry"]): x for x in json.loads((HERE / "listing_short.json").read_text())["events"]}}
    out_ev = {"h5": [], "h6": []}
    for e in ev:
        p, h = e["perp"], e["h"]
        fz = frozen[h][(p, iso(e["frozenEntry"]))]
        row = {"perp": p, "frozenEntry": iso(e["frozenEntry"]), "frozenPnl": fz["pnl"], "frozenHow": fz["how"]}
        if h == "h5":
            row["releaseUtc"] = SC.datetime.fromtimestamp(e["release"] / 1000, tz=SC.timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
        if not e.get("fill"):
            row |= {"armPnl": 0.0, "armHow": "no fill", "why": e.get("why"), "diff": r(0.0 - fz["pnl"], 4)}
            out_ev[h].append(row)
            continue
        f = e["fill"]
        p1, t1 = f["price"], f["t"]
        pf = p1 * (1 - hs)
        q = STAKE / pf
        level = (1 + R.H5_STOP) * p1
        how = px_raw = fund_end = None
        d0 = t1 // DAY * DAY
        if e["maxToMinuteEnd"] is not None and e["maxToMinuteEnd"] >= level:
            how, px_raw, fund_end = "stop (entry minute)", level, d0 + DAY - 1
        if how is None:
            for t, o, hi in e["minutesAfter"]:
                if hi >= level:
                    how, px_raw, fund_end = "stop (entry day)", max(level, o), d0 + DAY - 1
                    break
        if how is None:
            pb, ds = perp[p], days[p]
            for t in range(d0 + DAY, e["exit"], DAY):
                if t not in pb:
                    if ds[-1] < t:
                        last = ds[bisect.bisect_left(ds, t) - 1]
                        how, px_raw, fund_end = "ended", pb[last][4], last + DAY - 1
                        break
                    continue
                if pb[t][2] >= level:
                    how, px_raw, fund_end = "stop", max(level, pb[t][1]), t + DAY - 1
                    break
        if how is None:
            pb, ds = perp[p], days[p]
            if e["exit"] in pb:
                how, px_raw, fund_end = "planned", pb[e["exit"]][1], e["exit"]
            else:
                last = ds[bisect.bisect_left(ds, e["exit"]) - 1]
                how, px_raw, fund_end = "ended", pb[last][4], last + DAY - 1
        px = px_raw * (1 + hs)
        fo = F(p)
        held = fo.held_between(t1, fund_end) if fo is not None else []
        funding = sum(q * open_or_last(p, b // DAY * DAY) * rate for b, rate in held)
        pnl = q * (pf - px) - q * pf * FEE - q * px * FEE + funding
        row |= {"fillUtc": SC.datetime.fromtimestamp(t1 / 1000, tz=SC.timezone.utc).strftime("%Y-%m-%d %H:%M:%S.%f")[:-3],
                "fillPrice": p1, "frozenEntryOpen": perp[p][e["frozenEntry"]][1],
                "armPnl": r(pnl, 4), "armHow": how, "armFunding": r(funding, 4), "diff": r(pnl - fz["pnl"], 4)}
        if h == "h6":
            row["firstTradeUtc"] = SC.datetime.fromtimestamp(e["firstTrade"]["t"] / 1000, tz=SC.timezone.utc).strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
        out_ev[h].append(row)
    meas = json.loads((HERE / "measurements.json").read_text())
    res = {"note": "descriptive arms added after the freeze on Davies' standing rule (2026-09-26); no bar, no verdict",
           "halfSpreadBp": r(hs * 1e4, 4)}
    for h in ("h5", "h6"):
        rows = out_ev[h]
        key = (lambda x: x["releaseUtc"][:10]) if h == "h5" else (lambda x: x["frozenEntry"])
        arm = sum(x["armPnl"] for x in rows)
        frz = sum(x["frozenPnl"] for x in rows)
        by_month = Counter()
        for x in rows:
            by_month[key(x)[:7]] += x["armPnl"]
        best = max(by_month.items(), key=lambda kv: (kv[1], kv[0]))
        half = SC.iso(M.HALF)
        peak = meas[h]["peakConcurrentEvents"] * STAKE
        res[h] = {
            "events": len(rows), "fills": sum(1 for x in rows if x["armHow"] != "no fill"),
            "frozenPnlUsd": r(frz, 4), "armPnlUsd": r(arm, 4), "armMinusFrozenUsd": r(arm - frz, 4),
            "eventsArmBetter": sum(1 for x in rows if x["diff"] > 0), "eventsArmWorse": sum(1 for x in rows if x["diff"] < 0),
            "armExits": dict(sorted(Counter(x["armHow"] for x in rows).items())),
            "armFirstHalfUsd": r(sum(x["armPnl"] for x in rows if key(x) < half), 4),
            "armSecondHalfUsd": r(sum(x["armPnl"] for x in rows if key(x) >= half), 4),
            "armBestMonth": best[0], "armBestMonthShare": r(best[1] / arm, 4) if arm > 0 else None,
            "armAnnualisedOnFrozenPeakCapital": r(SC.ann(arm, peak, len(M.DAYS)), 6),
            "events_detail": rows,
        }
    (HERE / "speed_1s.json").write_text(json.dumps(res, indent=1, sort_keys=True, ensure_ascii=False) + "\n")
    for h in ("h5", "h6"):
        x = res[h]
        print(h, {k: v for k, v in x.items() if k != "events_detail"})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
