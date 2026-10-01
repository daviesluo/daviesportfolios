"""DAT study, "similar": treasury companies that announced a way to close a discount (buybacks, coin sales to fund
them, liquidation), 2025-2026. DESCRIPTIVE ONLY (design.md §8 step 5), run after the MSTR screen's verdict was
written down. MSTR's own 2025-2026 actions are listed in the write-up but not measured here (its held-out years stay
unread).

Each event's day t is the first close after the announcement was public: the EDGAR acceptance time of the company's
own 8-K/6-K where there is one (EVENTS[i][6]); news reports otherwise, with the uncertainty noted. Outcomes, in log
terms: the stock from the close of t-1 to the close of t, t+20 and t+60 trading days (or the last close available),
the coin over the same span at the stock's close time (Coinbase hourly candles: 16:00 ET, 15:30 JST, 16:30 London),
and the stock minus the coin. Writes ../results/events_descriptive.json. Run: python3 .../scripts/events_describe.py
"""
import bisect, datetime as dt, gzip, json, math, os
from zoneinfo import ZoneInfo
import numpy as np
from common import INP, design_sha, r6, write_json

DESC = os.path.join(INP, "descriptive")
EVENTS = [  # (id, company, yahoo symbol, coin, event day t, what, source, timing note)
    ("E1", "BitMine", "BMNR", "ETH", "2025-07-29", "$1bn buyback authorised (stock then above its NAV)",
     "8-K 0001493152-25-011466, accepted 2025-07-29 07:20 ET", "pre-open"),
    ("E2", "Empery Digital (then Volcon)", "EMPD", "BTC", "2025-07-25",
     "bitcoin treasury launched; buyback authorisation raised to $100m", "8-K 0001683168-25-005371, 2025-07-25 09:25 ET", "pre-open"),
    ("E3", "Empery Digital", "EMPD", "BTC", "2025-08-18", "$25m credit facility to fund buybacks",
     "8-K 0001683168-25-006265, 2025-08-18 06:01 ET", "pre-open"),
    ("E4", "SharpLink", "SBET", "ETH", "2025-08-25", "$1.5bn buyback authorised",
     "8-K 0001641172-25-025218, 2025-08-22 16:15 ET (after the close)", "next session"),
    ("E5", "SharpLink", "SBET", "ETH", "2025-09-09", "first buybacks below NAV: ~939k shares at $15.98",
     "8-K 0001493152-25-012846, 2025-09-09 08:15 ET", "pre-open"),
    ("E6", "FG Nexus (now FG Communities, FGC)", "FGC", "ETH", "2025-10-21", "$200m buyback initiated",
     "8-K 0001493152-25-018733, 2025-10-21 08:30 ET (release dated 10-20)", "pre-open; possibly public 10-20"),
    ("E7", "ETHZilla (now Forum Markets, FRMM)", "FRMM", "ETH", "2025-10-28",
     "sold ~$40m of ETH to fund buybacks 'until the discount to NAV is normalized'",
     "8-K 0001213900-25-102560, 2025-10-27 16:00 ET; CoinDesk 2025-10-27", "next session"),
    ("E8", "Metaplanet", "3350.T", "BTC", "2025-10-29",
     "buyback of up to 150m shares (¥75bn), funded by a $500m credit facility, after mNAV fell below 1",
     "news of 2025-10-28 (Blockspace, Cryptonomist); timing within the day assumed after the Tokyo close", "uncertain by one day"),
    ("E9", "Sequans", "SQNS", "BTC", "2025-11-04", "sold 970 BTC to redeem half its convertible debt; supports its ADS buyback",
     "6-K 0001383395-25-000112, 2025-11-04 06:00 ET", "pre-open"),
    ("E10", "Upexi", "UPXI", "SOL", "2025-11-13", "$50m buyback authorised (mNAV reported 0.68)",
     "press release dated 2025-11-13 (Nasdaq; CoinDesk 2025-11-13); 8-K 0001477932-25-008305 on 11-14", "uncertain by one day"),
    ("E11", "FG Nexus (FGC)", "FGC", "ETH", "2025-11-21",
     "sold 10,922 ETH; bought back ~3.4m shares (8 %) at ~$3.45 against NAV ~$3.94",
     "8-K 0001493152-25-024549, 2025-11-21 08:12 ET", "pre-open"),
    ("E12", "Empery Digital", "EMPD", "BTC", "2025-12-01", "13.7m shares repurchased under a $150m programme, debt-funded",
     "8-K 0001683168-25-008737, 2025-12-01 08:30 ET", "pre-open"),
    ("E13", "BitMine", "BMNR", "ETH", "2026-04-09", "buyback expanded to $4bn; NYSE uplisting",
     "PR Newswire 2026-04-09", "uncertain by one day"),
    ("E14", "Satsuma Technology", "SATS.L", "BTC", "2026-07-21",
     "holders voted (90.6 %) to return capital by selling ~668 BTC and to delist; meeting 2026-07-20",
     "Bitcoin Magazine; crypto.news (2026-07-20)", "first London close after the meeting"),
]
CLOSE = {"USD": ("America/New_York", 16, 0), "JPY": ("Asia/Tokyo", 15, 30), "GBp": ("Europe/London", 16, 30)}


def yahoo(sym):
    j = json.load(gzip.open(os.path.join(DESC, f"yahoo_{sym}_1d.json.gz")))
    return j["meta"]["currency"], [(r[0], float(r[6] if r[6] is not None else r[5]), r[7] or 0) for r in j["rows"]]


def coin_at(rows, day, tzname, hh, mm):
    end = dt.datetime.fromisoformat(day).replace(hour=hh, minute=mm, tzinfo=ZoneInfo(tzname))
    t = int(end.timestamp()) // 3600 * 3600 - 3600            # the last hourly candle that ended by the close
    for k in range(48):
        if t - 3600 * k in rows:
            return rows[t - 3600 * k]
    raise ValueError(day)


def main():
    coins = {c: {int(r[0]): float(r[4]) for r in json.load(gzip.open(os.path.join(DESC, f"coinbase_{c}-USD_1h.json.gz")))}
             for c in ("BTC", "ETH", "SOL")}
    out = []
    for eid, name, sym, coin, day, what, src, timing in EVENTS:
        cur, rows = yahoo(sym)
        tz, hh, mm = CLOSE[cur]
        dates = [r[0] for r in rows]
        k = bisect.bisect_left(dates, day)
        if k >= len(dates) or k == 0:
            out.append({"id": eid, "note": "no price at the event"}); continue
        base = k - 1
        traded = sum(1 for r in rows[k:k + 61] if r[2] > 0)
        if traded == 0:                                  # no volume after the event: a suspended or broken series
            out.append({"id": eid, "company": name, "symbol": sym, "coin": coin, "day": dates[k], "what": what,
                        "source": src, "note": f"no traded volume from {dates[k]} in Yahoo's series; not measured"})
            continue
        rec = {"id": eid, "company": name, "symbol": sym, "coin": coin, "day": dates[k], "what": what, "source": src,
               "timing": timing, "close_used_for_coin": f"{hh:02d}:{mm:02d} {tz}", "days_traded_of_61": traded}
        for lab, h in (("t", 0), ("t20", 20), ("t60", 60)):
            j = min(k + h, len(dates) - 1)
            s = math.log(rows[j][1] / rows[base][1])
            c = math.log(coin_at(coins[coin], dates[j], tz, hh, mm) / coin_at(coins[coin], dates[base], tz, hh, mm))
            rec[lab] = {"to": dates[j], "days": j - base, "stock": r6(s), "coin": r6(c), "excess": r6(s - c)}
        out.append(rec)
    summ = {}
    for lab in ("t", "t20", "t60"):
        ex = np.array([e[lab]["excess"] for e in out if lab in e])
        st = np.array([e[lab]["stock"] for e in out if lab in e])
        co = np.array([e[lab]["coin"] for e in out if lab in e])
        summ[lab] = {"n": int(len(ex)), "excess_mean": r6(ex.mean()), "excess_median": r6(np.median(ex)),
                     "excess_sd": r6(ex.std(ddof=1)), "excess_positive": int((ex > 0).sum()),
                     "stock_mean": r6(st.mean()), "stock_positive": int((st > 0).sum()), "coin_mean": r6(co.mean())}
    sd60 = summ["t60"]["excess_sd"]
    # events needed for 80 % power, one-sided 5 %, for a mean 60-day excess of +10 % and +20 % (independent events)
    need = {f"{int(100 * m)}pct": math.ceil(((1.6449 + 0.8416) * sd60 / m) ** 2) for m in (0.10, 0.20)}
    span_years = (dt.date(2026, 7, 21) - dt.date(2025, 7, 25)).days / 365.25    # first to last listed event
    res = {"design_sha256": design_sha(), "label": "descriptive only; events chosen from public reports, not a sample",
           "events": out, "summary": summ, "events_needed_power_0.8": need,
           "events_per_year_in_this_list": r6(len(EVENTS) / span_years),
           "years_needed_at_this_rate": {k: r6(v / (len(EVENTS) / span_years)) for k, v in need.items()}}
    write_json("events_descriptive.json", res)
    for e in out:
        if "t" in e:
            print(f"{e['id']} {e['symbol']:7s} {e['day']} | t: {e['t']['stock']:+.3f} vs coin {e['t']['coin']:+.3f}"
                  f" | t+20 {e['t20']['stock']:+.3f} (coin {e['t20']['coin']:+.3f}, ex {e['t20']['excess']:+.3f})"
                  f" | t+60 {e['t60']['stock']:+.3f} (coin {e['t60']['coin']:+.3f}, ex {e['t60']['excess']:+.3f}, {e['t60']['days']}d)")
    print(json.dumps(summ, indent=1)); print("needed:", need, "per year:", res["events_per_year_in_this_list"],
                                             "years:", res["years_needed_at_this_rate"])


if __name__ == "__main__":
    main()
