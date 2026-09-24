"""PR5's paper engine against the frozen simulator, minute by minute, on its first evening (2026-09-23 15:09 → 24:00).

The live design (reviews/2026-09-24-pr5-live-design.md, `paperPeriodPredicted` in pr5_live.json) predicted 128 orders for
this window; the engine recorded 116. This replays `docs/agents/scripts/pr5/pr5_sim.py` UNCHANGED (hash checked) on the
inputs the design pulled into `inputs/` and counts the orders placed in each minute, then sets them beside the engine's.

Its inputs are the engine's: agent_quote_inputs and agent_quote_prints match `inputs/` hour by hour (prints: count, ticks
and quantity per book; the USD books' hourly closes: 34 rows, same sums; GBP/USD: every minute but 20:52, which the pull
has as a null close and the engine stored at 1.323994755744934, the 20:51 value, so X is the same either way). The one
minute is added here so the replay runs on exactly what the engine stored.

The engine's side is agent_quote_events, read 2026-09-24 21:49:42 UTC (the database's clock) with
    select book, to_char(minute, 'HH24:MI') m, count(*) from public.agent_quote_events
    where kind = 'order' and minute >= '2026-09-23 15:09' and minute < '2026-09-24 00:00' group by 1, 2;
Each of its 116 order events also carries the X and fair it used; all 116 equal what the stored inputs give.

usage: python3 docs/agents/backtests/pr5_live/reconcile_first_day.py   (writes reconcile_first_day.json beside it)
"""
import datetime, gzip, hashlib, json, os, shutil, statistics as st, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "../../../.."))
SIM_DIR = os.path.join(ROOT, "docs/agents/scripts/pr5")
FROZEN_SIM_SHA = "56fbad85ee4df6292f596188d091ad064d030180f33cefe3bd09089d7e772a1a"
sys.path.insert(0, SIM_DIR)
import pr5_sim as P   # noqa: E402

sim_sha = hashlib.sha256(open(os.path.join(SIM_DIR, "pr5_sim.py"), "rb").read()).hexdigest()
if sim_sha != FROZEN_SIM_SHA:
    raise SystemExit("pr5_sim.py is not the committed frozen copy")

M, H = P.M, 3600000
utc = lambda *a: int(datetime.datetime(*a, tzinfo=datetime.timezone.utc).timestamp() * 1000)
hhmm = lambda ms: datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone.utc).strftime("%H:%M")
T0, T1 = utc(2026, 9, 23, 15, 9), utc(2026, 9, 24, 0, 0)
ENGINE_FX_ONLY = {utc(2026, 9, 23, 20, 52): 1.323994755744934}
ENGINE = {
    "USDC-GBP": {"15:09": 6, "15:33": 6, "16:32": 6, "16:50": 6, "16:53": 6, "17:07": 5, "17:23": 6, "17:43": 6, "17:47": 6, "18:24": 6},
    "USDT-GBP": {"15:09": 6, "15:33": 6, "16:32": 6, "16:50": 6, "16:53": 5, "17:07": 5, "17:23": 5, "17:43": 6, "17:47": 6, "18:24": 6},
}

IN = os.path.join(HERE, "inputs")
g = lambda n: json.load(gzip.open(os.path.join(IN, n + ".json.gz"), "rt"))
fresh_prints, usd_h = g("revx_gbp_prints")["prints"], g("revx_usd_hourly")["series"]
yahoo = g("yahoo_gbpusd_1m")["chart"]["chart"]["result"][0]

# The same data folder pr5_live_design.py builds for its paper-period prediction, plus the engine's one extra FX minute.
tmp = tempfile.mkdtemp(prefix="pr5_reconcile_")
out = {"frozenSimSha256": sim_sha, "window": {"from": "2026-09-23T15:09Z", "to": "2026-09-24T00:00Z"}}
try:
    for d in ("trades", "fx", "candles"):
        os.makedirs(os.path.join(tmp, "data", d))
    shutil.copy(os.path.join(P.S, "config.json"), os.path.join(tmp, "config.json"))
    for b in P.BOOKS:
        rows = {}
        for line in gzip.open(os.path.join(P.S, "trades", b + ".jsonl.gz"), "rt"):
            r = json.loads(line); rows[r["id"]] = r
        for r in fresh_prints[b]:
            rows[r["id"]] = r
        with open(os.path.join(tmp, "data", "trades", b + ".jsonl"), "w") as f:
            for r in sorted(rows.values(), key=lambda z: (z["ts"], z["id"])):
                f.write(json.dumps(r, sort_keys=True) + "\n")
    hours = {}
    for s in ("USDC-USD", "USDT-USD"):
        base = json.load(gzip.open(os.path.join(P.S, "candles", s + "_60.json.gz"), "rt"))
        rows = {int(r["start"]): r for r in base["rows"]}
        for r in usd_h[s]:
            rows[int(r["start"])] = r
        hours[s] = [(k, float(rows[k]["close"])) for k in sorted(rows)]
        json.dump({"rows": [rows[k] for k in sorted(rows)]}, open(os.path.join(tmp, "data", "candles", s + "_60.json"), "w"))
    exn = json.load(gzip.open(os.path.join(P.S, "fx", "series_EXN.json.gz"), "rt"))
    fx = {t * 1000: c for t, c in zip(yahoo["timestamp"], yahoo["indicators"]["quote"][0]["close"]) if c is not None and t * 1000 > exn[-1][0]}
    fx.update(ENGINE_FX_ONLY)
    json.dump(exn + sorted([t, c] for t, c in fx.items()), open(os.path.join(tmp, "data", "fx", "series_EXN.json"), "w"))
    P.S = tmp
    fxmap = P.fx_series()

    # Orders placed in each minute: the simulator is causal, so a run ending after minute m has placed exactly the
    # orders of minutes up to m, and the count's step from one end to the next is minute m's.
    replay = {}
    for b in P.BOOKS:
        prev, per = 0, {}
        for end in range(T0 + M, T1 + M, M):
            n = sum(P.simulate(P.Book(b, T0, end, fxmap), size=100.0)[1].values())
            if n != prev:
                per[hhmm(end - M)] = n - prev
            prev = n
        replay[b] = per
    diffs = [{"book": b, "minute": m, "replay": replay[b].get(m, 0), "engine": ENGINE[b].get(m, 0)}
             for b in P.BOOKS for m in sorted(set(replay[b]) | set(ENGINE[b])) if replay[b].get(m, 0) != ENGINE[b].get(m, 0)]
    first_diff = min((d["minute"] for d in diffs), default=None)
    out["orders"] = {
        "replay": replay, "engine": ENGINE,
        "totals": {"replay": sum(sum(v.values()) for v in replay.values()), "engine": sum(sum(v.values()) for v in ENGINE.values())},
        "identicalBefore": first_diff, "differences": diffs,
    }

    # Why the replay re-prices USDT-GBP at 21:48: fair against the price its quotes were set at (18:24), and how narrowly.
    B = P.Book("USDT-GBP", T0, T1, fxmap)
    i = lambda t: (t - T0) // M
    f_at, t48 = B.F[i(utc(2026, 9, 23, 18, 24))], utc(2026, 9, 23, 21, 48)
    x47 = B.X[i(t48)]
    in_window = [c for s, c in hours["USDT-USD"] if t48 - 24 * H <= s <= t48 - H]
    no_2000 = [c for s, c in hours["USDT-USD"] if t48 - 24 * H <= s <= t48 - H and s != utc(2026, 9, 23, 20, 0)]
    bps = lambda f: round((f / f_at - 1) * 1e4, 3)
    out["usdtAt2148"] = {
        "fairAtLastReprice": round(f_at, 8), "repriceStepBps": P.REPRICE * 1e4,
        "x2147": x47, "fairU": st.median(in_window), "hoursInWindow": len(in_window),
        "fairBpsFromPriced": bps(st.median(in_window) / x47),
        "fairBpsWithout2000Candle": bps(st.median(no_2000) / x47), "fairUWithout2000Candle": st.median(no_2000),
        "fairBpsByTurn": {hhmm(t): bps(B.F[i(t)]) for t in range(utc(2026, 9, 23, 21, 40), utc(2026, 9, 23, 22, 1), M) if B.F[i(t)]},
    }
finally:
    shutil.rmtree(tmp, ignore_errors=True)

json.dump(out, open(os.path.join(HERE, "reconcile_first_day.json"), "w"), indent=1, sort_keys=True)
print(json.dumps({"totals": out["orders"]["totals"], "identicalBefore": out["orders"]["identicalBefore"], "differences": out["orders"]["differences"],
                  "usdtAt2148": {k: v for k, v in out["usdtAt2148"].items() if k != "fairBpsByTurn"}}))
