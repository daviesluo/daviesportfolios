"""Venue-level figures: what one account at each venue could run, summed over its books, from sv_sim.py's results.

Packages (which books one account can trade, as read 2026-10-09; see the review's §2):
* coinbase_uk: a UK Coinbase account (CB Payments Ltd) holds GBP and EUR balances: USDC-GBP, USDT-GBP, USDC-EUR, USDT-EUR.
* coinbase_eea: an EEA account (Coinbase Luxembourg, MiCA): USDC-EUR (no USDT in the EEA since 2024-12-30).
* okx_eea: OKX Europe (MiCA, Malta), a spot-only account: USDC-EUR, USDG-EUR (USDT not tradable in the EEA).
* kraken: USDG/USD only (0 % maker); its EUR/GBP stable books pay 0.20 % maker. USDe/EUR is shown alone.
* bitstamp: USDC/EUR (candle-grade; stable-pair fee not verified, scored at 0 % maker).
For each: £10 / £50 / £100 a rung (through) and £100 at price, stress, £300 and £1,000, summed over the books, in the
windows of sv_sim.py; at £100 (through) the day bootstrap (random.Random(20261023), 2,000 draws, index 100) of the
summed daily P&L, the per-month P&L and the share of days positive; and OKX and Coinbase before and after 2026-09-25
(OKX's 0 % maker for EEA spot-only accounts began that day).
usage: python3 -I venues.py   -> ../results/venues.json
"""
import collections, datetime, gzip, json, os, random

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DAY = 86400000
PKG = {"coinbase_uk": ["coinbase:USDC-GBP", "coinbase:USDT-GBP", "coinbase:USDC-EUR", "coinbase:USDT-EUR"],
       "coinbase_uk_gbp_only": ["coinbase:USDC-GBP", "coinbase:USDT-GBP"],
       "coinbase_eea": ["coinbase:USDC-EUR"],
       "okx_eea": ["okx:USDC-EUR", "okx:USDG-EUR"], "okx_usdg_eur": ["okx:USDG-EUR"],
       "kraken_usdg_usd": ["kraken:USDGUSD"], "kraken_usde_eur": ["kraken:USDEEUR"],
       "bitstamp_usdc_eur": ["bitstamp:usdceur"]}
ARMS = ["through_10", "through_50", "through_100", "at_price_100", "stress_100", "through_300", "through_1000"]
WINS = ["y2024_q4", "y2025", "y2026_to_10-09", "last_12_months", "since_2026-08-24", "last_28_days"]


def ms(s):
    return int(datetime.datetime.fromisoformat(s).replace(tzinfo=datetime.timezone.utc).timestamp() * 1000)


def day_of(t):
    return datetime.datetime.fromtimestamp(t / 1000, datetime.timezone.utc).strftime("%Y-%m-%d")


def main():
    R = json.load(open(os.path.join(ROOT, "results", "sv.json")))
    with gzip.open(os.path.join(ROOT, "results", "trips_100.json.gz"), "rt") as f:
        T = json.load(f)
    END = ms("2026-10-09T00:00")
    out = {}
    for name, books in PKG.items():
        V = {"books": books, "arms": {}}
        for a in ARMS:
            V["arms"][a] = {}
            for w in WINS:
                xs = [R["books"][b]["arms"][a]["windows"][w] for b in books]
                pnl = sum(x["pnl_gbp"] for x in xs)
                days = max(x["days"] for x in xs)
                V["arms"][a][w] = {"pnl_gbp": round(pnl, 2), "gbp_per_year": round(pnl / days * 365, 2) if days > 0 else None,
                                   "trips": sum(x["trips"] for x in xs), "stops": sum(x["stops"] for x in xs),
                                   "fill_gbp_per_day": round(sum(x["fill_gbp_per_day"] or 0 for x in xs), 2)}
        V["capital_gbp_at_100"] = 600 * len(books)
        V["volume_gbp_per_day_last_12_months"] = round(sum(R["books"][b]["volume_gbp_per_day"]["last_12_months"] or 0 for b in books))
        trips = [x for b in books for x in T[b]]
        d = collections.Counter()
        for x in trips:
            d[day_of(x[0])] += x[2]
        a12 = ms("2025-10-09T00:00")
        D = [day_of(t) for t in range(a12, END, DAY)]
        v = [d.get(k, 0.0) for k in D]
        rng = random.Random(20261023)
        s = sorted(sum(rng.choice(v) for _ in range(len(v))) for _ in range(2000))
        V["bootstrap_last_12_months_100"] = {"sum_gbp": round(sum(v), 2), "index100_gbp_per_year": round(s[100] / len(v) * 365, 2),
                                             "share_draws_gt_0": round(sum(1 for x in s if x > 0) / 2000, 4),
                                             "days_positive": sum(1 for x in v if x > 0), "days_negative": sum(1 for x in v if x < 0),
                                             "best_day_share": round(max(v) / sum(v), 4) if sum(v) > 0 else None}
        m = collections.Counter()
        for x in trips:
            m[day_of(x[0])[:7]] += x[2]
        V["by_month_100"] = {k: round(m[k], 2) for k in sorted(m)}
        c = ms("2026-09-25T08:00")
        pre = [x for x in trips if ms("2026-08-24T00:00") <= x[0] < c]
        post = [x for x in trips if x[0] >= c]
        V["around_2026-09-25_100"] = {"08-24_to_09-25_gbp_per_year": round(sum(x[2] for x in pre) / ((c - ms("2026-08-24T00:00")) / DAY) * 365, 2),
                                      "from_09-25_gbp_per_year": round(sum(x[2] for x in post) / ((END - c) / DAY) * 365, 2),
                                      "from_09-25_trips": len(post)}
        out[name] = V
        a = V["arms"]
        print(f"{name:22s} 12m £10/50/100: {a['through_10']['last_12_months']['pnl_gbp']}/{a['through_50']['last_12_months']['pnl_gbp']}/{a['through_100']['last_12_months']['pnl_gbp']} "
              f"28d/yr £100 {a['through_100']['last_28_days']['gbp_per_year']} boot {V['bootstrap_last_12_months_100']['index100_gbp_per_year']} "
              f"£1000 12m {a['through_1000']['last_12_months']['pnl_gbp']} 28d/yr {a['through_1000']['last_28_days']['gbp_per_year']} around0925 {V['around_2026-09-25_100']}")
    json.dump(out, open(os.path.join(ROOT, "results", "venues.json"), "w"), indent=1, sort_keys=True)


if __name__ == "__main__":
    main()
