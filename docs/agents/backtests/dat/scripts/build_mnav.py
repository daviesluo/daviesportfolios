"""DAT study, step 2: MSTR's point-in-time mNAV on the screen, 2020-08-11 → 2024-12-31 (design.md §2). Levels only:
no return after a predictor is computed here.

Inputs: the SEC filings cached by pull_sec.py (index, primary documents, EX-99 exhibits, XBRL company facts), the
three press releases with no filing that day (PRESS, sources in notes/sources.md), the hand tables of share increments
(INCREMENTS) and debt instruments (DEBT), each row naming the accession it was read from (the script checks that each
row's number appears in that filing's text), MSTR's daily bars and BTC's 15-minute candles from pull_screen_prices.py.

An event counts from the first US close after it was published: an EDGAR acceptance before 16:00 ET (13:00 ET on an
early close) counts that day, a later one the next trading day; an 8-K that says the company announced it on an
earlier day (at most three days earlier) counts from that day. Press releases count the day they are dated.

Writes ../results/mnav_screen.csv (one row a trading day) and ../results/mnav_screen_events.json (every event, with
its source), and prints a levels summary. Run: python3 docs/agents/backtests/dat/scripts/build_mnav.py [--press-lag]
(--press-lag counts the three press releases one trading day later: the sensitivity of design.md §2).
"""
import bisect, csv, datetime as dt, gzip, json, os, re, sys
import numpy as np
from common import (ET, EARLY_CLOSE, INP, RES, SCREEN_END, SCREEN_FIRST, btc_at, design_sha, html_text,
                    read_btc_15m, read_mstr_daily, write_json)

CIK = "0001050446"
SEC = os.path.join(INP, "sec", CIK)
INDEX = os.path.join(SEC, "filings_2020-07-01_2024-12-31.json")
MONTHS = {m: i + 1 for i, m in enumerate(["January", "February", "March", "April", "May", "June", "July", "August",
                                           "September", "October", "November", "December"])}
SPLIT_DAY = "2024-08-08"                       # 10-for-1, trading split-adjusted from this open (8-K 2024-07-11)
PRESS = [  # (date, holdings, source) - press releases with no SEC filing that day (notes/sources.md)
    ("2020-12-21", 70470, "press release 2020-12-21 (Yahoo/CoinDesk report of it)"),
    ("2021-02-24", 90531, "press release 2021-02-24 (strategy.com/press ..._02-24-2021)"),
    ("2021-06-21", 105085, "press release 2021-06-21 (strategy.com/press ..._06-21-2021)"),
]
FIRST_PURCHASES = {  # holdings stated as purchases in the first two 8-Ks (no "held approximately" sentence)
    "0001193125-20-215604": (21454, "purchased 21,454 bitcoins"),
    "0001193125-20-245835": (38250, "a total of 38,250 bitcoins"),
}
# Share increments published between covers (post-split units are multiplied below by the split rule on the
# publication date). kind: 'atm' sales; 'conv' notes certain to convert (redemption notice of deep in-the-money notes).
INCREMENTS = [
    ("0001193125-21-254529", 238053, "atm", "238,053 Shares", "Jul 1 - Aug 23, 2021"),
    ("0001193125-21-270915", 317126, "atm", "555,179 Shares", "Q3 to Sep 12 cumulative 555,179 less the 238,053 above"),
    ("0001193125-21-341815", 571001, "atm", "571,001 Shares", "Oct 1 - Nov 29, 2021"),
    ("0001193125-21-352140", 119828, "atm", "119,828 Shares", "Nov 29 - Dec 8, 2021"),
    ("0001193125-21-369767", 167759, "atm", "167,759 Shares", "Dec 9 - Dec 29, 2021"),
    ("0001193125-22-313098", 218575, "atm", "218,575 Shares", "Oct 1 - Dec 27, 2022"),
    ("0001193125-23-079839", 1348855, "atm", "1,348,855 Shares", "Jan 1 - Mar 24, 2023"),
    ("0001193125-23-176793", 1079170, "atm", "1,079,170 Shares", "May 2023 agreement, to Jun 27, 2023"),
    ("0001193125-23-240932", 403362, "atm", "403,362 Shares", "Aug 2023 agreement, to Sep 24, 2023"),
    ("0001193125-23-285756", 1189588, "atm", "1,189,588 shares", "Nov 1 - Nov 28, 2023"),
    ("0001193125-23-303488", 1076915, "atm", "1,076,915 Shares", "Nov 30, 2023 agreement, to Dec 26, 2023"),
    ("0001193125-24-045396", 11724, "atm", "1,272,077 Shares",
     "Nov 30, 2023 agreement cumulative 1,272,077 to Feb 25, 2024, less 1,076,915 and the 183,438 the Feb 1 cover already holds"),
    ("0001193125-24-161184", 1633190, "conv", "2.5126 shares",
     "redemption notice for the $650m 2025 notes (conversion price $397.99): 650,000 x 2.5126 shares"),
    ("0001193125-24-218462", 8048449, "atm", "8,048,449 Shares", "Aug 1, 2024 agreement, to Sep 12, 2024 (post-split)"),
    ("0001193125-24-255184", 7854647, "atm", "7,854,647 Shares", "to Nov 10, 2024 (post-split)"),
    ("0001193125-24-260452", 13593865, "atm", "13,593,865 Shares", "Nov 11 - Nov 17, 2024"),
    ("0001193125-24-264733", 5597849, "atm", "5,597,849 Shares", "Nov 18 - Nov 24, 2024"),
    ("0001193125-24-268429", 3728507, "atm", "3,728,507 Shares", "Nov 25 - Dec 1, 2024"),
    ("0001193125-24-272923", 5418449, "atm", "5,418,449 Shares", "Dec 2 - Dec 8, 2024"),
    ("0001193125-24-279044", 3884712, "atm", "3,884,712 Shares", "Dec 9 - Dec 15, 2024"),
    ("0001193125-24-283686", 1317841, "atm", "1,317,841 Shares", "Dec 16 - Dec 22, 2024"),
    ("0001193125-24-286217", 592987, "atm", "592,987 Shares", "Dec 23 - Dec 29, 2024"),
]
# Debt principal: (accession in, amount USD, accession out or None, check string, name)
DEBT = [
    ("0001193125-20-315971", 650e6, "0001193125-24-161184", "$650 million", "0.750% convertible notes due 2025"),
    ("0001193125-21-048555", 1050e6, None, "$1.05 billion", "0% convertible notes due 2027"),
    ("0001193125-21-189600", 500e6, "0001193125-24-222462", "$500 million", "6.125% senior secured notes due 2028"),
    ("0001193125-22-087494", 205e6, "0001193125-23-079839", "$205.0 million", "Silvergate term loan"),
    ("0001193125-24-064321", 800e6, None, "$800 million", "0.625% convertible notes due 2030"),
    ("0001193125-24-070793", 603.75e6, None, "$603.75 million", "0.875% convertible notes due 2031"),
    ("0001193125-24-164009", 800e6, None, "$800 million", "2.25% convertible notes due 2032"),
    ("0001193125-24-222462", 1010e6, None, "$1.01 billion", "0.625% convertible notes due 2028"),
    ("0001193125-24-263404", 3000e6, None, "$3 billion", "0% convertible notes due 2029"),
]
HELD = re.compile(r"(?:held|holds|hold)\s+(?:an?\s+aggregate\s+of\s+)?(?:approximately\s+)?([\d,]{3,})\s+bitcoins"
                  r"|approximately ([\d,]{3,}) bitcoins held by (?:MicroStrategy|the Company)", re.I)
COVER = re.compile(r"As of (January|February|March|April|May|June|July|August|September|October|November|December) "
                   r"(\d{1,2}), (\d{4}) ?, the registrant had ([\d,]+) and ([\d,]+) shares of class A common stock and "
                   r"class B common stock outstanding", re.I)
ANNOUNCED = re.compile(r"On (January|February|March|April|May|June|July|August|September|October|November|December) "
                       r"(\d{1,2}), (\d{4}),? (?:the Company|MicroStrategy)[^.]{0,60}?announced")


def close_of(day):
    hh = 13 if day in EARLY_CLOSE else 16
    return dt.datetime.fromisoformat(day).replace(hour=hh, tzinfo=ET)


def main():
    press_lag = "--press-lag" in sys.argv
    days = read_mstr_daily()
    days = [d for d in days if d[0] >= SCREEN_FIRST]
    dates = [d[0] for d in days]

    def effective(t_utc_iso=None, day=None):
        """Index of the first trading day whose close is at or after the publication."""
        if day is not None:
            return bisect.bisect_left(dates, day)
        t = dt.datetime.fromisoformat(t_utc_iso.replace("Z", "+00:00")).astimezone(ET)
        k = bisect.bisect_left(dates, t.strftime("%Y-%m-%d"))
        if k < len(dates) and dates[k] == t.strftime("%Y-%m-%d") and t > close_of(dates[k]):
            k += 1
        return k

    filings = json.load(open(INDEX))["filings"]
    by_acc = {f["accession"]: f for f in filings}
    texts = {}
    for f in filings:
        docs = [f["document"]] + [e["name"] for e in f.get("exhibits", [])]
        texts[f["accession"]] = [html_text(gzip.open(os.path.join(SEC, f"{f['accession']}_{d}.gz")).read()) for d in docs]

    def pub_index(f):
        k = effective(f["acceptance_utc"])
        if f["form"].startswith("8-K"):                    # announced up to three days before EDGAR accepted it
            acc_day = dt.datetime.fromisoformat(f["acceptance_utc"].replace("Z", "+00:00")).astimezone(ET).date()
            for m, d, y in ANNOUNCED.findall(texts[f["accession"]][0]):
                a = dt.date(int(y), MONTHS[m], int(d))
                if dt.timedelta(0) < acc_day - a <= dt.timedelta(days=3):
                    k = min(k, effective(day=a.isoformat()))
        return k

    events = {"holdings": [], "covers": [], "increments": [], "debt": [], "cash": []}
    # holdings
    for f in filings:
        nums = [int((a or b).replace(",", "")) for t in texts[f["accession"]] for a, b in HELD.findall(t)]
        if f["accession"] in FIRST_PURCHASES:
            v, s = FIRST_PURCHASES[f["accession"]]
            assert any(s in t for t in texts[f["accession"]]), f["accession"]
            nums.append(v)
        if nums:
            events["holdings"].append({"k": pub_index(f), "value": max(nums), "source": f["accession"],
                                       "form": f["form"], "acceptance_utc": f["acceptance_utc"]})
    for day, v, src in PRESS:
        k = effective(day=day) + (1 if press_lag else 0)
        events["holdings"].append({"k": k, "value": v, "source": src, "form": "press", "acceptance_utc": day})
    # covers
    for f in filings:
        if f["form"] in ("10-Q", "10-K"):
            m = COVER.search(texts[f["accession"]][0])
            assert m, f"no cover count in {f['accession']}"
            asof = dt.date(int(m.group(3)), MONTHS[m.group(1)], int(m.group(2))).isoformat()
            n = int(m.group(4).replace(",", "")) + int(m.group(5).replace(",", ""))
            n *= 10 if asof < SPLIT_DAY else 1
            events["covers"].append({"k": pub_index(f), "asof": asof, "value": n, "source": f["accession"]})
    for acc, n, kind, check, note in INCREMENTS:
        f = by_acc[acc]
        assert any(check in t for t in texts[acc]), (acc, check)
        k = pub_index(f)
        mult = 10 if dates[min(k, len(dates) - 1)] < SPLIT_DAY else 1          # published before the split: pre-split units
        events["increments"].append({"k": k, "value": n * mult, "kind": kind, "source": acc, "note": note})
    for acc_in, amt, acc_out, check, name in DEBT:
        assert any(check in t for t in texts[acc_in]), (acc_in, check)
        events["debt"].append({"k_in": pub_index(by_acc[acc_in]), "k_out": pub_index(by_acc[acc_out]) if acc_out else None,
                               "amount": amt, "name": name, "source_in": acc_in, "source_out": acc_out})
    facts = json.load(gzip.open(os.path.join(SEC, "companyfacts.json.gz")))
    seen = set()
    for a in facts["facts"]["us-gaap"]["CashAndCashEquivalentsAtCarryingValue"]["units"]["USD"]:
        if a["filed"] <= SCREEN_END and a["end"] >= "2020-06-30" and a["end"] not in seen:
            first = min((b for b in facts["facts"]["us-gaap"]["CashAndCashEquivalentsAtCarryingValue"]["units"]["USD"]
                         if b["end"] == a["end"]), key=lambda b: b["filed"])
            seen.add(a["end"])
            events["cash"].append({"k": bisect.bisect_right(dates, first["filed"]), "end": a["end"], "value": first["val"],
                                   "filed": first["filed"], "form": first["form"]})

    # step series
    n_days = len(dates)
    H = np.full(n_days, np.nan); N = np.full(n_days, np.nan); D = np.zeros(n_days); C = np.full(n_days, np.nan)
    for e in sorted(events["holdings"], key=lambda e: (e["k"], e["value"])):
        if e["k"] < n_days:
            H[e["k"]:] = e["value"]
    covers = sorted(events["covers"], key=lambda e: e["k"])
    for i in range(n_days):
        cv = [c for c in covers if c["k"] <= i]
        if not cv:
            continue
        base = cv[-1]
        inc = sum(e["value"] for e in events["increments"] if base["k"] < e["k"] <= i)
        N[i] = base["value"] + inc
    for e in events["debt"]:
        lo, hi = e["k_in"], (e["k_out"] if e["k_out"] is not None else n_days)
        D[lo:hi] += e["amount"]
    for e in sorted(events["cash"], key=lambda e: e["k"]):
        if e["k"] < n_days:
            C[e["k"]:] = e["value"]
    c15 = read_btc_15m()
    rows, lags = [], []
    for i, (day, o, p) in enumerate(days):
        hh = 13 if day in EARLY_CLOSE else 16
        b, lag1 = btc_at(c15, day, hh, 0)
        bo, lag2 = btc_at(c15, day, 9, 30)
        lags += [lag1, lag2]
        mc = p * N[i]
        nav = H[i] * b
        rows.append([day, o, p, bo, b, H[i], N[i], D[i], C[i], mc / nav, (mc + D[i] - (C[i] if C[i] == C[i] else 0)) / nav])
    os.makedirs(RES, exist_ok=True)
    name = "mnav_screen_presslag.csv" if press_lag else "mnav_screen.csv"
    with open(os.path.join(RES, name), "w", newline="") as f:
        w = csv.writer(f, lineterminator="\n")  # LF, as the repository stores text (.gitattributes eol=lf)
        w.writerow(["date", "mstr_open", "mstr_close", "btc_0930et", "btc_close_et", "btc_held", "shares_basic",
                    "debt_principal", "cash", "mnav_simple", "mnav_ev"])
        for r in rows:
            w.writerow([r[0]] + [("%.10g" % v) for v in r[1:]])
    if not press_lag:
        write_json("mnav_screen_events.json", {
            "design_sha256": design_sha(), "first": dates[0], "last": dates[-1], "trading_days": n_days,
            "btc_candle_fallbacks": int(sum(1 for x in lags if x > 0)),
            "events": {k: [{**e, **({"date": dates[e["k"]] if e.get("k", n_days) < n_days else None})} for e in v]
                       for k, v in events.items() if k != "debt"},
            "debt": [{**e, "date_in": dates[e["k_in"]], "date_out": dates[e["k_out"]] if e["k_out"] is not None else None}
                     for e in events["debt"]]})
    m = np.array([r[9] for r in rows]); mev = np.array([r[10] for r in rows])
    yrs = sorted(set(d[:4] for d in dates))
    print(f"{name}: {n_days} days {dates[0]} .. {dates[-1]}; BTC candle fallbacks {sum(1 for x in lags if x > 0)}")
    for y in yrs:
        s = np.array([d[:4] == y for d in dates])
        print(f"  {y}: mNAV simple min {m[s].min():.2f} median {np.median(m[s]):.2f} max {m[s].max():.2f} | "
              f"EV min {mev[s].min():.2f} median {np.median(mev[s]):.2f} max {mev[s].max():.2f}")


if __name__ == "__main__":
    main()
