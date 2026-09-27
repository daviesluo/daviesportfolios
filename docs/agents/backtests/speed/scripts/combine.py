"""SPEED step 4: each architecture's reaction time after the fastest keyless source publishes, and what the
exploration month's own edge curves leave at that instant.

An architecture is a set of equally likely delays after the source makes the item public: the poll's phase (uniform
over its cadence), the dispatch (pg_cron → pg_net → Edge: 0.19 s at the median, ~2 s one time in ten, from the
project's own logs), the read (0.2 s on a fresh connection, 0.1 s kept alive), the order (Polymarket's CLOB answers the
Irish Edge in 30 ms, reference §6), and for a Cloudflare object the hop to the Irish Edge that must place it.

Temperature: the source is tgftp.nws.noaa.gov, whose station file was written a few seconds BEFORE AWC's receipt of
the same report on most reports polled live (`source_latency.json`); September's curves are indexed by AWC's receipt,
so each action instant is AWC's receipt + (tgftp's lead, drawn from the live reports) + the architecture's delay.
Post counts: the source is the tracker itself (`xtracker_latency.json`: when its API showed a capture), indexed by the
capture. Money is USLATE's fill model (half of each stale print from that instant, $100 a bucket, the market's fee),
per day of the exploration sample; traps (the market resolved against the source) are costed separately.

usage: combine.py <results dir> <out json>
"""
import bisect
import json
import os
import sys

ORDER_S = 0.03                  # Polymarket CLOB round trip from the Irish Edge (reference §6: 30 ms)
READ_FRESH_S, READ_WARM_S = 0.2, 0.1
DISPATCH = [0.19] * 9 + [2.0]   # pg_cron → pg_net → Edge start: p50 0.19 s, p90 1.65–2.47 s (infra.json)
EDGE_HOP_S = 0.2                # a Cloudflare object calling the Irish Edge function to place the order


def phases(cadence, n=10):
    return [cadence * (k + 0.5) / n for k in range(n)]


ARCH = {
    "a job a minute (today's cadence)": [p + 0.19 + READ_FRESH_S + ORDER_S for p in phases(60, 60)],
    "pg_cron every 1 s → Edge": [p + d + READ_FRESH_S + ORDER_S for p in phases(1) for d in DISPATCH],
    "one Edge call a minute, polling every 1 s inside it": [p + READ_WARM_S + ORDER_S for p in phases(1)],
    "Cloudflare Durable Object, polling every 0.5 s, ordering through the Irish Edge":
        [p + READ_WARM_S + EDGE_HOP_S + ORDER_S for p in phases(0.5)],
}


def med(xs):
    """The median as every other file of this study takes it (the element at index n // 2 of the sorted list)."""
    xs = sorted(xs)
    return xs[len(xs) // 2]


def interp(xs, ys, x):
    if x <= xs[0]:
        return ys[0]
    if x >= xs[-1]:
        return ys[-1]
    i = bisect.bisect_right(xs, x)
    x0, x1, y0, y1 = xs[i - 1], xs[i], ys[i - 1], ys[i]
    return y0 + (y1 - y0) * (x - x0) / (x1 - x0)


def expect(xs, ys, deltas):
    return sum(interp(xs, ys, d) for d in deltas) / len(deltas)


def load(res, name):
    with open(os.path.join(res, name)) as f:
        return json.load(f)


def main():
    res, outp = sys.argv[1], sys.argv[2]
    E = load(res, "edge_vs_latency.json")
    K = load(res, "count_edge_vs_latency.json")
    S = load(res, "source_latency.json")
    X = load(res, "xtracker_latency.json")
    days = E["days"]
    out = {"assumptions": {"order_s": ORDER_S, "read_fresh_s": READ_FRESH_S, "read_warm_s": READ_WARM_S,
                           "dispatch_samples_s": DISPATCH, "edge_hop_s": EDGE_HOP_S,
                           "architecture_delay_after_publication_s": {
                               a: {"p50": round(med(v), 2), "p90": round(sorted(v)[int(0.9 * len(v))], 2), "max": round(max(v), 2)}
                               for a, v in ARCH.items()}},
           "temperature": {}, "post_counts": {}}
    # ---------------------------------------------------------------- temperature (PMLATE)
    # US trap cost from the basis rate the pre-registration disclosed: 9 US market-days in 2,256 where a bucket the
    # reports had ruled out won; September's US market-days a day; a trap bucket's loss under the fill model is
    # September's non-US average.
    trap_rc = E["groups"]["non-US:trap"]
    trap_loss_per_bucket = -interp(trap_rc["rc_grid_s"], trap_rc["rc_curve_uslate_pnl_usd"], 0) / trap_rc["bucket_deaths"]
    us_trap_per_day = (550 / days) * (9 / 2256) * trap_loss_per_bucket
    for reg in ("US", "non-US"):
        leads = S["samples_tgftp_written_minus_receipt_s"][reg]
        after_obs = S["samples_tgftp_written_after_obs_s"][reg]
        row = {"tgftp_written_minus_awc_receipt_s": {"n": len(leads), "p50": med(leads)},
               "tgftp_written_after_obs_s_p50": med(after_obs), "architectures": {}}
        cases = dict(ARCH)
        cases = {"the instant tgftp writes the file (ceiling for any keyless loop)": [0.0], **cases}
        for a, dl in cases.items():
            deltas = [l + d for l in leads for d in dl]
            r = {"reaction_after_obs_s_p50": round(med(after_obs) + med(dl), 1)}
            usd_day = 0.0
            for cls in ("informative_held", "other_held"):
                g = E["groups"][f"{reg}:{cls}"]
                pnl = expect(g["rc_grid_s"], g["rc_curve_uslate_pnl_usd"], deltas)
                edge = expect(g["rc_grid_s"], g["rc_curve_net_edge_usd"], deltas)
                r[cls] = {"share_of_post_obs_edge_left": round(edge / g["post_obs_net_edge_usd"], 4),
                          "uslate_usd": round(pnl, 2), "uslate_usd_per_day": round(pnl / days, 2)}
                usd_day += pnl / days
            if reg == "non-US":
                tr = expect(trap_rc["rc_grid_s"], trap_rc["rc_curve_uslate_pnl_usd"], deltas) / days
                r["traps_usd_per_day"] = round(tr, 2)
            else:
                tr = -us_trap_per_day
                r["traps_usd_per_day_expected"] = round(tr, 2)
            r["held_usd_per_day"] = round(usd_day, 2)
            r["net_usd_per_day"] = round(usd_day + tr, 2)
            row["architectures"][a] = r
        # how much of the one-second figure rests on tgftp's rare long leads over AWC (a report AWC received minutes
        # after NOAA published it): the same architecture with those leads dropped, and with no lead at all
        a1 = ARCH["pg_cron every 1 s → Edge"]
        sens = {}
        for name, ls in (("leads of more than 60 s dropped", [l for l in leads if l >= -60]), ("at AWC's receipt (no lead)", [0.0])):
            deltas = [l + d for l in ls for d in a1]
            tot = 0.0
            for cls in ("informative_held", "other_held"):
                g = E["groups"][f"{reg}:{cls}"]
                tot += expect(g["rc_grid_s"], g["rc_curve_uslate_pnl_usd"], deltas) / days
            sens[name] = {"reports": len(ls), "held_usd_per_day": round(tot, 2)}
        row["one_second_sensitivity"] = sens
        # what a source ahead of publication would be worth (none is keyless): the informed pace, obs + 30 s
        for L in ("30", "60"):
            v = {}
            for cls in ("informative_held", "other_held"):
                t = E["groups"][f"{reg}:{cls}"]["after_obs"][L]
                v[cls] = {"share_left": t["share"], "uslate_usd_per_day": round(t["uslate_fill_pnl_usd"] / days, 2)}
            row[f"a source at obs + {L} s (not keyless)"] = v
        out["temperature"][reg] = row
    out["temperature"]["us_trap_cost"] = {"rate": "9 of 2,256 US market-days (the USLATE pre-registration's basis count)",
                                          "market_days_a_day": round(550 / days, 1),
                                          "loss_per_trap_bucket_usd": round(trap_loss_per_bucket, 2),
                                          "usd_per_day": round(us_trap_per_day, 2)}
    # ---------------------------------------------------------------- post counts
    # the live poll saw no new post in its 75 minutes (a Saturday night in the US); the tracker's API answers
    # `cache-control: max-age=0, must-revalidate` from Vercel with a cache MISS, so a capture is taken as readable the
    # moment it is made, and the tracker's own batch clock (`tracker_cadence.json`) is what bounds a reaction
    vis = X.get("samples_api_visible_after_capture_s") or [0.0]
    for fam in ("smaller", "elon"):
        row = {"api_visible_after_capture_s": {"n": len(X.get("samples_api_visible_after_capture_s") or []),
                                               "p50": med(vis),
                                               "assumed_zero_no_live_sample": not X.get("samples_api_visible_after_capture_s")},
               "architectures": {}}
        cases = {"the instant the tracker shows the capture (ceiling for any keyless loop)": [0.0], **ARCH}
        for a, dl in cases.items():
            deltas = [v + d for v in vis for d in dl]
            r, usd_day = {}, 0.0
            for cls in ("informative_held", "other_held"):
                g = K["groups"].get(f"{fam}:{cls}")
                if not g:
                    continue
                tab = g["after_capture"]
                xs = sorted(int(k) for k in tab)
                pnl = expect(xs, [tab[str(x)]["uslate_fill_pnl_usd"] for x in xs], deltas)
                edge = expect(xs, [tab[str(x)]["net_edge_usd"] for x in xs], deltas)
                r[cls] = {"share_of_post_post_edge_left": round(edge / g["post_post_net_edge_usd"], 4) if g["post_post_net_edge_usd"] else None,
                          "uslate_usd": round(pnl, 2), "uslate_usd_per_day": round(pnl / g["span_days"], 3)}
                usd_day += pnl / g["span_days"]
            r["held_usd_per_day"] = round(usd_day, 3)
            row["architectures"][a] = r
        for L in ("5", "30"):
            v = {}
            for cls in ("informative_held", "other_held"):
                g = K["groups"].get(f"{fam}:{cls}")
                if g:
                    t = g["after_post"][L]
                    v[cls] = {"share_left": t["share"], "uslate_usd_per_day": round(t["uslate_fill_pnl_usd"] / g["span_days"], 3)}
            row[f"a feed of the account at post + {L} s (not keyless)"] = v
        out["post_counts"][fam] = row
    with open(outp, "w") as f:
        json.dump(out, f, indent=1, sort_keys=True)
        f.write("\n")
    for reg, row in out["temperature"].items():
        if reg == "us_trap_cost":
            print("US trap cost", row)
            continue
        print(f"== temperature {reg}: tgftp − AWC receipt p50 {row['tgftp_written_minus_awc_receipt_s']['p50']:.1f} s, "
              f"tgftp after obs p50 {row['tgftp_written_after_obs_s_p50']:.0f} s")
        for a, r in row["architectures"].items():
            print(f"   {a[:62]:62s} obs+{r['reaction_after_obs_s_p50']:6.1f}s  inf share {r['informative_held']['share_of_post_obs_edge_left']:.3f}"
                  f"  held ${r['held_usd_per_day']:6.2f}/d  traps ${r.get('traps_usd_per_day', r.get('traps_usd_per_day_expected')):7.2f}/d  net ${r['net_usd_per_day']:7.2f}/d")
    for fam, row in out["post_counts"].items():
        print(f"== post counts {fam}: tracker API visible after capture p50 {row['api_visible_after_capture_s']['p50']:.1f} s")
        for a, r in row["architectures"].items():
            inf = r.get("informative_held", {})
            print(f"   {a[:62]:62s} inf share {inf.get('share_of_post_post_edge_left')}  held ${r['held_usd_per_day']:.3f}/d")


if __name__ == "__main__":
    main()
