# MMCOMP part 4: the GBP 0.10 prints on Revolut X's USDT-GBP (from 2026-10-08), against every other print, from the committed
# tape and book snapshots (to 2026-10-29 00:00 UTC):
#   size     the print's value in GBP and its coin quantity
#   timing   seconds between consecutive bot prints: quantiles, the coefficient of variation, the share within 5 % of the mode
#   side     buy / sell counts and how often a bot print takes the other side from the bot print before it
#   touch    where it printed against the last book snapshot within 90 s before it: at the best ask (a buy) / best bid (a sell),
#            inside, or through
#   fair     the print against fair (PR5's fairU / GBP/USD), bps, signed so positive = the aggressor paid up
#   markout  how fair and the book's mid moved 1, 5 and 30 minutes after, in the aggressor's favour (bps; + = the aggressor
#            was right, i.e. informed / toxic to the maker it hit), for bot prints, other prints of GBP 1+, and every minute
#            as a baseline
# python3 -I docs/agents/backtests/mmcomp/scripts/bot.py   -> results/bot.json
import bisect, collections, datetime, json, math, os, statistics, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.dont_write_bytecode = True
import load as L

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "results", "bot.json")
START = 1791417600000  # 2026-10-08 00:00 UTC
END = 1793232000000    # 2026-10-29 00:00 UTC
BK = "USDT-GBP"
fx = L.gbpusd()
usd = L.usd(BK)


def fair(t):
    x, u = fx.at(t), usd.at(t)
    return u / x if x and u else None


ps = [p for p in L.prints(BK) if START <= p[0] < END]
isbot = lambda p: 0.095 <= p[1] * p[2] <= 0.105
bot = [p for p in ps if isbot(p)]
other = [p for p in ps if not isbot(p) and p[1] * p[2] >= 1]
snaps = L.book(BK)
st = [s[0] for s in snaps]
mid = L.Series([(t, (b[0][0] + a[0][0]) / 2) for t, b, a in snaps if b and a], max_age=30 * 60_000)


def snap_before(t, within=90_000):
    i = bisect.bisect_right(st, t) - 1
    return snaps[i] if i >= 0 and t - snaps[i][0] <= within else None


res = {"window": "2026-10-08 -> 2026-10-29 00:00 UTC", "bot_prints": len(bot), "other_prints_ge1": len(other)}
# size
gbp = [p[1] * p[2] for p in bot]
res["size_gbp"] = {"min": round(min(gbp), 5), "median": round(L.median(gbp), 5), "max": round(max(gbp), 5)}
res["size_coins"] = collections.Counter(round(p[2], 5) for p in bot).most_common(5)
# per day and per hour of day
res["per_day"] = dict(sorted(collections.Counter(L.day(p[0]) for p in bot).items()))
res["per_utc_hour"] = dict(sorted(collections.Counter((p[0] // 3_600_000) % 24 for p in bot).items()))
# timing
gaps = [(b[0] - a[0]) / 1000 for a, b in zip(bot, bot[1:]) if b[0] - a[0] < 3_600_000]
mode = collections.Counter(round(g) for g in gaps).most_common(3)
res["gap_s"] = {"n": len(gaps), "p10": round(L.q(gaps, .1), 1), "p25": round(L.q(gaps, .25), 1), "median": round(L.median(gaps), 1),
                "p75": round(L.q(gaps, .75), 1), "p90": round(L.q(gaps, .9), 1), "mean": round(statistics.mean(gaps), 1),
                "cv": round(statistics.pstdev(gaps) / statistics.mean(gaps), 2), "mode_s": mode,
                "second_of_minute_top": collections.Counter(int(p[0] / 1000) % 60 for p in bot).most_common(5)}
# side
sides = collections.Counter(p[3] for p in bot)
alt = sum(1 for a, b in zip(bot, bot[1:]) if a[3] != b[3])
res["side"] = {"buy": sides["buy"], "sell": sides["sell"], "alternates": round(alt / (len(bot) - 1), 3)}
# against the touch
where = collections.Counter()
for t, px, q, side, _ in bot:
    s = snap_before(t)
    if not s or not s[1] or not s[2]:
        where["no snapshot"] += 1
        continue
    bb, ba = s[1][0][0], s[2][0][0]
    if side == "buy":
        where["buy at best ask" if abs(px - ba) < 1e-9 else "buy inside" if px < ba else "buy through"] += 1
    else:
        where["sell at best bid" if abs(px - bb) < 1e-9 else "sell inside" if px > bb else "sell through"] += 1
res["vs_last_snapshot"] = dict(where)


def signed_dev(p):
    f = fair(p[0])
    if not f:
        return None
    d = L.bps(p[1], f)
    return d if p[3] == "buy" else -d     # + = paid up over fair


def markouts(rows, ser, horizons=(1, 5, 30)):
    out = {}
    for h in horizons:
        xs = []
        for t, px, q, side, _ in rows:
            a, b = ser(t), ser(t + h * 60_000)
            if a and b:
                m = L.bps(b, a)
                xs.append(m if side == "buy" else -m)
        out[f"{h}m"] = {"n": len(xs), "mean": round(statistics.mean(xs), 3) if xs else None, "median": round(L.median(xs), 3) if xs else None,
                        "se": round(statistics.pstdev(xs) / math.sqrt(len(xs)), 3) if len(xs) > 1 else None}
    return out


res["paid_vs_fair_bps"] = {"bot_median": round(L.median([d for d in map(signed_dev, bot) if d is not None]), 2),
                           "other_median": round(L.median([d for d in map(signed_dev, other) if d is not None]), 2)}
# markout: on fair and on the book's mid; baseline = a 'buy' at every minute (mean ~ drift)
base = [(t, 0, 0, "buy", "") for t in range(START, END, 60_000)]
res["markout_fair"] = {"bot": markouts(bot, fair), "other": markouts(other, fair), "every_minute_up": markouts(base, fair)}
res["markout_mid"] = {"bot": markouts(bot, mid.at), "other": markouts(other, mid.at), "every_minute_up": markouts(base, mid.at)}
# does the bot trade when the touch is tight? spread at its prints vs the time-weighted day
sp_bot = []
for p in bot:
    s = snap_before(p[0])
    if s and s[1] and s[2]:
        sp_bot.append(round((s[2][0][0] - s[1][0][0]) / L.TICK))
res["spread_ticks_at_bot_prints"] = {"median": L.median(sp_bot), "share_1tick": round(sum(1 for x in sp_bot if x == 1) / len(sp_bot), 3)}
# what the bot pays: spread crossed and taker fee, per day
cost = []
for p in bot:
    f = fair(p[0])
    if f:
        cost.append(p[1] * p[2] * (abs(L.bps(p[1], f)) / 1e4 + 0.0009))
res["bot_cost_gbp_per_day_est"] = round(sum(cost) / ((END - START) / L.DAY), 4)
json.dump(res, open(OUT, "w"), indent=1, sort_keys=True)
print(json.dumps(res, indent=1, sort_keys=True)[:6000])
