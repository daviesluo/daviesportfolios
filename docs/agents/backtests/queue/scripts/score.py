"""QUEUE's scorer: runs what `docs/agents/reviews/2026-09-28-queue-prereg.md` froze, and writes one JSON.
Written 2026-10-24, committed with checks 1-3 before 2026-11-02 00:00 UTC (the pre-registration's deadline), and run on
the export, the tape and Kraken's hours taken from 2026-11-02 00:10 UTC. Not blind: the pre-registration's deviation 1
(2026-10-03) let other checks read `agent_book_levels`, rows of the window included; the output says so.

    python3 -I docs/agents/backtests/queue/scripts/score.py DATA_DIR OUT.json            one run
    python3 -I docs/agents/backtests/queue/scripts/score.py --twice DATA_DIR OUT.json    check 5: two runs, byte for byte
                                                                                         (OUT.json.check5.json)

DATA_DIR (written by the reading session's scripts; `MANIFEST.json` beside this file says how each piece is taken):
  book_levels.jsonl.gz      the decoded export, one row a line (`decode_pages.py`)
  tape/<BOOK>.jsonl.gz      the keyless UK tape of 2026-10-03 -> 11-01 for the four books (`pull_tape.py`)
  kraken/*.json             Kraken's OHLC replies of the main pull (the spare pull of 2026-10-18 is read from
                            backtests/queue/kraken/, and the replies are taken oldest pull first by file name)
  kraken_trades/<PAIR>.json.gz   only if an hour is missing: Kraken's public trades [[price, volume, time], ...]
                            (`pull_kraken.py trades`), from which every hour is rebuilt
  pr5/prints.txt.gz         agent_quote_prints of the GBP books, 10-03 -> 11-02 (id|book|ms|price|qty|side)
  pr5/minutes.txt.gz        agent_quote_minutes (book|ms|x|fair_u|prints_n), pr5/inputs.txt.gz (kind|ms|value),
  pr5/trips.txt.gz          agent_quote_trips, pr5/books.txt.gz (the kind-book snapshots), pr5/live_orders.txt.gz

In order: check 1 (hashes), check 2 (the scorer reproduces PR6's and PR5's committed round trips with the layer off,
and PR5's own test_sim_logic.py passes), check 3 (`checks.py`). If one fails nothing is opened and the file says which.
Then the data: coverage, Q1 and Q2 (primary, stress, the descriptive arms, the bar with Holm, the hourly shift), Q3 and
check 4, check 6.
"""
import collections, gzip, hashlib, json, os, subprocess, sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import qsim as Q  # noqa: E402
import inputs as I  # noqa: E402
import bar as BAR  # noqa: E402
import checks as CH  # noqa: E402

REPO = Q.REPO
P = Q.P
M, DAY = Q.M, Q.DAY
PREREG = "docs/agents/reviews/2026-09-28-queue-prereg.md"
PREREG_FROZEN_BY = "988eff83"
FROZEN = {"docs/agents/scripts/pr5/pr5_sim.py": "56fbad85ee4df6292f596188d091ad064d030180f33cefe3bd09089d7e772a1a",
          "docs/agents/scripts/pr5/test_sim_logic.py": "7dedbaa189febaf2d712c7e809d62da79be0375edf1ae620ac1b73245e888243",
          "docs/agents/reviews/2026-09-26-pr6-revx-usd-par-prereg.md": "45e69d0d4c4d0669cdfaac824d543dcac39d7e940e0c9f6631ca405fb5426a54"}
PR6_JSON, PR6_JSON_PREFIX = "docs/agents/backtests/pr6/pr6.json", "a9cefc21"
PR5_RUN1 = "docs/agents/backtests/pr5/pr5_run1.json.gz"
# PR6's and PR5's committed inputs, as their pre-registrations hash them (the decompressed bytes)
PR6_INPUTS = {"docs/agents/backtests/pr6/inputs/USDC-USD.jsonl.gz": "91a1287c7be36082ab49604751aea61c92c73553bc7a15b19af0a6f34a8fce7d",
              "docs/agents/backtests/pr6/inputs/USDT-USD.jsonl.gz": "0568e84ca5d185d29975dbb6fe0d89f579ec67ac930a2116cee8c6402c5ec97c"}
PR5_INPUTS = {"trades/USDC-GBP.jsonl.gz": "190911c31bd813472716409daf6ef26c3668d457b4da66e08342c85701c0a491",
              "trades/USDT-GBP.jsonl.gz": "bc7d318aca80febbf964d144b86ed80cf139c2dca5d355dc6524604b5e189749",
              "candles/USDC-USD_60.json.gz": "899e19f595c6cb8a1f6b6dc68b6a16db4c0764f29b81cb250c467da6833c871e",
              "candles/USDT-USD_60.json.gz": "a28ef55210bfacfdc18ef6830779e9632346275af3c24f742611fa51c0ce7008",
              "fx/series_EXN.json.gz": "db87f7c6040c38a517704ebea87699e7fc3b3cbc31a8207ccf68442ecda44baa"}
PR5_CONFIG_SHA = "5440e7445afba953591f21f45bfd19fbdcc121f7fa0073d37be8d9d1eb7bbeee"
SPARE_KRAKEN = os.path.join(REPO, "docs/agents/backtests/queue/kraken")
Q1_RUNGS, Q2_RUNGS, Q3_RUNGS = [0.0001, 0.0002, 0.0003], [1, 2, 3], [0.001, 0.002, 0.003]
Q3_HALF_SPREAD = P.HALF_SPREAD                     # 0.0067 % (PR5's)
Q3_ORDER_BUDGET = 700

GAPS = dict(Q.GAPS)
GAPS.update({
    "orders_every_day": "Condition 4's 'no UTC day over 1,000 orders' reads every UTC day of the run (10-04 -> 11-01), both "
                        "books together.",
    "q3_start_both_books": "Q3's start, if moved, is the first later minute at which X is dark on both GBP books' records "
                           "and no engine trip of either is open (one run decides both books).",
    "check4_follows": "A check-4 difference 'follows from' an input-differing minute when the unmatched or differing trip's "
                      "life [t_entry, t_exit] meets the waived span of its book: from that minute to the first minute at "
                      "the end of whose step every rung of that book is idle in both runs.",
    "check4_engine_idle": "The engine's rungs of a book are all idle at the end of minute m when no engine trip of that book "
                          "is open at its end and either m is dark (no x or no fair_u in the record) or every rung held a "
                          "position at its turn (read from the trips; the event log says the same of quotes).",
    "check6_kinds": "Check 6 compares the snapshot's levels, through bookLevels, with the covering valid row's stored "
                    "levels: equal; a different number of levels or any price different ('a price differs'); else a "
                    "quantity or order count different.",
    "account_resting": "Q3's 'minutes in which an order of the account rested in a book' are the minute starts from each live "
                       "order's ts to its updated_at (the last settlement read), within the window, counted once a book.",
    "bootstrap_pin": "Check 3's 'the day bootstrap on a made-up series of 28 days returns the p computed by hand' is pinned "
                     "exactly on series whose p is exact by hand (every day positive: 0; every day 0: 1), and, on 27 days "
                     "of +1 and one of -1,000 (p = 1 - (27/28)^28 by hand), within three standard errors of 10,000 draws.",
    "arms_for_every_rule": "The descriptive arms 3a, 3b, 3c, 3d and 3h run for Q1, Q2 and Q3 alike; 3i (the hourly shift) "
                           "for Q1 and Q2, as condition 2's sanity check; stress is the primary's arm with its three changes.",
    "q2_hours_missing": "If a needed Kraken hour is missing and no trades file is there, Q2 is not run and the output says "
                        "to rebuild every hour from the public trades (Data item 3); no bar is read for either until then, "
                        "since Holm over Q1 and Q2 needs both p.",
    "check5": "Check 5 is `score.py --twice`: the reading's JSON counts only when its .check5.json says the two runs "
              "were byte-identical.",
    "shift_wrap": "Arm 3i: a twin's start wraps within [10-04 00:00, 11-01 00:00), and its search for a minute with a print "
                  "and a fair runs forward and wraps at 11-01 00:00 to 10-04 00:00.",
})


def rel(p):
    return os.path.relpath(p, REPO).replace(os.sep, "/")


def sha(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


def sha_gz(path):
    return hashlib.sha256(gzip.open(path, "rb").read()).hexdigest()


def r6(x):
    return None if x is None else round(x, 6)


# ------------------------------------------------------------------ check 1
def check1(data, spare_kraken=SPARE_KRAKEN):
    out, ok = {}, True
    got = sha(os.path.join(REPO, PREREG))
    try:
        frozen = subprocess.run(["git", "-C", REPO, "show", f"{PREREG_FROZEN_BY}:{PREREG}"], capture_output=True, check=True).stdout
        prefix = open(os.path.join(REPO, PREREG), "rb").read().startswith(frozen)
        fsha = hashlib.sha256(frozen).hexdigest()
    except Exception as e:  # noqa: BLE001
        prefix, fsha = None, f"git unavailable: {e}"[:120]
    out["prereg"] = {"path": PREREG, "sha256_now": got, "sha256_as_frozen": fsha,
                     "now_is_the_frozen_text_plus_appended_deviations": prefix}
    ok = ok and prefix is True
    for p, h in FROZEN.items():
        g = sha(os.path.join(REPO, p))
        out[p] = {"sha256": g, "matches": g == h}
        ok = ok and g == h
    g = sha(os.path.join(REPO, PR6_JSON))
    out[PR6_JSON] = {"sha256": g, "matches_prefix": g.startswith(PR6_JSON_PREFIX)}
    ok = ok and g.startswith(PR6_JSON_PREFIX)
    out[PR5_RUN1] = {"sha256": sha(os.path.join(REPO, PR5_RUN1))}
    for p, h in PR6_INPUTS.items():
        g = sha_gz(os.path.join(REPO, p))
        out[p] = {"content_sha256": g, "matches": g == h}
        ok = ok and g == h
    base = os.path.join(REPO, "docs/agents/backtests/inputs/pr5_2026-09-23")
    for p, h in PR5_INPUTS.items():
        g = sha_gz(os.path.join(base, p))
        out["pr5_inputs/" + p] = {"content_sha256": g, "matches": g == h}
        ok = ok and g == h
    g = sha(os.path.join(base, "config.json"))
    out["pr5_inputs/config.json"] = {"sha256": g, "matches": g == PR5_CONFIG_SHA}
    ok = ok and g == PR5_CONFIG_SHA
    out["scorer"] = {rel(os.path.join(HERE, f)): sha(os.path.join(HERE, f)) for f in sorted(os.listdir(HERE)) if f.endswith(".py")}
    files = []
    for root in (data, spare_kraken):
        if root and os.path.isdir(root):
            for dp, _, fs in os.walk(root):
                for f in sorted(fs):
                    files.append(os.path.join(dp, f))
    out["inputs_of_this_run"] = {rel(f) if f.startswith(REPO) else f: sha(f) for f in sorted(files)}
    return ok, out


# ------------------------------------------------------------------ check 2
def qb_from(Bf, book):
    pr = [(p[0], p[1], p[2], p[3], None) for p in Bf.all_prints]
    return Q.QBook(book, pr, Bf.t0, Bf.t0 + Bf.n * M, Bf.X, Bf.F)


TRIP_FIELDS = ["book", "entry", "exit", "fill_ts", "how", "k", "notional_usd", "pnl_usd", "side", "t_entry", "t_exit"]


def stored(trips, nd):
    return [{k: (round(x[k], nd) if isinstance(x[k], float) else x[k]) for k in TRIP_FIELDS}
            for x in sorted(trips, key=lambda z: (z["book"], z["t_entry"], z["side"], z["k"]))]


def check2():
    out, ok = {}, True
    env = {k: v for k, v in os.environ.items() if k not in ("PR5_DATA", "PR5_DRYRUN")}
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    run5 = subprocess.run([sys.executable, os.path.join(REPO, "docs/agents/scripts/pr5/test_sim_logic.py")], cwd=REPO, env=env,
                          capture_output=True, text=True)
    last = run5.stdout.strip().splitlines()[-1] if run5.stdout.strip() else ""
    out["pr5_test_sim_logic"] = {"returncode": run5.returncode, "last_line": last}
    ok = ok and run5.returncode == 0 and last == "all synthetic checks pass"
    sys.path.insert(0, os.path.join(REPO, "docs/agents/backtests/pr6"))
    import pr6_sim as S6  # noqa: E402
    ref6 = json.load(open(os.path.join(REPO, PR6_JSON)))["primary_trips"]
    ref5 = json.load(gzip.open(os.path.join(REPO, PR5_RUN1), "rt"))["primary_trips"]
    prints6 = {b: S6.parse_prints(S6.read_input(b)[0]) for b in S6.BOOKS}
    fxmap = P.fx_series()
    for skip in (True, False):
        trips = []
        for b in S6.BOOKS:
            Bf = S6.ParBook(b, prints6[b], S6.PRIMARY_START[b], S6.END)
            trips += Q.run(qb_from(Bf, b), Q.Cfg("q1", S6.RUNGS, S6.HALF_SPREAD[b], layer=False), skip=skip)[0]
        mine = stored(trips, 8)
        same6 = mine == ref6
        trips = []
        for b in P.BOOKS:
            Bf = P.Book(b, P.START[b], P.END, fxmap)
            trips += Q.run(qb_from(Bf, b), Q.Cfg("q3", P.RUNGS, P.HALF_SPREAD, layer=False), skip=skip)[0]
        mine5 = stored([x for x in trips if P.START[x["book"]] <= x["t_entry"] < P.PRIM_END], 6)
        same5 = mine5 == ref5
        key = "skipping_quiet_minutes" if skip else "every_minute"
        out[key] = {"pr6": {"trips": len(mine), "committed": len(ref6), "every_field_equal": same6},
                    "pr5": {"trips": len(mine5), "committed": len(ref5), "every_field_equal": same5}}
        ok = ok and same6 and same5 and len(ref6) == 8341 and len(ref5) == 8192
    return ok, out


# ------------------------------------------------------------------ the data
def load_rows(path):
    raw = I.load_book_record(path)
    return {b: Q.make_rows(v) for b, v in raw.items()}, raw


def first_twin_minute(B, start, w0, w1):
    """Arm 3i's entry: the first minute at or after `start` with a print and a fair, searching forward, wrapping in the
    window."""
    lo, hi = (w0 - B.t0) // M, (w1 - B.t0) // M
    s = (start - B.t0) // M
    for k in range(hi - lo):
        i = lo + (s - lo + k) % (hi - lo)
        if i in B.by_min and B.F[i] is not None:
            return i
    return None


def make_twin(books, cfgs, w0, w1):
    cache = {}

    def run_twin(book, side, start, usd):
        B = books[book]
        i = first_twin_minute(B, start, w0, w1)
        if i is None:
            return 0.0
        key = (book, side, i, usd)
        if key not in cache:
            last = B.by_min[i][-1]
            tr, _ = Q.run(B, cfgs[book], inject=(side, last[1], usd, i, last[0]), stop_when_flat=True)
            cache[key] = sum(x["pnl_usd"] for x in tr)
        return cache[key]
    return run_twin, cache


def summary(trips):
    def by(f):
        g = collections.defaultdict(list)
        for x in trips:
            g[f(x)].append(x)
        return {k: {"trips": len(v), "pnl_usd": r6(sum(x["pnl_usd"] for x in v))} for k, v in sorted(g.items())}
    return {"trips": len(trips), "pnl_usd": r6(sum(x["pnl_usd"] for x in trips)),
            "won": sum(1 for x in trips if x["pnl_usd"] > 0),
            "fills_by_kind": dict(collections.Counter(x["fill_kind"] for x in trips)),
            "stopped": sum(1 for x in trips if x["how"] == "taker"),
            "stop_pnl_usd": r6(sum(x["pnl_usd"] for x in trips if x["how"] == "taker")),
            "under_1usd": sum(1 for x in trips if x["entry_notional_usd"] < 1.0),
            "by_book": by(lambda x: x["book"]), "by_side": by(lambda x: x["side"]), "by_rung": by(lambda x: str(x["k"])),
            "by_half": by(lambda x: "1" if x["t_entry"] < I.HALF else "2"),
            "by_week": by(lambda x: str((x["t_entry"] - I.W0) // (7 * DAY) + 1))}


def fills_report(collect):
    fl = collect.get("fills", [])
    out = {"no_book_at_golive_fills": collect.get("no_book_golive_fills", 0), "golive": collect.get("golive", 0),
           "refused_at_golive": collect.get("refused", 0)}
    for kind in ("queue", "through"):
        sel = [f for f in fl if f["kind"] == kind]
        rep = {"fills": len(sel)}
        for h in (5, 60):
            v = sorted(f[f"markout_{h}m_bps"] for f in sel if f.get(f"markout_{h}m_bps") is not None)
            rep[f"markout_{h}m"] = {"n": len(v), "missing": len(sel) - len(v), "mean_bps": r6(sum(v) / len(v)) if v else None,
                                    "median_bps": r6(v[len(v) // 2]) if v else None}
        js = [f for f in sel if f.get("J") is not None and f.get("go") is not None]
        rep["queue_at_join_coins_median"] = r6(sorted(f["queue_at_join"] for f in js)[len(js) // 2]) if js else None
        rep["queue_at_join_x_order_median"] = r6(sorted(f["queue_at_join"] / f["order_coins"] for f in js)[len(js) // 2]) if js else None
        rep["minutes_golive_to_join_median"] = r6(sorted((f["J"] - f["go"]) / M for f in js)[len(js) // 2]) if js else None
        rep["minutes_join_to_fill_median"] = r6(sorted((f["ts"] - f["J"]) / M for f in js)[len(js) // 2]) if js else None
        out[kind] = rep
    return out


def run_books(books, cfgs, collect_markouts=False):
    trips, orders, coll = [], collections.Counter(), {}
    for b in sorted(books):
        c = {}
        cfg = cfgs[b]
        if collect_markouts:
            cfg.markouts = True
        tr, od = Q.run(books[b], cfg, collect=c)
        trips += tr
        orders.update(od)
        for k, v in c.items():
            if isinstance(v, list):
                coll.setdefault(k, []).extend(v)
            else:
                coll[k] = coll.get(k, 0) + v
    return trips, orders, coll


def arms(books, mk_cfg, w0, w1, label):
    """Primary, stress, and the descriptive arms 3a, 3b, 3c, 3d, 3h for one rule (each a fresh run from its start)."""
    out, runs = {}, {}
    spec = {"primary": {}, "stress": {"stress": True}, "3a_through_only": {"layer": False}, "3b_optimistic": {"join": "optimistic"},
            "3c_last_print_alone": {"book_refusal": False}, "3d_live_lag": {"lag_ms": 30000}, "3h_middle": {"join": "middle"}}
    for name, kw in spec.items():
        trips, orders, coll = run_books(books, {b: mk_cfg(b, **kw) for b in books}, collect_markouts=(name == "primary"))
        sel = [x for x in trips if w0 <= x["t_entry"] < w1]
        runs[name] = (trips, orders, coll)
        out[name] = {"summary": summary(sel), "orders_per_day": {str(d): n for d, n in sorted(orders.items())},
                     "orders_max_day": max(orders.values(), default=0)}
        if name in ("primary", "3a_through_only"):
            out[name]["fills"] = fills_report(coll)
    a = runs["primary"][1]
    c = runs["3c_last_print_alone"][1]
    out["3c_orders_book_test_adds"] = {str(d): a.get(d, 0) - c.get(d, 0) for d in sorted(set(a) | set(c))}
    return out, runs


def coverage(rows, raw, w0, w1):
    out = {}
    for b, (valid, faulty) in rows.items():
        void = I.void_minutes(valid, w0, w1)
        out[b] = {"window_minutes": (w1 - w0) // M, "void_minutes": len(void), "void_share": len(void) / ((w1 - w0) // M),
                  "faulty_rows": len(faulty), "valid_rows": len(valid), "rows_reads_short_of_their_span": I.short_rows(valid),
                  "void": None}
    allv = {b: set(I.void_minutes(v[0], w0, w1)) for b, v in rows.items()}
    for b in out:
        others = [o for o in allv if o != b]
        out[b]["void"] = [[I.iso(m), {o: m in allv[o] for o in others}] for m in sorted(allv[b])]
        out[b]["void_also_void_on_every_other_book"] = sum(1 for m in allv[b] if all(m in allv[o] for o in others))
    return out


# ------------------------------------------------------------------ check 4 and check 6
def idle_minutes_engine(trips, minutes, book, t0, t1):
    """GAPS check4_engine_idle."""
    tb = [x for x in trips if x["book"] == book]
    rec = minutes.get(book, {})
    out = set()
    for m in range(t0, t1, M):
        if any(x["t_entry"] <= m < x["t_exit"] for x in tb):
            continue
        x, u, _ = rec.get(m, (None, None, None))
        dark = not x or not u
        held = sum(1 for y in tb if y["t_entry"] < m <= y["t_exit"])
        if dark or held >= 6:
            out.add(m)
    return out


def check4(replay, engine, minutes, books, diff_minutes, w0, w1):
    eng = [x for x in engine if w0 <= x["t_entry"] < w1]
    rep = [x for x in replay if w0 <= x["t_entry"] < w1]
    key = lambda x: (x["book"], x["side"], round(x["k"], 10), x["t_entry"])  # noqa: E731
    ei = {key(x): x for x in eng}
    ri = {key(x): x for x in rep}
    diffs = []
    for k in sorted(set(ei) | set(ri), key=str):
        a, b = ei.get(k), ri.get(k)
        if a is None or b is None:
            diffs.append((k, "only_in_" + ("replay" if a is None else "engine"), a or b))
            continue
        bad = []
        if a["fill_print_id"] != b["fill_id"]:
            bad.append("fill_print_id")
        for f, tol in (("entry", 1e-9), ("qty", 1e-9), ("exit", 1e-9), ("pnl_usd", 1e-6)):
            if abs(a[f] - b[f]) > tol:
                bad.append(f)
        if a["t_exit"] != b["t_exit"]:
            bad.append("t_exit")
        if a["how"] != b["how"]:
            bad.append("how")
        if bad:
            diffs.append((k, ",".join(bad), a))
    waived = {}
    for b, ms in diff_minutes.items():
        B = books[b]
        idle_e = idle_minutes_engine(engine, minutes, b, B.t0, B.t1)
        idle_r = B.idle_replay
        spans = []
        for m in sorted(ms):
            end = next((x for x in range(m, B.t1, M) if x in idle_e and x in idle_r), B.t1)
            spans.append((m, end))
        waived[b] = spans
    unexplained, explained = [], []
    for k, why, x in diffs:
        life = (x["t_entry"], x["t_exit"])
        if any(s <= life[1] and life[0] <= e for s, e in waived.get(k[0], [])):
            explained.append([k[0], k[1], k[2], I.iso(k[3]), why])
        else:
            unexplained.append([k[0], k[1], k[2], I.iso(k[3]), why])
    return {"engine_trips": len(eng), "replay_trips": len(rep), "matched_exactly": len(set(ei) & set(ri)) - sum(1 for d in diffs if not d[1].startswith("only_in_")),
            "input_differing_minutes": {b: len(v) for b, v in diff_minutes.items()},
            "differences_allowed": explained[:500], "differences_not_allowed": unexplained[:500],
            "pass": not unexplained}


def check6(snaps, raw_rows, w0, w1):
    cnt = collections.Counter()
    for s in snaps:
        if not (w0 <= s["minute"] < w1):
            continue
        d = s["detail"]
        at = int(d.get("at", 0))
        lv = I.book_levels({"data": d.get("book")})
        rows = [r for r in raw_rows.get(s["book"], []) if r[0] <= at <= r[1]]
        valid = [r for r in rows if r[3] and r[4] and float(r[3][0][0]) < float(r[4][0][0])]
        if not valid or lv is None:
            cnt["no_row_covers"] += 1
            continue
        r = valid[-1]
        stored_ = ([[float(x[0]), float(x[1]), None if x[2] is None else float(x[2])] for x in r[3]],
                   [[float(x[0]), float(x[1]), None if x[2] is None else float(x[2])] for x in r[4]])
        if stored_ == lv:
            cnt["equal"] += 1
        elif any(len(a) != len(b) or any(x[0] != y[0] for x, y in zip(a, b)) for a, b in zip(stored_, lv)):
            cnt["a_price_differs"] += 1
        else:
            cnt["a_quantity_or_count_differs"] += 1
    n = sum(cnt.values())
    return {"snapshots": n, "counts": dict(cnt), "share_equal": cnt["equal"] / n if n else None}


# ------------------------------------------------------------------ main
def score(data, out_path, spare_kraken=SPARE_KRAKEN, run_checks=True):
    """The whole reading. `run_checks=False` is for the synthetic test's second and third worlds only (the first runs
    them): the command line always runs checks 1-3 first."""
    R = {"what": "QUEUE (" + PREREG + ")", "gaps": GAPS,
         "not_blind": "Deviation 1 (2026-10-03, Davies): agent_book_levels was read by other checks from 2026-10-03 01:45 UTC, "
                      "window rows included; the reading is not blind."}
    if run_checks:
        ok1, R["check1_hashes"] = check1(data, spare_kraken)
        ok2, R["check2_reproduces"] = check2()
        ok3, R["check3_pins"] = CH.run()
    else:
        ok1 = ok2 = ok3 = True
        R["checks_not_run"] = "the synthetic test's later worlds"
    R["checks_1_2_3"] = {"1": ok1, "2": ok2, "3": ok3}
    if not (ok1 and ok2 and ok3):
        R["scored"] = False
        R["not_scored_because"] = [n for n, ok in (("check 1", ok1), ("check 2", ok2), ("check 3", ok3)) if not ok]
        write(out_path, R)
        return R
    R["scored"] = True
    w0, w1, end = I.W0, I.W1, I.DATA_END
    n = (end - w0) // M
    rows, raw = load_rows(os.path.join(data, "book_levels.jsonl.gz"))
    tape = {b: I.load_tape(os.path.join(data, "tape", f"{b}.jsonl.gz")) for b in I.USD_BOOKS + I.GBP_BOOKS}
    R["coverage"] = coverage({b: rows.get(b, ([], [])) for b in I.USD_BOOKS + I.GBP_BOOKS}, raw, w0, w1)
    judged = all(R["coverage"][b]["void_share"] <= 0.10 for b in I.USD_BOOKS)

    # Q1 and Q2 on the USD books
    kfiles = sorted([os.path.join(spare_kraken, f) for f in os.listdir(spare_kraken) if f.endswith(".json") and f != "MANIFEST.json"]
                    + [os.path.join(data, "kraken", f) for f in os.listdir(os.path.join(data, "kraken")) if f.endswith(".json")],
                    key=os.path.basename)
    books1, books2, kr, runs2 = {}, {}, {}, None
    for b in I.USD_BOOKS:
        pr = tape[b]
        F1 = I.guard(pr, w0, n, [1.0] * n)
        pair = I.KRAKEN_KEY[b].replace("Z", "")
        bars, diffs = I.load_kraken([f for f in kfiles if pair in os.path.basename(f).replace("Z", "")], I.KRAKEN_KEY[b])
        miss = I.kraken_missing(bars)
        kr[b] = {"files": [rel(f) if f.startswith(REPO) else f for f in kfiles], "bars": len(bars), "disagreements": diffs, "missing_hours": miss}
        tfile = os.path.join(data, "kraken_trades", f"{pair}.json.gz")
        if miss and os.path.exists(tfile):                    # Data item 3: every hour rebuilt from the public trades
            rebuilt = I.hours_from_trades(json.load(gzip.open(tfile, "rt")))
            kr[b]["rebuilt_from_trades"] = {"hours": len(rebuilt), "ohlc_differs": [
                {"start": I.iso(h * 1000), "ohlc": list(bars[h]), "trades": list(rebuilt[h]) if h in rebuilt else None}
                for h in sorted(bars) if h not in rebuilt or I.vwap_ticks(rebuilt[h][0]) != I.vwap_ticks(bars[h][0]) or rebuilt[h][1] != bars[h][1]]}
            bars = rebuilt
            kr[b]["missing_hours"] = miss = I.kraken_missing(bars)
        F2 = I.guard(pr, w0, n, I.q2_fair(bars, w0, n))
        v, fa = rows.get(b, ([], []))
        books1[b] = Q.QBook(b, pr, w0, end, [1.0] * n, F1, v, fa)
        books2[b] = Q.QBook(b, pr, w0, end, [1.0] * n, F2, v, fa)
    R["kraken"] = kr
    q2_ok = all(not kr[b]["missing_hours"] for b in I.USD_BOOKS)
    mk1 = lambda b, **kw: Q.Cfg("q1", Q1_RUNGS, I.HALF_SPREAD[b], **kw)  # noqa: E731
    mk2 = lambda b, **kw: Q.Cfg("q2", Q2_RUNGS, I.HALF_SPREAD[b], **kw)  # noqa: E731
    R["Q1"], runs1 = arms(books1, mk1, w0, w1, "Q1")
    if q2_ok:
        R["Q2"], runs2 = arms(books2, mk2, w0, w1, "Q2")
    else:
        R["Q2"] = {"not_run": "Kraken's hours are missing; rebuild every hour from Kraken's public trades (Data item 3)"}
    bar = {}
    if not q2_ok:                                             # Holm needs both p: no bar until Data item 3's rebuild
        bar = {"not_judged": "a needed Kraken hour is missing: rebuild every hour from Kraken's public trades (Data item 3, "
                             "pull_kraken.py trades) and run the scorer again; Holm over Q1 and Q2 needs both"}
    else:
        p1 = BAR.day_bootstrap(BAR.daily([x for x in runs1["primary"][0] if w0 <= x["t_entry"] < w1], w0))
        p2 = BAR.day_bootstrap(BAR.daily([x for x in runs2["primary"][0] if w0 <= x["t_entry"] < w1], w0))
        h1, h2 = BAR.holm(p1, p2)
        for name, runs, hold, p, books, mk in (("Q1", runs1, h1, p1, books1, mk1), ("Q2", runs2, h2, p2, books2, mk2)):
            c, d = BAR.conditions(runs["primary"][0], runs["stress"][0], runs["primary"][1], w0, I.HALF, w1, hold)
            d["bootstrap_p"] = p
            prim = [x for x in runs["primary"][0] if w0 <= x["t_entry"] < w1]
            twin, cache = make_twin(books, {b: mk(b) for b in books}, w0, w1)
            vals = BAR.shift_values(prim, twin, w0, w1)
            d["3i_hourly_shift"] = BAR.shift_report(vals, d["pnl_usd"])
            d["3i_distinct_twins"] = len(cache)
            bar[name] = {"judged": judged, "conditions": c, "detail": d,
                         "reading": ("PASS" if c["PASS"] else "FAIL") if judged else "reported, not judged (over 10 % of a USD book's minutes void)"}
    R["bar"] = bar

    # Q3 on the GBP books
    minutes = I.load_minutes(os.path.join(data, "pr5", "minutes.txt.gz"))
    fx, hours = I.load_quote_inputs(os.path.join(data, "pr5", "inputs.txt.gz"))
    engine = I.load_engine_trips(os.path.join(data, "pr5", "trips.txt.gz"))
    live = I.load_live_orders(os.path.join(data, "pr5", "live_orders.txt.gz"))
    first_live = min((o["ts"] for o in live), default=None)
    store = collections.defaultdict(list)
    for line in I.lines(os.path.join(data, "pr5", "prints.txt.gz")):
        pid, b, t, px, q, sd = line.split("|")
        store[b].append((int(t), round(float(px) / I.TICK), float(q), sd, pid))
    start = w0
    open_at = lambda t: any(x["t_entry"] <= t < x["t_exit"] for x in engine)  # noqa: E731
    if any(minutes.get(b, {}).get(w0, (None,))[0] for b in I.GBP_BOOKS) or any(x["t_entry"] < w0 < x["t_exit"] for x in engine):
        t = w0 + M
        while t < end and not (all(not minutes.get(b, {}).get(t, (None,))[0] for b in I.GBP_BOOKS) and not open_at(t)):
            t += M
        start = t
    R["Q3_start"] = I.iso(start)
    n3 = (end - start) // M
    books3, diff_minutes, rebuilt_all, own_all, union_rep = {}, {}, {}, {}, {}
    for b in I.GBP_BOOKS:
        pr, rep = I.union_tape(tape[b], store.get(b, []))
        union_rep[b] = {"only_in_pull": rep["only_in_pull"], "only_in_store": rep["only_in_store"]}
        own = I.own_fills(pr, live, b) if first_live is not None else set()
        own_all[b] = sorted(own)
        pr = [p for p in pr if p[4] not in own]
        X, U, rebuilt = I.q3_inputs(minutes, fx, hours, b, start, n3)
        F = [(u / x) if (x and u) else None for x, u in zip(X, U)]
        v, fa = rows.get(b, ([], []))
        books3[b] = Q.QBook(b, pr, start, end, X, F, v, fa)
        cnt = collections.Counter(p[0] // M * M for p in pr if start <= p[0] < end)
        dm = set(rebuilt)
        for m, (x, u, pn) in minutes.get(b, {}).items():
            if start <= m < end and pn is not None and pn != cnt.get(m, 0):
                dm.add(m)
        dm |= {p[0] // M * M for p in I.union_tape(tape[b], store.get(b, []))[0] if p[4] in own}
        diff_minutes[b] = dm
        rebuilt_all[b] = [I.iso(m) for m in rebuilt]
    R["Q3_tape"] = {"union": union_rep, "own_fills_taken_out": own_all, "rebuilt_minutes": rebuilt_all,
                    "first_live_order": I.iso(first_live) if first_live else None}
    mk3 = lambda b, **kw: Q.Cfg("q3", Q3_RUNGS, Q3_HALF_SPREAD, **kw)  # noqa: E731
    R["Q3"], runs3 = arms(books3, mk3, w0, w1, "Q3")
    for b, B in books3.items():                               # the replay's idle minutes for check 4 (every minute turned)
        B.idle_replay = set()
    rep_trips = []
    for b, B in books3.items():
        rep_trips += run_idle(B, mk3(b, layer=False))[0]
    R["check4_q3_reproduces_pr5_engine"] = check4(rep_trips, engine, minutes, books3, diff_minutes, w0, w1)
    R["Q3"]["void_check4_failed"] = not R["check4_q3_reproduces_pr5_engine"]["pass"]   # check 4 gates Q3 only
    if first_live is not None:
        prim = [x for x in runs3["primary"][0] if w0 <= x["t_entry"] < w1]
        R["Q3"]["from_first_live_order"] = {"before": summary([x for x in prim if x["t_entry"] < first_live]),
                                            "after": summary([x for x in prim if x["t_entry"] >= first_live])}
    R["Q3"]["orders_against_pr5_budget_700"] = {"budget": Q3_ORDER_BUDGET, "max_day": R["Q3"]["primary"]["orders_max_day"]}
    R["Q3"]["minutes_an_account_order_rested"] = {b: len({m for o in live if o["book"] == b
                                                          for m in range(max(o["ts"], w0) // M * M, min(o["updated_at"], w1 - 1) // M * M + M, M)})
                                                  for b in I.GBP_BOOKS}
    snaps = I.load_snapshots(os.path.join(data, "pr5", "books.txt.gz")) if os.path.exists(os.path.join(data, "pr5", "books.txt.gz")) else []
    R["check6_recorder_against_snapshots"] = check6(snaps, raw, w0, w1)
    write(out_path, R)
    return R


def run_idle(B, cfg):
    """Arm 3a on Q3 turned every minute, recording the minutes at whose end every rung is idle (check 4)."""
    orig = Q.next_minute
    idle = B.idle_replay

    def hook(B_, rungs, i, n):
        if all(r.mode == "idle" for r in rungs):
            idle.add(B_.t0 + i * M)
        return i + 1
    Q.next_minute = hook
    try:
        return Q.run(B, cfg)
    finally:
        Q.next_minute = orig


def write(path, R):
    with open(path, "w") as f:
        json.dump(R, f, indent=1, sort_keys=True, default=str)
        f.write("\n")


def cli(argv):
    """[--twice] [--spare-kraken DIR] DATA OUT; --spare-kraken (default: the committed spare pull) is for the synthetic test."""
    twice = "--twice" in argv
    argv = [x for x in argv if x != "--twice"]
    spare = SPARE_KRAKEN
    if "--spare-kraken" in argv:
        k = argv.index("--spare-kraken")
        spare = argv[k + 1]
        argv = argv[:k] + argv[k + 2:]
    data, out = argv[0], argv[1]
    if twice:
        res = []
        for o in (out, out + ".second"):
            p = subprocess.run([sys.executable, "-I", os.path.abspath(__file__), "--spare-kraken", spare, data, o], capture_output=True, text=True)
            res.append(p.returncode)
        same = open(out, "rb").read() == open(out + ".second", "rb").read()
        with open(out + ".check5.json", "w") as f:
            json.dump({"check5_two_runs_byte_identical": same, "returncodes": res, "sha256": sha(out)}, f, indent=1, sort_keys=True)
            f.write("\n")
        os.remove(out + ".second")
        print("check 5:", "byte-identical" if same else "DIFFER")
        return 0 if same else 1
    R = score(data, out, spare)
    print("scored" if R.get("scored") else "not scored: " + ", ".join(R.get("not_scored_because", [])))
    return 0 if R.get("scored") else 1


if __name__ == "__main__":
    sys.exit(cli(sys.argv[1:]))
