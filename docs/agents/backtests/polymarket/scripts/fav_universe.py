"""FAV data step 1: the candidate universe of resolved binary markets (fp4).

From the closed-market pulls ($PM_DATA/closed/*.json) keep every two-outcome
market with an order book, whatever it paid (a 50-50 or void payout is kept and
traded at what it paid), at least $5,000 of lifetime volume, not a crypto up/down market,
whose end date falls in [2025-01-01, 2026-09-10), and that was still open at the
decision time of at least one horizon (end date minus h, h in HORIZONS_H). The
end date is read as Gamma serves it now (see the pre-registration's
disclosures). Writes $PM_DATA/fav/universe.json.
"""
import glob
import json
import os
import re
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(__file__))
import pmnet  # noqa: E402

HORIZONS_H = [24, 168, 1]
LO, HI = "2025-01-01T00:00:00+00:00", "2026-09-10T00:00:00+00:00"
MIN_VOL = 5000.0
# Deviation from the pre-registration, fixed before any price was read: the prints of every candidate market
# would take about six hours of paced requests, so the test runs on one Gamma event in SAMPLE_MOD, chosen by its
# id (outcome-blind; a market without an event by its condition id). Every count is also reported unsampled.
SAMPLE_MOD = 4


def sampled(m):
    ev = (m.get("events") or [{}])[0].get("id")
    if ev and str(ev).isdigit():
        return int(ev) % SAMPLE_MOD == 0
    return int(m["conditionId"][-6:], 16) % SAMPLE_MOD == 0

CRYPTO = re.compile(r"\b(bitcoin|btc|ethereum|eth|solana|sol|xrp|ripple|dogecoin|doge|crypto|bnb|hyperliquid|hype|cardano|ada|litecoin|chainlink|pepe|memecoin|stablecoin|usdt|usdc|tether|coinbase|binance|microstrategy|megaeth|pump\.fun|airdrop|fdv|token)\b", re.I)
SPORTS = re.compile(r"\b(nba|nfl|mlb|nhl|wnba|ncaa|epl|premier league|uefa|fifa|ufc|tennis|atp|wta|f1|formula 1|grand prix|golf|pga|lpga|cricket|ipl|esports|lol|cs2|counter-strike|dota|valorant|champions league|europa league|serie a|la liga|laliga|bundesliga|ligue 1|mls|world cup|super bowl|stanley cup|world series|nascar|boxing|wimbledon|us open|french open|australian open|masters|o/u|spread|moneyline|match|vs\.?|fc|win on \d{4}|draw)\b", re.I)
WEATHER = re.compile(r"\b(temperature|°f|°c|rain|snow|hurricane|tornado|weather|precipitation)\b", re.I)
ECON = re.compile(r"\b(fed|fomc|interest rate|rate cut|rate hike|cpi|inflation|gdp|recession|unemployment|jobs report|nonfarm|payrolls|ecb|boe|bank of england|bank of japan|tariff|treasury|yield)\b", re.I)
FIN = re.compile(r"\b(nasdaq|s&p|spx|dow|stock|shares|earnings|ipo|market cap|nvidia|apple|tesla|microsoft|amazon|google|meta|gold|silver|oil|crude)\b", re.I)
POL = re.compile(r"\b(election|elected|president|presidential|senate|senator|house|governor|mayor|trump|biden|harris|vance|parliament|prime minister|pm|vote|primary|congress|cabinet|minister|party|democrat|republican|impeach|supreme court|scotus|poll|nominee)\b", re.I)
GEO = re.compile(r"\b(war|ceasefire|invade|invasion|strike|missile|israel|gaza|hamas|iran|ukraine|russia|putin|zelensky|nato|china|taiwan|north korea|military|troops|attack|sanction)\b", re.I)
MENTION = re.compile(r"\b(say|says|said|mention|mentions|tweet|tweets|post|posts)\b", re.I)


def ts(s):
    if not s:
        return None
    s = s.strip().replace(" ", "T")
    if s.endswith("+00"):
        s += ":00"
    s = s.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(s).timestamp()
    except ValueError:
        return None


def is_updown(m):
    s = (m.get("slug") or "") + " " + " ".join((e.get("seriesSlug") or "") for e in m.get("events") or [])
    return "updown" in s or "up-or-down" in s


def category(m):
    ft = m.get("feeType") or ""
    if ft.endswith("_fees") or ft.startswith("crypto_fees"):
        return ft.split("_fees")[0]
    text = " ".join([m.get("question") or "", m.get("slug") or ""] + [(e.get("title") or "") + " " + (e.get("seriesSlug") or "") for e in m.get("events") or []])
    if m.get("sportsMarketType") or m.get("gameStartTime") or SPORTS.search(text):
        return "sports"
    if WEATHER.search(text):
        return "weather"
    if CRYPTO.search(text):
        return "crypto"
    if ECON.search(text):
        return "economics"
    if FIN.search(text):
        return "finance"
    if GEO.search(text):
        return "geopolitics"
    if POL.search(text):
        return "politics"
    if MENTION.search(text):
        return "mentions"
    return "other"


# the taker fee rate charged today (Fee Structure V2, 2026-03-30); a market without its own
# schedule is charged the highest non-crypto rate unless it reads as crypto
def fee_rate(m, cat):
    fs = m.get("feeSchedule") or {}
    if m.get("feesEnabled") and fs.get("rate") is not None:
        return float(fs["rate"])
    return 0.07 if cat == "crypto" else 0.05


def main():
    lo, hi = ts(LO), ts(HI)
    out, counts = [], {"closed_rows": 0, "binary_book": 0, "not_updown": 0, "vol_ok": 0, "in_window": 0,
                       "payout_0_1": 0, "payout_other": 0, "open_at_some_Td": 0, "sampled": 0,
                       "sample_rule": f"Gamma event id % {SAMPLE_MOD} == 0"}
    for f in pmnet.list_json(os.path.join(pmnet.DATA, "closed")):
        for m in pmnet.load(f):
            counts["closed_rows"] += 1
            try:
                outs = json.loads(m.get("outcomes") or "[]")
                toks = json.loads(m.get("clobTokenIds") or "[]")
                op = [float(x) for x in json.loads(m.get("outcomePrices") or "[]")]
            except ValueError:
                continue
            if not m.get("enableOrderBook") or len(outs) != 2 or len(toks) != 2 or len(op) != 2:
                continue
            counts["binary_book"] += 1
            if is_updown(m):
                continue
            counts["not_updown"] += 1
            if (m.get("volumeNum") or 0) < MIN_VOL:
                continue
            counts["vol_ok"] += 1
            end, closed = ts(m.get("endDate")), ts(m.get("closedTime"))
            if end is None or closed is None or not (lo <= end < hi):
                continue
            counts["in_window"] += 1
            # every payout counts: a 50-50 or void market is traded at what it paid (the pre-registration)
            if sorted(op) != [0.0, 1.0]:
                counts["payout_other"] += 1
            else:
                counts["payout_0_1"] += 1
            start = ts(m.get("startDate")) or ts(m.get("createdAt"))
            tds = {}
            for h in HORIZONS_H:
                td = end - h * 3600
                if start is not None and start < td - 6 * 3600 and closed > td:
                    tds[str(h)] = td
            if not tds:
                continue
            counts["open_at_some_Td"] += 1
            if not sampled(m):
                continue
            counts["sampled"] += 1
            cat = category(m)
            ev = (m.get("events") or [{}])[0]
            out.append({"cond": m["conditionId"], "q": (m.get("question") or "")[:120], "outcomes": outs, "tokens": toks,
                        "payout": op, "end": end, "closed": closed, "start": start, "tds": tds, "cat": cat,
                        "fee_rate": fee_rate(m, cat), "tick": m.get("orderPriceMinTickSize"), "vol": m.get("volumeNum"),
                        "neg": bool(m.get("negRisk")), "event": ev.get("id"), "event_slug": ev.get("slug")})
    pmnet.dump(os.path.join(pmnet.DATA, "fav", "universe.json"), out)
    print(json.dumps(counts))


if __name__ == "__main__":
    main()
