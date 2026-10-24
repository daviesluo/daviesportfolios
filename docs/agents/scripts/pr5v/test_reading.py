"""The reading scripts of PR5V (`reading_pr5v.py`) and rule D (`reading_ruled.py`) on synthetic data only
(`reading_fixture.py`, whose answers are worked out by hand in its docstring), before either reading. Each check that a
condition can fail is shown failing on a deliberately broken copy of the fixture. No production row is read.

    python3 -I docs/agents/scripts/pr5v/test_reading.py > docs/agents/backtests/pr5v/test_reading.txt
"""
import json, os, random, shutil, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import reading_common as C  # noqa: E402
import reading_fixture as F  # noqa: E402
import reading_pr5v as RV  # noqa: E402
import reading_ruled as RD  # noqa: E402

S = C.S
TMP = tempfile.mkdtemp(prefix="pr5v_reading_test_")
R = S.Runner()
NOW = C.READ_FROM
close = lambda a, b, tol=1e-9: abs(a - b) <= tol  # noqa: E731
n_checks = 0


def ok(cond, what):
    global n_checks
    assert cond, what
    n_checks += 1
    print("ok ", what)


def run(mod, name, **kw):
    d = os.path.join(TMP, name)
    F.write(os.path.join(d, "data"), ruled=mod is RD, **kw)
    return mod.run(os.path.join(d, "data"), os.path.join(d, "reading.json"), now_ms=NOW, R=R)


# ------------------------------------------------------------------ PR5V on the fixture
r = run(RV, "pr5v")
m = r["main"]
X = F.EXPECT
ok(r["status"] == "read" and r["reproduction"]["pass"], "PR5V: the reproduction check passes on the study's markets (563 / 29.5129, 40 / 2.5438) before any export is read")
ok(r["export_complete"]["pass"], "PR5V: the fixture's pages add up to its meta counts")
ok(r["window"]["days"] == 28 and r["window"]["w0"] == "2026-09-29T00:00:00Z" and r["window"]["w1"] == "2026-10-27T00:00:00Z", "PR5V: the window is 09-29 -> 10-26, 28 days")
c1 = m["1_faithful"]
ok(c1["engine_trips"] == 56 and c1["replay_trips"] == 56 and c1["matched"] == 56 and close(c1["pnl_engine_usd"], X["main"]["window_pnl"], 1e-6)
   and abs(c1["pnl_diff_usd"]) < 1e-9 and c1["pass"], f"condition 1: 56 of 56 trips each way, P&L {c1['pnl_engine_usd']} = 28 x (3/7997 + 4/7996) x 100")
c2 = m["2_above_null"]
ok(c2["p95"] == X["main"]["null_p95"] and c2["mean"] == X["main"]["null_p95"] and c2["pass"], f"condition 2: every draw is 56 twins at 100/7999, p95 {c2['p95']} under the window's {c2['window_pnl_usd']}")
c3 = m["3_better_than_pr5"]
ok(c3["bootstrap"]["p_le_0"] == 0.0 and c3["bootstrap"]["mean"] == X["main"]["paired_mean"] and c3["days"] == 28 and c3["pass"],
   f"condition 3: the daily difference is +{X['main']['paired_mean']} every day, p <= 0 = 0 (PR5's two $5 trips outside the window are not counted)")
c4 = m["4_stress"]
ok(close(c4["pnl_usd"], X["main"]["stress_pnl"], 1e-6) and c4["trips"] == 28 and c4["pass"], f"condition 4: stress fills only the 7997 bid, 28 trips, ${c4['pnl_usd']}")
c5 = m["5_governor"]
ok(c5["pass"] and c5["max_posts_key_day"] == X["main"]["max_posts_key_day"] and c5["detail_n_disagrees_with_recount"] == 0, "condition 5: at most 20 POSTs a key a day (USDC-GBP's bid key on 09-28), detail.n = the recount")
ok(r["verdict"]["reading"] == "PASS" and r["verdict"]["judged"], "PR5V: the fixture reads PASS")
pk = r["described"]["posts_main"]["posts_per_key_day"]
ok(all(pk[f"{k} 2026-10-01"] == n for k, n in X["main"]["posts_window"].items()) and pk["USDT-GBP/bid 2026-10-15"] == 18 and pk["USDT-GBP/ask 2026-10-15"] == 18,
   "described: POSTs a key a day 11 / 9 / 9 / 9, and 18 on USDT-GBP's keys on 10-15 (all nine re-priced on the +0.04 % move)")
top = r["described"]["posts_main"]["most_posts_one_key_one_turn"]
ok(top["posts"] == 9 and top["minute"] == "2026-09-29T10:06:00Z" and top["key"] == "USDC-GBP/ask", "described: the most POSTs at one turn, 9 (the re-placement after the dark minute)")
ok(r["print_count_differs"] == X["print_count_differs"] and r["rebuilt_minutes"]["USDC-GBP"] == X["rebuilt"], "described: the miscounted minute is listed, the rebuilt one counted")
t5 = r["described"]["top5"]["conditions_never_judged"]
ok(close(t5["1_faithful"]["pnl_engine_usd"], X["top5"]["window_pnl"], 1e-6) and t5["1_faithful"]["pass"] and t5["4_stress"]["pnl_usd"] == 0.0
   and not t5["4_stress"]["pass"] and t5["2_above_null"]["p95"] == X["top5"]["null_p95"], "top5 (never judged): 28 trips at 4/7996, its stress fills nothing, its null 0.35")
fl = r["described"]["pr5_first_live_order"]
ok(fl["applies"] and fl["before"]["days"] == 11 and fl["from"]["days"] == 17 and close(fl["before"]["arm_pnl_usd"], X["first_live"]["before_arm"], 1e-6)
   and close(fl["before"]["against_pnl_usd"], X["first_live"]["before_pr5"], 1e-6), "described: the days from PR5's first live order (10-10) apart: 11 before, 17 from")
ex = r["described"]["extra_capital"]
ok(close(ex["gain_over_pr5_usd_per_day"], X["main"]["window_pnl"] / 28 - 0.01, 1e-6) and close(ex["line_8pct_on_2400_usd_per_day"], 2400 * 0.08 / 365, 1e-6),
   "described: the gain over PR5 a day against the $0.526 line")

# the broken copies: each condition fails when what it guards is broken
r = run(RV, "pr5v_drop", drop_trips=set(range(2, 6)))            # 09-29's and 09-30's two trips missing from the engine's record
c1 = r["main"]["1_faithful"]
ok(not c1["pass"] and c1["engine_trips"] == 52 and c1["share_replay_matched"] == round(52 / 56, 6) and r["verdict"]["reading"] == "FAIL",
   "broken: 4 engine trips gone -> 52 of 56 replay trips matched (92.9 %), condition 1 fails")
extra = []
day = C.ms("2026-10-10T00:00")
for i in range(895):                                             # 895 more exit re-prices on USDC-GBP's bid key before 10:00
    k = 0.0003 if i % 2 == 0 else 0.0005
    extra.append((day + (i // 2) * C.M, f"main|USDC-GBP|{day + (i // 2) * C.M}|bid|{k!r}|order|exit_reprice|USDC-GBP/bid||0|"))
r = run(RV, "pr5v_gov", extra_events=extra)
c5 = r["main"]["5_governor"]
ok(not c5["pass"] and len(c5["violations_recount"]) == 6 and c5["violations_recount"][0][3] == 900 and c5["violations_recount"][0][1] == "2026-10-10T10:06:00Z",
   "broken: 895 POSTs before 10-10's placements -> the 4th to 9th placement at 10:06 had 900-905 before them: 6 violations, condition 5 fails")
ok(c5["detail_n_disagrees_with_recount"] > 0, "broken: the forged events' detail.n disagrees with the recount and is reported")
r = run(RV, "pr5v_counts", meta_over={"events_n": 1})
ok(r["status"].startswith("stopped: the export's pages"), "broken: an export whose pages do not add up to its counts is refused")
r = run(RV, "pr5v_gap", drop_minutes={("USDT-GBP", C.ms("2026-10-20T05:00"))})
ok(r["status"].startswith("wait:"), "a missing minute while PR5's engine decided to E: the reading waits")

# §3's end rule: PR5's record stopped at 10-20 05:00 -> D = 10-18, the window 09-29 -> 10-18 (20 days): reported, not judged
mins = {b: {mm: {} for mm in range(C.START, C.ms("2026-10-20T05:00"), C.M)} for b in C.BOOKS}
w = C.window(mins, C.ms("2026-10-20T04:59"))
ok(w["stopped"] and w["days"] == 20 and C.iso(w["w1"]) == "2026-10-19T00:00:00Z" and C.iso(w["e"]) == "2026-10-20T00:30:00Z",
   "§3: PR5's record stopping at 10-20 05:00 ends the window on 10-18 (E 10-20 00:30): 20 days, fewer than 21")

# the null with E for N1 is the study's function when E = N1, and ends no twin at N1 otherwise
mk = C.markets(C.load_prints(os.path.join(TMP, "pr5v", "data")), C.load_minutes(os.path.join(TMP, "pr5v", "data")))
tr = C.load_trips(os.path.join(TMP, "pr5v", "data"), "trips")
main_tr = [x for x in tr if x["arm"] == "main"]
a = S.null_twins(R, mk, {"reprice": 0.0003}, C.NINE, main_tr, C.W0, C.W1, draws=200)
b = C.null_twins_to(S.N1)(R, mk, {"reprice": 0.0003}, C.NINE, main_tr, C.W0, C.W1, draws=200)
ok(a == b and a["p95"] == 0.0, "the null: with E = N1 it is study.py's own (identical result); on the window every twin runs no step, p95 0")
rng = random.Random(1)
ref = R.run("N", C.NINE, reprice=0.0003, gov=C.GOV_STUDY, acct=C.ACCT4)["trips"]
sample = rng.sample(ref, 12)
a = S.null_twins(R, R.N, {"reprice": 0.0003}, C.NINE, sample, S.N0, S.N1, draws=40)
b = C.null_twins_to(S.N1)(R, R.N, {"reprice": 0.0003}, C.NINE, sample, S.N0, S.N1, draws=40)
ok(a == b, "the null: with E = N1 it equals study.py's on the study's own markets (12 trips, 40 draws)")

# ------------------------------------------------------------------ rule D on the fixture
r = run(RD, "ruled")
dv = r["deviation_check"]
ok(r["status"] == "read" and r["reproduction"]["pass"], "rule D: the reproduction check passes on the study's markets (593 / 30.3004, 60 / 3.742) before any export is read")
ok(dv["pass"] and dv["matched"] == 56 and dv["max_abs_daily_diff_usd_window"] == 0.0, "rule D: the deviation check passes (v1 = PR5V's main, 56 of 56, daily difference 0)")
d = r["d"]
ok(d["1_faithful"]["pass"] and d["1_faithful"]["engine_trips"] == 56 and d["2_above_null"]["pass"] and d["4_stress"]["pass"] and d["5_governor"]["pass"],
   "rule D: conditions 1, 2, 4 and 5 pass on the fixture")
ok(not d["3_better_than_variant1"]["pass"] and d["3_better_than_variant1"]["bootstrap"]["p_le_0"] == 1.0 and r["verdict"]["reading"] == "FAIL",
   "rule D: arm d equal to variant-1 every day -> every resampled mean 0, p <= 0 = 1: condition 3 fails, the reading FAILs")
pk = r["described"]["posts_d"]["posts_per_key_day"]
ok(pk["USDT-GBP/bid 2026-10-15"] == 13 and r["described"]["posts_v1"]["posts_per_key_day"]["USDT-GBP/bid 2026-10-15"] == 18,
   "rule D: on 10-15's +0.04 % move arm d re-prices k <= 0.10 % only (13 POSTs on the key), v1 all nine (18)")
ok(r["described"]["x_source_window_book_minutes"] == {"yahoo": 2 * 28 * 1440} and r["described"]["truefx_rows_exported"] == 0, "rule D: every window minute read Yahoo (deviation 2), no TrueFX row")
import fastx_sim as FX  # noqa: E402
dd = os.path.join(TMP, "ruled", "data")
mk_d = C.markets(C.load_prints(dd), C.load_minutes(dd), xfield="x_d")
rep_d = FX.simulate([mk_d[b] for b in C.BOOKS], C.cfg(C.NINE, C.GOV, rule=C.RULE_D), C.START, C.E)
rep_v = FX.simulate([mk_d[b] for b in C.BOOKS], C.cfg(C.NINE, C.GOV), C.START, C.E)
at = lambda rp: sum(1 for p in rp["posts"] if p[0] == F.MOVE and p[1] == 1 and p[3] == "reprice")  # noqa: E731
ok(at(rep_d) == 8 and at(rep_v) == 18 and len(rep_d["trips"]) == len(rep_v["trips"]) == 60,
   "rule D's replay: the rule reaches fastx_sim (8 re-prices on USDT-GBP at 10-15 12:00 against 18 without it; 60 trips each)")
r = run(RD, "ruled_shift", pnl_shift={"main": -0.001, "v1": -0.001})
ok(r["deviation_check"]["pass"] and r["d"]["3_better_than_variant1"]["pass"] and r["d"]["3_better_than_variant1"]["bootstrap"]["mean"] == 0.002 and r["verdict"]["reading"] == "PASS",
   "rule D: variant-1 $0.001 a trip worse (v1 with it) -> +$0.002 a day every day, p <= 0 = 0, condition 3 passes and the reading PASSes")
r = run(RD, "ruled_drift", pnl_shift={"main": -0.006})
dv = r["deviation_check"]
ok(not dv["pass"] and dv["matched"] == 56 and not dv["check_under_001"] and close(dv["max_abs_daily_diff_usd_window"], 0.012, 1e-9)
   and not r["verdict"]["judged"] and "deviation check" in r["verdict"]["reading"],
   "broken: v1 $0.006 a trip off PR5V's main -> every trip still matches, but $0.012 a day >= $0.01: the deviation check fails, not judged")
r = run(RD, "ruled_drop", drop_trips=set(range(62, 65)))     # 3 of v1's window trips (its lines follow d's 60)
ok(not r["deviation_check"]["pass"] and r["deviation_check"]["share_pr5v_main_matched"] == round(53 / 56, 6) and not r["verdict"]["judged"],
   "broken: 3 of v1's window trips gone -> 53 of 56 of PR5V's matched (94.6 %), not judged")

shutil.rmtree(TMP)
print(f"all {n_checks} reading checks pass")
