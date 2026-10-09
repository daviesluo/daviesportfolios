"""FXW's cross-check on a second source: Yahoo's hourly FX (inputs/yahoo/fx_1h), whose week starts at Sunday 23:00 or
Monday 00:00 UTC, one to two hours after FXCM's open. Added after FXW's first run, to see whether its AUDUSD result is
FXCM's alone. For each weekend both sources hold:
  * agreement: Yahoo's first open against FXCM's mid at +1 h and against FXCM's Friday close (both gaps, in bps);
  * the late entry on Yahoo alone: fade gY = ln(Yahoo's first open / Yahoo's Friday close) when |gY| >= 20 bps,
    close at Yahoo's close 24 bars later, 2 bps round trip (FXW's E1 on another feed).
Output: results/fx_yahoo_check.json.
"""
import csv, gzip, io, json, math, os, statistics as st
import datetime as dt

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAP = {"AUDUSD": "AUDUSD=X", "EURUSD": "EURUSD=X", "GBPUSD": "GBPUSD=X", "USDJPY": "JPY=X"}


def main():
    out = {}
    for p, y in MAP.items():
        j = json.loads(gzip.open(os.path.join(HERE, "inputs", "yahoo", "fx_1h", y + ".json.gz")).read())["chart"]["result"][0]
        ts, q = j["timestamp"], j["indicators"]["quote"][0]
        bars = [(t, o, c) for t, o, c in zip(ts, q["open"], q["close"]) if o and c]
        wk = []
        for i in range(1, len(bars)):
            if bars[i][0] - bars[i - 1][0] >= 30 * 3600 and dt.datetime.utcfromtimestamp(bars[i - 1][0]).weekday() == 4:
                if i + 24 < len(bars):
                    wk.append((bars[i - 1][0], bars[i - 1][2], bars[i][0], bars[i][1], bars[i + 24][2]))
        fx = {}
        for r in csv.DictReader(io.StringIO(gzip.open(os.path.join(HERE, "inputs", "fx", f"fxcm_{p}_weekends.csv.gz")).read().decode())):
            d = dt.datetime.utcfromtimestamp(int(r["fri_utc"])).date()
            fx[d] = r
        agree, late = [], []
        for fri_t, fri_c, sun_t, sun_o, c24 in wk:
            gY = math.log(sun_o / fri_c)
            if abs(gY) >= 0.002:
                late.append((-1 if gY > 0 else 1) * math.log(c24 / sun_o) - 2e-4)
            r = fx.get(dt.datetime.utcfromtimestamp(fri_t).date())
            if r:
                fmid = (float(r["fri_bid"]) + float(r["fri_ask"])) / 2
                smid = (float(r["sun_bid_open"]) + float(r["sun_ask_open"])) / 2
                agree.append({"fxcm_gap_open_bps": 1e4 * math.log(smid / fmid), "fxcm_gap_1h_bps": 1e4 * math.log(float(r["mid_1h"]) / fmid),
                              "yahoo_gap_bps": 1e4 * gY, "fri_close_diff_bps": 1e4 * math.log(fri_c / fmid)})
        def corr(a, b):
            ma, mb = sum(a) / len(a), sum(b) / len(b)
            return sum((x - ma) * (y - mb) for x, y in zip(a, b)) / math.sqrt(sum((x - ma) ** 2 for x in a) * sum((y - mb) ** 2 for y in b))
        big = [a for a in agree if abs(a["fxcm_gap_open_bps"]) >= 20]
        m = sum(late) / len(late) if late else 0
        out[p] = {"weekends_both": len(agree),
                  "corr_yahoo_gap_vs_fxcm_gap_at_open": round(corr([a["yahoo_gap_bps"] for a in agree], [a["fxcm_gap_open_bps"] for a in agree]), 3),
                  "corr_yahoo_gap_vs_fxcm_gap_at_1h": round(corr([a["yahoo_gap_bps"] for a in agree], [a["fxcm_gap_1h_bps"] for a in agree]), 3),
                  "median_abs_friday_close_diff_bps": round(st.median(abs(a["fri_close_diff_bps"]) for a in agree), 2),
                  "fxcm_gaps_ge_20bps": len(big),
                  "of_which_share_of_gap_left_at_yahoo_start": round(st.median(a["yahoo_gap_bps"] / a["fxcm_gap_open_bps"] for a in big), 3) if big else None,
                  "late_fade_on_yahoo": {"n": len(late), "mean_bps": round(1e4 * m, 2),
                                         "t": round(m / (st.pstdev(late) / math.sqrt(len(late))), 2) if len(late) > 1 else None}}
        print(p, out[p])
    json.dump(out, open(os.path.join(HERE, "results", "fx_yahoo_check.json"), "w"), indent=1, sort_keys=True)


if __name__ == "__main__":
    main()
