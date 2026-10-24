"""What PR5V's reading (`reading_pr5v.py`) and rule D's (`reading_ruled.py`) share. Written 2026-10-24, before either
reading (due on or after 2026-10-28 01:00 UTC), strictly from the two pre-registrations:
`docs/agents/reviews/2026-09-28-pr5-variant-prereg.md` (PR5V) and `docs/agents/reviews/2026-09-28-pr5-rule-d-prereg.md`
(rule D), with their recorded deviations (reference §4 items 45 and 47): both engines' governor is 900 / 950 since
2026-10-01 (PR5V's deviation 2, rule D's deviation 3), so the replays' `gov` and condition 5 read 900 and 950; rule D's
arm d reads PR5's stored X since 2026-09-30 (its deviation 2), so its replay's X is the X it recorded (`x_d`), which is
then Yahoo's on every minute; its 0.03 % rung left only its twin (its deviation 4), not the arm judged here.

Nothing here chooses. Where a pre-registration is silent, the narrowest reading its text supports is taken and named
in `GAPS` below and in the reading's output.

* The inputs: the exports `reading_pull.sql` / `reading_pull_ruled.sql` take (one `{table, n, md5, text}` payload per
  statement, cut into `data/<table>.txt` by `reading_grab.py`, its md5 and line count checked).
* `RecMkt`: a `pr5v_sim.Mkt` whose X and fairU of minute t are the values the engine recorded for that book and minute,
  looked up by minute, and whose `change_instants` is every minute of the run, so `simulate` turns every minute (PR5V
  §5, "The replay").
* The study's random-time null with E in place of `N1` (PR5V condition 2): `study.null_twins`'s own source with that one
  expression replaced, asserted to apply exactly once; with E = `N1` it is the study's function (the fixture test shows
  it).
* Condition 1's match, condition 5's governor, the window's days, the preconditions and the described tables.
"""
import collections, datetime, glob, gzip, hashlib, inspect, json, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
sys.path.insert(0, HERE)

SHA = {"pr5v_sim.py": "54ad41982d143758ece6ee8e5bb48d5a4aafe1dc0429ccc0af6d1c57282de27a",
       "../pr5/pr5_sim.py": "56fbad85ee4df6292f596188d091ad064d030180f33cefe3bd09089d7e772a1a",
       "study.py": "4a5d077ef0f97060ee5613d9a5f1c75b6e404b15ed052d367c1fe67f6d8e7b50",
       "fastx_sim.py": "f9562974fae8f60ff118f371af95b722318e4cb0f68c0df77948509d70bc6f17"}


def sha(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


def check_hashes(names=tuple(SHA)):
    """The frozen files, before anything else (before they are even imported): each must be the hash its
    pre-registration names, or nothing is read."""
    out = {}
    for n in names:
        h = sha(os.path.join(HERE, n))
        if h != SHA[n]:
            raise SystemExit(f"{n}: sha256 {h}, the pre-registration names {SHA[n]}: nothing is read")
        out[n] = h
    return out


check_hashes()
import pr5v_sim as V  # noqa: E402
import study as S  # noqa: E402

M, DAY, TICK = V.M, V.DAY, V.TICK
BOOKS = list(S.BOOKS)                                           # ["USDC-GBP", "USDT-GBP"], the order both engines decide in


def ms(s):
    return int(datetime.datetime.fromisoformat(s).replace(tzinfo=datetime.timezone.utc).timestamp() * 1000)


def iso(t):
    return datetime.datetime.fromtimestamp(t / 1000, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ------------------------------------------------------------------ the pre-registrations' numbers (both files share them)
START = ms("2026-09-28T00:00")          # both arms flat from here (PR5V §3, rule D §3)
W0, W1 = ms("2026-09-29T00:00"), ms("2026-10-27T00:00")        # the window: the 28 UTC days 09-29 -> 10-26, by entry day
E = ms("2026-10-28T00:30")              # E: the replays end here; the null's twins run to min(E, m + 2 days)
READ_FROM = ms("2026-10-28T01:00")      # the reading's earliest instant
LATEST_DAY = "2026-11-04"               # its latest date (later: a deviation)
NINE = [0.0003, 0.0005, 0.00075, 0.001, 0.00125, 0.0015, 0.002, 0.0025, 0.003]
TOP5 = [0.0005, 0.00075, 0.001, 0.00125, 0.0015]
GOV = {"entry_at": 900, "stop_at": 950}            # PR5V's deviation 2 and rule D's deviation 3 (2026-10-01)
GOV_STUDY = {"entry_at": 600, "stop_at": 700}      # the study's runs the reproduction check replays (ref_timing.py)
RULE_D = {"frac": 1 / 3, "away": None}
ACCT4 = lambda book, side: f"{book}/{side}"  # noqa: E731  four keys, a book and a side each
NULL_DRAWS, NULL_SEED = 2000, 20260923
BOOT_BLOCK, BOOT_N = 7, 10000
MIN_DAYS = 21                           # fewer window days than this (PR5's record stopped): reported, not judged

FREEZE_PR5V = "157ad527"                # the commit that froze PR5V; stepMinute is compared with its copy there
QUOTES_TS = "supabase/functions/agents/quotes.ts"

# The gaps: where a pre-registration does not say, the narrowest reading its text supports, named in every output.
GAPS = {
    "match_multiset": "Condition 1's 'has a trip in the other with the same book, side, k, t_entry and entry ticks' is read "
                      "one to one: each trip matches at most one trip of the other set (a multiset intersection).",
    "match_empty": "A share over an empty set (no engine trip, or no replay trip, in the window) is not 'at least 95 %': the "
                   "condition fails.",
    "pnl_tolerance_zero": "With the engine's window P&L exactly 0, the 10 % tolerance is 0: the two sets' P&L must be equal.",
    "null_p95_rounded": "Condition 2 compares the window's P&L, unrounded, with the p95 as the frozen null_twins returns it "
                        "(rounded to 4 decimals by study.py).",
    "governor_order": "The engine's events carry no sequence column. Condition 5 counts a key's POSTs before each POST in the "
                      "order the engine decides: by minute, the turn's POSTs before the minute's stops, each in k order (a "
                      "key is one book and side; bids before asks is then the order of the keys, not within one). The "
                      "count each POST event carries (detail.n, the key's count after it) is checked against that "
                      "recount; the condition passes only if it holds on both.",
    "posts_one_turn": "'The most POSTs a key sent at one turn, stops included' is counted per key and decided minute: the "
                      "turn's POSTs plus the stops of that minute.",
    "first_live_split": "'The days from its first live order' are the window's UTC entry days from the day of PR5's first "
                        "order of mode live, that day included; the days before it are reported beside them.",
    "stopped_record": "If PR5's engine's last decided minute is before E - 1 min, the window ends on the last UTC day D "
                      "whose D + 2 days 00:30 the variant's record covers without a gap, and E moves to that instant "
                      "(PR5V §3). Its record is read only from the minute rows the variant engine wrote, which it writes "
                      "only once PR5's engine has decided the minute (or rebuilt it, which is not its record stopping).",
    "last_step_close": "'None may close at a run's last step': a scored replay trip closed at the replay's last step means "
                       "the replay is not the one §5 describes; the reading is then reported, not judged, and says so.",
    "stepminute_changed": "Whether stepMinute changed before E is read from the repository: the function's text in "
                          f"{QUOTES_TS} at the freeze commit {FREEZE_PR5V} and as checked out. A difference stops the "
                          "reading with that finding: when it deployed is not in the repository, and §3's end rule then "
                          "needs that date, which this script does not guess.",
}


# ------------------------------------------------------------------ the replay's markets
class RecMkt(V.Mkt):
    """One book as the engine decided it: its prints (ts, ticks, qty, aggressor), in the order given; X and fairU of
    minute t are the engine's recorded values for that book and minute (None when it recorded none: dark); every minute
    of a run is a change instant, so the simulator turns every minute."""

    def __init__(self, book, prints, minutes):
        super().__init__(book, prints, [], [])
        self.minutes = minutes                    # {minute ms: (x, fairU)}

    def X(self, tau, lagx):
        r = self.minutes.get(tau // M * M)
        return r[0] if r else None

    def fairU(self, tau):
        r = self.minutes.get(tau // M * M)
        return r[1] if r else None

    def change_instants(self, lagx, t0, t1):
        return list(range(-(-t0 // M) * M, t1, M))


def rec_from_study(mk, t0, t1):
    """The study's own market as a RecMkt: its X and fairU at each minute of [t0, t1) tabulated, its prints as they are."""
    return RecMkt(mk.book, mk.prints, {m: (mk.X(m, 0), mk.fairU(m)) for m in range(t0, t1, M)})


def cfg(rungs, gov, stress=False, rule=None):
    """The pre-registered call: `default_cfg(rungs=..., reprice=0.0003, size=100.0, vol_share=0.10, cap="shared",
    exit_share=False, s_ms=60000, delta_ms=None, cancel_ms=0, lagx_ms=0, phase_ms=0, gov=..., acct=...)`; rule D adds its
    `rule` (fastx_sim reads it; pr5v_sim never does)."""
    c = V.default_cfg(rungs=list(rungs), reprice=0.0003, size=100.0, vol_share=0.10, cap="shared", exit_share=False, s_ms=60000,
                      delta_ms=None, cancel_ms=0, lagx_ms=0, phase_ms=0, gov=gov, acct=ACCT4, stress=stress)
    if rule is not None:
        c["rule"] = rule
    return c


def study_reproduction(R, sim, rungs, rule, expect):
    """Before any window data are opened: RecMkts built from the study's own Mkt values over the study's spans reproduce
    the study's runs on its stock markets, trip for trip and POST for POST, and the pre-registration's numbers.
    `expect` = {"N": (trips, pnl), "F": (trips, pnl)} over the 28 days [N0, N1) and the fresh days [F0, F1)."""
    out, ok = {}, True
    for span, (a, b), mk in (("N", (S.N0, S.N1), R.N), ("F", (S.F0, S.F1), R.F)):
        r1 = sim([mk[x] for x in BOOKS], cfg(rungs, GOV_STUDY, rule=rule), a, b)
        r2 = sim([rec_from_study(mk[x], a, b) for x in BOOKS], cfg(rungs, GOV_STUDY, rule=rule), a, b)
        st = S.pnl_stats(r2["trips"], a, b, 2 * len(rungs) * 2 * 100.0, (b - a) / DAY)
        same_t, same_p = r1["trips"] == r2["trips"], r1["posts"] == r2["posts"]
        got = (st["trips"], st["pnl_usd"])
        good = same_t and same_p and got == expect[span]
        ok = ok and good
        out[span] = {"trips_identical": same_t, "posts_identical": same_p, "trips": len(r2["trips"]), "posts": len(r2["posts"]),
                     "scored_trips": got[0], "scored_pnl_usd": got[1], "expected": list(expect[span]), "pass": good}
    out["pass"] = ok
    return out


# ------------------------------------------------------------------ the exports
def _lines_of(path):
    f = gzip.open(path, "rt") if path.endswith(".gz") else open(path)
    with f:
        for line in f:
            line = line.rstrip("\n")
            if line:
                yield line


def lines(data, name):
    """data/<name>.txt(.gz), or its pages data/<name>.<i>.txt(.gz) in page order."""
    for ext in (".txt", ".txt.gz"):
        p = os.path.join(data, name + ext)
        if os.path.exists(p):
            yield from _lines_of(p)
            return
    pages = []
    for p in glob.glob(os.path.join(data, name + ".*.txt")) + glob.glob(os.path.join(data, name + ".*.txt.gz")):
        m = re.match(re.escape(name) + r"\.(\d+)\.txt(\.gz)?$", os.path.basename(p))
        if m:
            pages.append((int(m.group(1)), p))
    if not pages:
        raise SystemExit(f"{data}: no {name}.txt and no pages of it")
    for _, p in sorted(pages):
        yield from _lines_of(p)


def fnum(v):
    return float(v) if v != "" else None


def inum(v):
    return int(v) if v != "" else None


def load_prints(data):
    """{book: [(ts, ticks, qty, aggressor, id)]}, ordered by ts, then id compared as a string in code-point order."""
    out = {b: [] for b in BOOKS}
    for line in lines(data, "prints"):
        pid, b, t, px, q, sd = line.split("|")
        out[b].append((int(t), round(float(px) / TICK), float(q), sd, pid))
    for b in out:
        out[b].sort(key=lambda p: (p[0], p[4]))
    return out


def load_minutes(data):
    """{book: {minute ms: row}}; row has source, x, fair_u, prints_n, pr5_prints_n and, for rule D's record, x_d,
    x_source, x_d_t, x_d_read."""
    out = {b: {} for b in BOOKS}
    for line in lines(data, "minutes"):
        v = line.split("|")
        r = {"source": v[2], "x": fnum(v[3]), "fair_u": fnum(v[4]), "prints_n": inum(v[5]), "pr5_prints_n": inum(v[6])}
        if len(v) > 7:
            r.update(x_d=fnum(v[7]), x_source=v[8] or None, x_d_t=inum(v[9]), x_d_read=inum(v[10]))
        out[v[0]][int(v[1])] = r
    return out


TRIP_COLS = ["arm", "key", "book", "side", "k", "t_entry", "fill_ts", "fill_print_id", "entry", "qty", "x_entry", "fair_entry",
             "entry_oid", "t_exit", "exit", "how", "exit_print_id", "exit_oid", "notional_usd", "pnl_usd"]


def load_trips(data, name, arm_first=True):
    """An engine's trips (arm first) or PR5's (no arm, no key): dicts with the simulator's field names where they share one."""
    cols = TRIP_COLS if arm_first else TRIP_COLS[2:]
    out = []
    for line in lines(data, name):
        r = dict(zip(cols, line.split("|")))
        for c in ("k", "entry", "qty", "x_entry", "exit", "notional_usd", "pnl_usd"):
            r[c] = float(r[c])
        r["fair_entry"] = fnum(r["fair_entry"])
        for c in ("t_entry", "fill_ts", "t_exit"):
            r[c] = int(r[c])
        out.append(r)
    return out


def load_events(data):
    """The engine's POSTs, withdrawals and refusals: arm|book|ms|side|k|kind|what|key|ticks|n|why."""
    out = []
    for line in lines(data, "events"):
        a, b, t, sd, k, kind, what, key, tk, n, why = line.split("|")
        out.append({"arm": a, "book": b, "minute": int(t), "side": sd, "k": float(k), "kind": kind, "what": what or None,
                    "key": key or None, "ticks": inum(tk), "n": inum(n), "why": why or None})
    return out


def load_kv(data, name):
    """A one-line payload of key=value pairs, | separated."""
    out = {}
    for line in lines(data, name):
        for kv in line.split("|"):
            k, _, v = kv.partition("=")
            out[k] = v
    return out


def counts_match(meta, loaded):
    """The export is complete: each table's lines equal the count the meta statement took over the same predicate."""
    got = {k: {"meta": int(meta.get(k + "_n", -1)), "loaded": n} for k, n in loaded.items()}
    return {"tables": got, "pass": all(v["meta"] == v["loaded"] for v in got.values())}


def markets(prints, minutes, xfield="x"):
    """The replay's markets: each book's prints and its recorded X (`xfield`) and fairU by minute."""
    return {b: RecMkt(b, [p[:4] for p in prints[b]], {m: (r[xfield], r["fair_u"]) for m, r in minutes[b].items()}) for b in BOOKS}


# ------------------------------------------------------------------ preconditions and the window
def step_minute_unchanged():
    """stepMinute's text at the freeze and as checked out (PR5V §3: its record counts while `stepMinute` is unchanged)."""
    def body(src):
        i = src.index("export function stepMinute(")
        j = src.index("\n}\n", i)
        return src[i:j + 3]
    try:
        then = subprocess.run(["git", "-C", ROOT, "show", f"{FREEZE_PR5V}:{QUOTES_TS}"], capture_output=True, text=True, check=True).stdout
    except Exception as e:  # noqa: BLE001
        return {"checked": False, "why": str(e)[:200]}
    now = open(os.path.join(ROOT, QUOTES_TS)).read()
    a, b = body(then), body(now)
    return {"checked": True, "unchanged": a == b, "sha256_at_freeze": hashlib.sha256(a.encode()).hexdigest(),
            "sha256_now": hashlib.sha256(b.encode()).hexdigest()}


def window(minutes, pr5_last_minute):
    """The window's bounds. With PR5's engine decided to E - 1 min, the pre-registered window, and the record must cover
    every minute of [START, E) on both books. If PR5's engine stopped before that, §3's end rule (GAPS stopped_record)."""
    need = range(START, E, M)
    missing = {b: [m for m in need if m not in minutes[b]] for b in BOOKS}
    n_missing = sum(len(v) for v in missing.values())
    if pr5_last_minute is not None and pr5_last_minute >= E - M:
        if n_missing:
            return {"ok": False, "why": f"PR5's engine decided every minute before E but the record lacks {n_missing} book-minutes "
                                        f"(first {iso(min(min(v) for v in missing.values() if v))}): wait for the engine, or "
                                        f"after {LATEST_DAY} read as soon as it has (a deviation)"}
        return {"ok": True, "w0": W0, "w1": W1, "e": E, "days": (W1 - W0) // DAY, "stopped": False}
    first_gap = min((min(v) for v in missing.values() if v), default=E)
    d, w1 = None, None
    for day in range(W0, W1, DAY):                       # the last day D with every minute before D + 2 days 00:30 covered
        if day + 2 * DAY + 30 * M <= first_gap:
            d = day
    if d is None:
        return {"ok": True, "w0": W0, "w1": W0, "e": W0 + DAY + 30 * M, "days": 0, "stopped": True}
    w1 = d + DAY
    return {"ok": True, "w0": W0, "w1": w1, "e": d + 2 * DAY + 30 * M, "days": (w1 - W0) // DAY, "stopped": True}


def print_count_diffs(prints, minutes, t0, t1):
    """Minutes whose exported print count differs from the count the engine recorded (listed, PR5V condition 1)."""
    out = []
    for b in BOOKS:
        c = collections.Counter(p[0] // M * M for p in prints[b] if t0 <= p[0] < t1)
        for m, r in sorted(minutes[b].items()):
            if t0 <= m < t1 and r["prints_n"] is not None and c.get(m, 0) != r["prints_n"]:
                out.append({"book": b, "minute": iso(m), "exported": c.get(m, 0), "recorded": r["prints_n"]})
    return out


# ------------------------------------------------------------------ the conditions
def in_window(trips, w0, w1):
    return [x for x in trips if w0 <= x["t_entry"] < w1]


def trip_key(x):
    return (x["book"], x["side"], round(x["k"], 10), x["t_entry"], round(x["entry"] / TICK))


def faithful(engine, replay, label_e="engine", label_r="replay"):
    """PR5V condition 1 (and rule D's deviation check): >= 95 % of each set matched in the other, one to one, by book,
    side, k, t_entry and entry ticks, and the two sets' P&L within 10 % of the absolute value of the first's."""
    ce, cr = collections.Counter(map(trip_key, engine)), collections.Counter(map(trip_key, replay))
    matched = sum(min(n, cr[k]) for k, n in ce.items())
    se = matched / len(engine) if engine else None
    sr = matched / len(replay) if replay else None
    pe, pr = sum(x["pnl_usd"] for x in engine), sum(x["pnl_usd"] for x in replay)
    tol = 0.10 * abs(pe)
    ok = se is not None and sr is not None and se >= 0.95 and sr >= 0.95 and abs(pr - pe) <= tol
    unmatched_e = sorted((k for k, n in (ce - cr).items() for _ in range(n)), key=str)[:50]
    unmatched_r = sorted((k for k, n in (cr - ce).items() for _ in range(n)), key=str)[:50]
    return {f"{label_e}_trips": len(engine), f"{label_r}_trips": len(replay), "matched": matched,
            f"share_{label_e}_matched": round(se, 6) if se is not None else None,
            f"share_{label_r}_matched": round(sr, 6) if sr is not None else None,
            f"pnl_{label_e}_usd": round(pe, 6), f"pnl_{label_r}_usd": round(pr, 6), "pnl_diff_usd": round(pr - pe, 6),
            "tolerance_usd": round(tol, 6), "pass": ok,
            f"unmatched_{label_e}_first50": [list(k[:3]) + [iso(k[3]), k[4]] for k in unmatched_e],
            f"unmatched_{label_r}_first50": [list(k[:3]) + [iso(k[3]), k[4]] for k in unmatched_r]}


def null_twins_to(e_ms):
    """study.null_twins with each twin run to min(E, m + 2 days) in place of min(N1, m + 2 days): its own source, that
    one expression replaced (asserted to occur once), compiled in study.py's namespace."""
    src = inspect.getsource(S.null_twins)
    old = "min(N1, m + 2 * DAY)"
    assert src.count(old) == 1, "null_twins changed"
    ns = dict(vars(S))
    ns["E_READING"] = e_ms
    exec(compile(src.replace(old, "min(E_READING, m + 2 * DAY)"), S.__file__ + " [reading: E for N1]", "exec"), ns)
    return ns["null_twins"]


def above_null(R, mkts, rungs, trips, w0, w1, e):
    """PR5V condition 2: the window's P&L above the p95 of the variant's own random-time null, called as
    null_twins(Runner(), markets, {"reprice": 0.0003}, rungs, trips, w0, w1), 2,000 draws, seed 20260923, each twin run
    to min(E, m + 2 days)."""
    nt = null_twins_to(e)
    res = nt(R, mkts, {"reprice": 0.0003}, rungs, trips, w0, w1, draws=NULL_DRAWS, seed=NULL_SEED)
    act = sum(x["pnl_usd"] for x in trips if w0 <= x["t_entry"] < w1)
    res.update(window_pnl_usd=round(act, 6), **{"pass": act > res["p95"]})
    return res


def paired(a_trips, b_trips, w0, w1, seed):
    """Conditions 3: the daily difference a - b by UTC day of entry (`daily` of study.py), 10,000 resamples of circular
    7-day blocks (`block_bootstrap`), the share of resampled means at or below 0 under 0.05."""
    da, db = S.daily(a_trips, w0, w1), S.daily(b_trips, w0, w1)
    diff = [x - y for x, y in zip(da, db)]
    bb = S.block_bootstrap(diff, BOOT_BLOCK, n=BOOT_N, seed=seed)
    return {"days": len(diff), "a_daily": da, "b_daily": db, "diff_daily": [round(x, 6) for x in diff],
            "better_days": sum(1 for x in diff if x > 1e-9), "bootstrap": bb, "pass": bb["p_le_0"] < 0.05}


POST_KINDS = ("order", "stop")
ENTRY_WHAT = ("place", "reprice", "replace")


def governor(events, arm, gov):
    """Condition 5: in the engine's record, every entry POST of a key had fewer than `entry_at` POSTs of that key before it
    on that UTC day, and every other POST but a stop fewer than `stop_at`, stops counted (GAPS governor_order)."""
    by = collections.defaultdict(list)
    for e in events:
        if e["arm"] == arm and e["kind"] in POST_KINDS:
            by[(e["key"], e["minute"] // DAY)].append(e)
    bad_recount, bad_n, n_mismatch, per_day = [], [], 0, {}
    for (key, day), lst in sorted(by.items()):
        lst.sort(key=lambda e: (e["minute"], e["kind"] == "stop", e["k"]))
        for i, e in enumerate(lst):
            if e["n"] is not None and e["n"] != i + 1:
                n_mismatch += 1
            for before, sink in ((i, bad_recount), ((e["n"] - 1) if e["n"] is not None else i, bad_n)):
                if e["what"] in ENTRY_WHAT and before >= gov["entry_at"]:
                    sink.append([key, iso(e["minute"]), e["what"], before])
                elif e["kind"] != "stop" and e["what"] not in ENTRY_WHAT and before >= gov["stop_at"]:
                    sink.append([key, iso(e["minute"]), e["what"], before])
        per_day[f"{key} {datetime.datetime.fromtimestamp(day * 86400, datetime.timezone.utc).date()}"] = len(lst)
    return {"limits": gov, "key_days": len(by), "max_posts_key_day": max(per_day.values(), default=0),
            "violations_recount": bad_recount[:50], "violations_by_detail_n": bad_n[:50],
            "detail_n_disagrees_with_recount": n_mismatch, "pass": not bad_recount and not bad_n}


# ------------------------------------------------------------------ described, never judged
def by_group(trips, field):
    g = collections.defaultdict(list)
    for x in trips:
        g[str(x[field]) if field != "k" else f"{x['k'] * 100:g}%"].append(x)
    return {k: {"trips": len(v), "won": sum(1 for x in v if x["pnl_usd"] > 0),
                "win_rate": round(sum(1 for x in v if x["pnl_usd"] > 0) / len(v), 4),
                "taker_exits": sum(1 for x in v if x["how"] != "maker"), "pnl_usd": round(sum(x["pnl_usd"] for x in v), 6)}
            for k, v in sorted(g.items())}


def trips_table(trips, capital, days):
    tot = sum(x["pnl_usd"] for x in trips)
    return {"trips": len(trips), "pnl_usd": round(tot, 6), "usd_per_day": round(tot / days, 6) if days else None,
            "pct_per_year_on_capital": round(100 * tot / capital * 365 / days, 4) if days else None, "capital_usd": capital,
            "won": sum(1 for x in trips if x["pnl_usd"] > 0),
            "win_rate": round(sum(1 for x in trips if x["pnl_usd"] > 0) / len(trips), 4) if trips else None,
            "taker_exits": sum(1 for x in trips if x["how"] != "maker"),
            "by_book": by_group(trips, "book"), "by_side": by_group(trips, "side"), "by_rung": by_group(trips, "k"),
            "fills_per_rung": dict(sorted(collections.Counter(f"{x['book']} {x['side']} {x['k'] * 100:g}%" for x in trips).items()))}


def last_step_closes(trips, e):
    """Trips the replay closed at its last step (the minute before E): the pre-registration allows none among the
    trips it scores."""
    return [[x["book"], x["side"], x["k"], iso(x["t_entry"])] for x in trips if x["t_exit"] >= e - M]


def post_tables(events, arm, w0, w1):
    """POSTs a key a day, the most a key sent at one decided minute (stops included), and the key-days on which the
    governor withdrew entries, with the first withdrawal's minute."""
    posts = [e for e in events if e["arm"] == arm and e["kind"] in POST_KINDS and w0 <= e["minute"] < w1]
    per = collections.Counter((e["key"], iso(e["minute"] // DAY * DAY)[:10]) for e in posts)
    turn = collections.Counter((e["key"], e["minute"]) for e in posts)
    top = min(turn.items(), key=lambda kv: (-kv[1], kv[0][1], kv[0][0]), default=(None, 0))   # the most; then the earliest, then by key
    gw = collections.defaultdict(list)
    for e in events:
        if e["arm"] == arm and e["kind"] == "withdraw" and e["why"] == "governor" and w0 <= e["minute"] < w1:
            gw[(e["key"], iso(e["minute"] // DAY * DAY)[:10])].append(e["minute"])
    return {"posts_per_key_day": {f"{k} {d}": n for (k, d), n in sorted(per.items())},
            "most_posts_one_key_one_turn": {"posts": top[1], "key": top[0][0] if top[0] else None,
                                            "minute": iso(top[0][1]) if top[0] else None, "venue_limit_per_second": 10},
            "governor_withdrawal_key_days": {f"{k} {d}": {"withdrawals": len(v), "first": iso(min(v))} for (k, d), v in sorted(gw.items())}}


def first_live_split(a_trips, b_trips, first_live_ms, w0, w1):
    """The window's days from PR5's first live order, apart, and the days before it (GAPS first_live_split)."""
    if first_live_ms is None or first_live_ms >= w1:
        return {"first_live_order": iso(first_live_ms) if first_live_ms else None, "applies": False}
    cut = max(w0, first_live_ms // DAY * DAY)
    out = {"first_live_order": iso(first_live_ms), "applies": True, "split_day": iso(cut)[:10]}
    for name, (a, b) in (("before", (w0, cut)), ("from", (cut, w1))):
        pa = sum(x["pnl_usd"] for x in a_trips if a <= x["t_entry"] < b)
        pb = sum(x["pnl_usd"] for x in b_trips if a <= x["t_entry"] < b)
        out[name] = {"days": (b - a) // DAY, "arm_pnl_usd": round(pa, 6), "against_pnl_usd": round(pb, 6), "diff_usd": round(pa - pb, 6)}
    return out


def write(path, obj):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w") as f:
        json.dump(obj, f, indent=1, sort_keys=True, default=str)
        f.write("\n")
