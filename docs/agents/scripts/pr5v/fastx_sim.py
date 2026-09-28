"""PR5v fast-X engine: `pr5v_sim.simulate` (frozen, sha256 54ad4198...) with two additions and nothing else.

The function below is not retyped. It is `pr5v_sim.simulate`'s own source, read from the frozen file, with the
replacements in EDITS applied (each must match exactly once, or the import fails), compiled in pr5v_sim's own namespace.
So the diff from the frozen engine is exactly EDITS:

1. **A key per rung.** `cfg["acct_k"](book, side, k)`, when given, names the key of each rung (8 and 16 keys split a
   book-side's nine rungs); otherwise `cfg["acct"](book, side)` as frozen. A rung's exits and stops go on its key.
2. **A re-price rule for entry quotes.** `cfg["rule"]` = {"frac": f, "away": a} or None. With a rule, an entry quote
   priced at fair fa is re-priced (and a refused one re-targeted) when fair has moved TOWARD it by more than
   max(R, f * k), or AWAY from it by more than max(that, a) when a is given, else by the same step. For a bid, toward is
   down; for an ask, up. Exits keep the frozen step R. `rule=None` is the frozen `abs(f / fa - 1) > R`, the same
   expression, and the fast path's bounds are the frozen ones.

With neither addition in use it is the frozen engine: `test_fastx.py` runs both on the committed inputs and compares
every trip and every POST.
"""
import hashlib, inspect, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import pr5v_sim as V  # noqa: E402

FROZEN_SHA = "54ad41982d143758ece6ee8e5bb48d5a4aafe1dc0429ccc0af6d1c57282de27a"
assert hashlib.sha256(open(os.path.join(HERE, "pr5v_sim.py"), "rb").read()).hexdigest() == FROZEN_SHA, "pr5v_sim.py changed"

EDITS = [
    # 1. keys per rung
    ("    books = [BookState(mk, bi, cfg) for bi, mk in enumerate(mkts)]\n",
     "    books = [_keyed(BookState(mk, bi, cfg), cfg) for bi, mk in enumerate(mkts)]\n"),
    # 2a. the rule, read once
    ("    R = cfg[\"reprice\"]\n",
     "    R = cfg[\"reprice\"]\n    rule = cfg.get(\"rule\")\n"),
    # 2b. a refused entry quote is re-targeted by the rule
    ("                    if abs(f / o.fair_at - 1) > R:\n"
     "                        o.price, o.fair_at = rt(f, r.k, r.side), f\n",
     "                    if _moved(rule, R, r, o.fair_at, f):\n"
     "                        o.price, o.fair_at = rt(f, r.k, r.side), f\n"),
    # 2c. a resting or pending entry quote is re-priced by the rule
    ("                if abs(f / o.fair_at - 1) > R:\n"
     "                    if full or \"reprice\" in fast:\n"
     "                        reprice(bk, r, o, rt(f, r.k, r.side), f, tau, \"reprice\")\n",
     "                if _moved(rule, R, r, o.fair_at, f):\n"
     "                    if full or \"reprice\" in fast:\n"
     "                        reprice(bk, r, o, rt(f, r.k, r.side), f, tau, \"reprice\")\n"),
    # 2d. the fast path's bounds follow the rule
    ("                a = fa * (1 - R) * (1 + 1e-12)\n"
     "                b = fa * (1 + R) * (1 - 1e-12)\n",
     "                sd, su = _steps(rule, R, r)\n"
     "                a = fa * (1 - sd) * (1 + 1e-12)\n"
     "                b = fa * (1 + su) * (1 - 1e-12)\n"),
]


def _keyed(bk, cfg):
    fn = cfg.get("acct_k")
    if fn is not None:
        for r in bk.rungs:
            r.acct = fn(bk.mk.book, r.side, r.k)
    return bk


def _steps(rule, R, r):
    """(down, up): the moves of fair, as fractions, that re-price r's order. Exits and rule=None: (R, R)."""
    if rule is None or r.mode != "quote":
        return R, R
    toward = max(R, rule.get("frac", 0.0) * r.k)
    away = max(toward, rule["away"]) if rule.get("away") is not None else toward
    return (toward, away) if r.side == "bid" else (away, toward)


def _moved(rule, R, r, fa, f):
    if rule is None:
        return abs(f / fa - 1) > R
    sd, su = _steps(rule, R, r)
    x = f / fa - 1
    return x < -sd or x > su


def _build():
    src = inspect.getsource(V.simulate)
    for old, new in EDITS:
        n = src.count(old)
        assert n == 1, (n, old)
        src = src.replace(old, new)
    ns = dict(vars(V))
    ns.update(_keyed=_keyed, _steps=_steps, _moved=_moved)
    exec(compile(src, os.path.join(HERE, "pr5v_sim.py") + " [fastx_sim EDITS]", "exec"), ns)
    return ns["simulate"], src, ns


simulate, SOURCE, NS = _build()          # NS: the function's globals (the tests swap a helper there to break it on purpose)
default_cfg = V.default_cfg
