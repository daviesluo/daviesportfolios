"""Print the review's tables from fastx.json, so no number in the review is retyped.
usage: fastx_tables.py fastx.json [--doc]      (--doc adds the four tables as the review lays them out)"""
import json, sys

O = json.load(open(sys.argv[1]))
R = O["runs"]
XS = ["DUK_M60/5s", "DUK_M60/1s", "DUK_B15", "DUK_B5", "DUK_B1", "DUK_T1000", "DUK_T250"]
LBL = {"DUK_M60/5s": "minute bar +5 s (today)", "DUK_M60/1s": "minute bar +1 s", "DUK_B15": "15 s bars +1 s", "DUK_B5": "5 s bars +1 s",
       "DUK_B1": "1 s bars +1 s", "DUK_T1000": "tick, 1 s old", "DUK_T250": "tick, 0.25 s old", "EXN_M60/5s": "Exness minute +5 s (study)",
       "YAH_M60/5s": "Yahoo minute +5 s (study)"}


def NF(x):
    return ("EXN_M60/5s", "YAH_M60/5s") if x == "STUDY" else (x, x)


LBL["STUDY"] = "study's minute +5 s (Exness / Yahoo)"


def keys_of(s):
    return {k: v for k, v in s["orders"].items() if k != "all"}


def post_stats(s):
    k = keys_of(s)
    if not k:
        return 0, 0, 0, 0
    return (max(v["mean"] for v in k.values()), max(v["max"] for v in k.values()), max(v["max_posts_one_second"] for v in k.values()),
            sum(v["days_over_600"] for v in k.values()))


def kn(s, field="keys_needed"):
    v = s.get(field) or {}
    if not v:
        return "-"
    if any(x["keys"] is None for x in v.values()):
        return "never"
    return str(sum(x["keys"] for x in v.values()))


def money(x):
    return f"${x:.3f}"


def row_main(span, x, w):
    g, u = R[f"{span}|{x}|rec/4"], R[f"{span}|{x}|rec/ungov"]
    a = g[w]
    m, mx, sec, d600 = post_stats(g)
    st = a["stale"]
    r6 = g["reach_600"]
    return (f"| {LBL[x]} | {money(a['usd_per_day'])}, {a['pct_per_year']} % | {a['trips']} | {round(100 * (a['win_rate'] or 0), 1)} % | {a['taker_exits']} "
            f"| {m:.0f} / {mx} | {sec} | {d600} ({r6['median'] or '-'}) | {st['stale_fills']} (${st['stale_fill_pnl_usd']:.2f}) | {st['mean_edge_at_fill_bps']} / {st['mean_shortfall_vs_rung_bps']} "
            f"| {money(u[w]['usd_per_day'])}, {u[w]['pct_per_year']} % | {kn(u)} |")


print("## Q1 main table: 28 days (IS / OOS in the JSON)\n")
print("| X | 4 keys, governed: $/day, %/yr | trips | won | taker exits | POSTs a key a day, mean / max | busiest second | key-days at 600 (median time) | stale fills ($) | edge at fill / short of the rung, bps | no governor: $/day, %/yr | keys never to reach 600 |")
print("|---|---|---|---|---|---|---|---|---|---|---|---|")
for x in ["EXN_M60/5s"] + XS:
    print(row_main("N", x, "N28"))
print("\n## Q1: fresh days\n")
print("| X | 4 keys, governed: $/day, %/yr | trips | won | taker exits | POSTs a key a day, mean / max | busiest second | key-days at 600 (median time) | stale fills ($) | edge at fill / short of the rung, bps | no governor: $/day, %/yr | keys never to reach 600 |")
print("|---|---|---|---|---|---|---|---|---|---|---|---|")
for x in ["YAH_M60/5s"] + XS:
    print(row_main("F", x, "FRESH"))

print("\n## IS / OOS, 4 keys governed and no governor\n")
print("| X | IS 4 keys | OOS 4 keys | IS no gov | OOS no gov |")
print("|---|---|---|---|---|")
for x in ["EXN_M60/5s"] + XS:
    g, u = R[f"N|{x}|rec/4"], R[f"N|{x}|rec/ungov"]
    print(f"| {LBL[x]} | {money(g['IS']['usd_per_day'])} | {money(g['OOS']['usd_per_day'])} | {money(u['IS']['usd_per_day'])} | {money(u['OOS']['usd_per_day'])} |")

print("\n## paired by day against the minute bar +5 s (same source), 28 days\n")
print("| X | 4 keys: mean $/day, 7-day block 95 % | no governor | frozen set, 1 key |")
print("|---|---|---|---|")
for x in XS[1:]:
    cells = []
    for arm in ("rec/4", "rec/ungov", "frozen/1"):
        p = O["paired_vs_minute_bar"][f"N|{x}|{arm}"]
        b = p["bootstrap_7d"]
        cells.append(f"{p['mean_usd_per_day']:+.3f} ({b['ci95'][0]:+.3f} to {b['ci95'][1]:+.3f}), better {p['better_days']} / worse {p['worse_days']}")
    print(f"| {LBL[x]} | " + " | ".join(cells) + " |")

print("\n## Q2 keys: $/day (28 days | fresh), key-days reaching 600, busiest second per key\n")
print("| X | 4 keys | 8 keys | 16 keys | no governor | busiest second a key (4 / 8 / 16) |")
print("|---|---|---|---|---|---|")
for x in ["STUDY"] + XS:
    cells, secs = [], []
    nx, fx = NF(x)
    for arm in ("rec/4", "rec/8", "rec/16", "rec/ungov"):
        n, f = R[f"N|{nx}|{arm}"], R[f"F|{fx}|{arm}"]
        d = n["reach_600"]["key_days"] + f["reach_600"]["key_days"]
        cells.append(f"{money(n['N28']['usd_per_day'])} / {money(f['FRESH']['usd_per_day'])}" + (f", {d} key-days at 600" if arm != "rec/ungov" else ""))
        if arm != "rec/ungov":
            secs.append(str(max(post_stats(n)[2], post_stats(f)[2])))
    print(f"| {LBL[x]} | " + " | ".join(cells) + f" | {' / '.join(secs)} |")

print("\n## Q2 re-price rules (no governor): $/day 28 days | fresh; POSTs a key a day mean / max; keys never to reach 600 (28 days | fresh); 4 keys governed $/day 28 days | fresh\n")
print("| X | rule | no governor $/day | POSTs a key a day | keys needed | 4 keys governed |")
print("|---|---|---|---|---|---|")
for x in ["STUDY"] + XS:
    nx, fx = NF(x)
    for rn, sfx in (("0.03 %", ""), ("D", "/D"), ("A", "/A"), ("DA", "/DA")):
        un, uf = R[f"N|{nx}|rec/ungov{sfx}"], R[f"F|{fx}|rec/ungov{sfx}"]
        gn, gf = R[f"N|{nx}|rec/4{sfx}"], R[f"F|{fx}|rec/4{sfx}"]
        m, mx, _, _ = post_stats(un)
        mf, mxf, _, _ = post_stats(uf)
        print(f"| {LBL[x]} | {rn} | {money(un['N28']['usd_per_day'])} / {money(uf['FRESH']['usd_per_day'])} | {m:.0f} / {mx} (fresh {mf:.0f} / {mxf}) "
              f"| {kn(un)} / {kn(uf)} | {money(gn['N28']['usd_per_day'])} / {money(gf['FRESH']['usd_per_day'])} |")

print("\n## frozen set {0.1, 0.2, 0.3} at 0.05 %, one key, 1 s turns\n")
print("| X | 28 days, governed | fresh, governed | 28 days, no governor | POSTs a day mean / max | stale fills 28 days |")
print("|---|---|---|---|---|---|")
for x in ["EXN_M60/5s"] + XS:
    g = R[f"N|{x}|frozen/1"]
    fx = "YAH_M60/5s" if x == "EXN_M60/5s" else x
    f = R[f"F|{fx}|frozen/1"]
    u = R[f"N|{x}|frozen/ungov"]
    m, mx, _, _ = post_stats(g)
    print(f"| {LBL[x]} | {money(g['N28']['usd_per_day'])}, {g['N28']['pct_per_year']} % | {money(f['FRESH']['usd_per_day'])} | {money(u['N28']['usd_per_day'])} | {m:.0f} / {mx} | {g['N28']['stale']['stale_fills']} (${g['N28']['stale']['stale_fill_pnl_usd']:.2f}) |")

print("\n## PR5V reference timing (a turn a minute)\n")
for x, fx in (("EXN_M60/0", "YAH_M60/0"), ("DUK_M60/0", "DUK_M60/0")):
    for arm in ("rec/ref", "frozen/ref/per_rung"):
        n, f = R[f"N|{x}|{arm}"], R[f"F|{fx}|{arm}"]
        print(f"| {x} | {arm} | {money(n['IS']['usd_per_day'])} | {money(n['OOS']['usd_per_day'])} | {money(n['N28']['usd_per_day'])}, {n['N28']['pct_per_year']} % | {money(f['FRESH']['usd_per_day'])} |")

print("\n## Q3 ceiling\n")
for span in ("N", "F"):
    c = O["ceiling"][span]
    print(span, json.dumps(c["both"]))
    for b in ("USDC-GBP", "USDT-GBP"):
        print("   ", b, json.dumps(c[b]))
print("\n## best\n")
b = O["best"]
print(json.dumps(b["pick"]), json.dumps(b["split"]))
for span, w in (("N", "IS"), ("N", "OOS"), ("N", "N28"), ("F", "FRESH")):
    s = b[span][w]
    print(span, w, s["trips"], money(s["usd_per_day"]), s["pct_per_year"], "stale", s["stale"]["stale_fills"])
print("N key-days at 600", b["N"]["key_days_reaching_600"], "F", b["F"]["key_days_reaching_600"])
print("candidates top 10 by IS:")
for c in sorted(b["candidates"], key=lambda z: -z["IS_usd_per_day"])[:12]:
    print("   ", c)

print("\n## Q4 live sources (each window)\n")
L = O.get("live_sources")
if L:
    for w in L["windows"]:
        print(w["log"], w.get("window_utc"), "dukascopy", w.get("dukascopy"), "missing", w.get("dukascopy_hours_missing"))
        print("| source | changes a minute | median s between changes | age on arrival ms (median / p90) | request ms | vs Dukascopy: offset bps, lag ms, |dev| bps at lag | vs TrueFX lag ms | failures |")
        print("|---|---|---|---|---|---|---|---|")
        for s, v in w["sources"].items():
            d = v.get("vs_dukascopy") or {}
            tfx = v.get("vs_truefx") or {}
            age = f"{v.get('age_at_arrival_ms_median', '-')} / {v.get('age_at_arrival_ms_p90', '-')}"
            print(f"| {s} | {v.get('changes_per_minute')} | {v.get('median_s_between_changes')} | {age} | {v.get('request_ms_median', '-')} "
                  f"| {d.get('offset_bps_median')}, {d.get('lag_ms_best')}, {d.get('abs_dev_bps_median_at_best_lag')} | {tfx.get('lag_ms_best')} | {v.get('failures')} |")

# ---------------------------------------------------------------------------------------------- the review's tables
if "--doc" in sys.argv:
    def pct(s):
        return f"{s['pct_per_year']:.1f} %"

    def ci(p):
        b = p.get("bootstrap_7d")
        return f"{p['mean_usd_per_day']:+.3f}" + (f" ({b['ci95'][0]:+.3f} to {b['ci95'][1]:+.3f})" if b else "")

    print("\n\nDOC TABLE 1\n")
    print("| X | 4 keys: 28 days | IS / OOS | fresh | no governor: 28 days | fresh | paired against the minute bar, 4 keys | no governor |")
    print("|---|---|---|---|---|---|---|---|")
    for x in ["STUDY"] + XS:
        nx, fx = NF(x)
        g, gf, u, uf = R[f"N|{nx}|rec/4"], R[f"F|{fx}|rec/4"], R[f"N|{nx}|rec/ungov"], R[f"F|{fx}|rec/ungov"]
        if x in XS[1:]:
            p1, p2 = ci(O["paired_vs_minute_bar"][f"N|{x}|rec/4"]), ci(O["paired_vs_minute_bar"][f"N|{x}|rec/ungov"])
        else:
            p1 = p2 = "-"
        print(f"| {LBL[x]} | {money(g['N28']['usd_per_day'])}, {pct(g['N28'])} | {money(g['IS']['usd_per_day'])} / {money(g['OOS']['usd_per_day'])} "
              f"| {money(gf['FRESH']['usd_per_day'])} | {money(u['N28']['usd_per_day'])}, {pct(u['N28'])} | {money(uf['FRESH']['usd_per_day'])} | {p1} | {p2} |")
    print("\n\nDOC TABLE 2\n")
    print("| X | trips, won, taker exits | POSTs a key a day, mean / max | key-days at 600 (median time) | fresh: key-days at 600 (median time) | busiest second | keys never to reach 600: 28 days / fresh | stale fills (their P&L) | edge at fill / short of the rung, bps |")
    print("|---|---|---|---|---|---|---|---|---|")
    for x in ["STUDY"] + XS:
        nx, fx = NF(x)
        g, gf, u, uf = R[f"N|{nx}|rec/4"], R[f"F|{fx}|rec/4"], R[f"N|{nx}|rec/ungov"], R[f"F|{fx}|rec/ungov"]
        a = g["N28"]
        m, mx, sec, d6 = post_stats(g)
        _, _, secf, d6f = post_stats(gf)
        st = a["stale"]
        print(f"| {LBL[x]} | {a['trips']}, {100 * a['win_rate']:.1f} %, {a['taker_exits']} | {m:.0f} / {mx} | {g['reach_600']['key_days']} ({g['reach_600']['median'] or '-'}) "
              f"| {gf['reach_600']['key_days']} ({gf['reach_600']['median'] or '-'}) | {max(sec, secf)} | {kn(u)} / {kn(uf)} | {st['stale_fills']} (${st['stale_fill_pnl_usd']:+.2f}) "
              f"| {st['mean_edge_at_fill_bps']:.2f} / {st['mean_shortfall_vs_rung_bps']:+.2f} |")
    print("\n\nDOC TABLE 3 (keys)\n")
    print("| X | 4 keys | 8 keys | 16 keys | 8 keys against 4, by day (28 days) | key-days at 600: 4 / 8 / 16 keys (28 days + fresh) |")
    print("|---|---|---|---|---|---|")
    for x in ["STUDY"] + XS:
        nx, fx = NF(x)
        cells, kd = [], []
        for arm in ("rec/4", "rec/8", "rec/16"):
            n, f = R[f"N|{nx}|{arm}"], R[f"F|{fx}|{arm}"]
            cells.append(f"{money(n['N28']['usd_per_day'])} / {money(f['FRESH']['usd_per_day'])}")
            kd.append(str(n["reach_600"]["key_days"] + f["reach_600"]["key_days"]))
        p = O["paired_arms"][f"N|{nx}|rec/8 - rec/4"]
        print(f"| {LBL[x]} | " + " | ".join(cells) + f" | {ci(p)} | {' / '.join(kd)} |")
    print("\n\nDOC TABLE 4 (rules)\n")
    print("| X | rule | POSTs a key a day, mean / max (28 days) | keys never to reach 600: 28 days / fresh | no governor: 28 days / fresh | 4 keys: 28 days / fresh | 4 keys, against 0.03 % by day (28 days) |")
    print("|---|---|---|---|---|---|---|")
    for x in ["STUDY", "DUK_M60/5s", "DUK_B15", "DUK_B1", "DUK_T250"]:
        nx, fx = NF(x)
        for rn, sfx in (("0.03 %", ""), ("D", "/D"), ("A", "/A"), ("DA", "/DA")):
            un, uf = R[f"N|{nx}|rec/ungov{sfx}"], R[f"F|{fx}|rec/ungov{sfx}"]
            gn, gf = R[f"N|{nx}|rec/4{sfx}"], R[f"F|{fx}|rec/4{sfx}"]
            m, mx, _, _ = post_stats(un)
            pc = ci(O["paired_arms"][f"N|{nx}|rec/4{sfx} - rec/4"]) if sfx else "-"
            print(f"| {LBL[x]} | {rn} | {m:.0f} / {mx} | {kn(un)} / {kn(uf)} | {money(un['N28']['usd_per_day'])} / {money(uf['FRESH']['usd_per_day'])} "
                  f"| {money(gn['N28']['usd_per_day'])} / {money(gf['FRESH']['usd_per_day'])} | {pc} |")
