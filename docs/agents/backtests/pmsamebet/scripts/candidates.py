"""PMSAMEBET step 3: candidate same-bet pairs across DIFFERENT events, by text similarity.

TF-IDF over the words of each market's question (plus its group title), cosine between markets of different events,
pairs at cosine >= 0.5 kept. Each pair is labelled by the words that differ:
  same_text     no word differs (a duplicate listing, or the same question in two events)
  num_only      only numbers differ (a strike or date ladder split across events: an inequality, not an identity)
  other         anything else (ranked by cosine for the hand check)
Writes $PM_DATA/candidates.jsonl and results/candidates_summary.txt (counts, the top pairs by liquidity).

usage: PM_DATA=<scratch> python3 -I docs/agents/backtests/pmsamebet/scripts/candidates.py <results dir>
"""
import json
import math
import os
import re
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pmnet  # noqa: E402

STOP = set("""will the be a an of in on by to for at is are as or and with from than this that its it any
who which what when does do did has have between after before during more less over under than""".split())
MONTHS = "january february march april may june july august september october november december".split()
TOK = re.compile(r"[a-z]+|\d[\d,]*(?:\.\d+)?")


def tokens(text):
    out = []
    for t in TOK.findall((text or "").lower().replace("’", "'")):
        if t in STOP:
            continue
        out.append(t.replace(",", ""))
    return out


def is_num(t):
    return t[0].isdigit() or t in MONTHS or t in ("k", "m", "b", "pm", "am", "et", "q1", "q2", "q3", "q4")


def main():
    res = sys.argv[1]
    M = [json.loads(x) for x in open(os.path.join(pmnet.DATA, "universe.jsonl"))]
    docs = [tokens(m["question"]) for m in M]
    df = Counter()
    for d in docs:
        df.update(set(d))
    N = len(docs)
    idf = {t: math.log(N / c) for t, c in df.items()}
    vecs = []
    for d in docs:
        tf = Counter(d)
        v = {t: (1 + math.log(c)) * idf[t] for t, c in tf.items()}
        n = math.sqrt(sum(x * x for x in v.values())) or 1.0
        vecs.append({t: x / n for t, x in v.items()})
    # inverted index on the rarer words only, so common words do not make every pair a candidate
    inv = defaultdict(list)
    for i, d in enumerate(docs):
        for t in set(d):
            if df[t] <= 400 and not is_num(t):
                inv[t].append(i)
    pairs = {}
    for t, lst in inv.items():
        if len(lst) < 2:
            continue
        for a_i in range(len(lst)):
            a = lst[a_i]
            for b in lst[a_i + 1:]:
                if M[a]["eid"] == M[b]["eid"]:
                    continue
                key = (a, b)
                if key in pairs:
                    continue
                va, vb = vecs[a], vecs[b]
                if len(va) > len(vb):
                    va, vb = vb, va
                cos = sum(x * vb.get(k, 0.0) for k, x in va.items())
                pairs[key] = cos
    kept = [(k, c) for k, c in pairs.items() if c >= 0.5]
    lab = Counter()
    with open(os.path.join(pmnet.DATA, "candidates.jsonl"), "w") as f:
        rows = []
        for (a, b), c in kept:
            sa, sb = set(docs[a]), set(docs[b])
            diff = sa ^ sb
            kind = "same_text" if not diff else ("num_only" if all(is_num(t) for t in diff) else "other")
            lab[kind] += 1
            r = {"cos": round(c, 4), "kind": kind, "diff": sorted(diff),
                 "a": {k: M[a].get(k) for k in ("conditionId", "question", "eslug", "endDate", "liquidityNum", "volume24hr", "bestBid", "bestAsk", "negRisk")},
                 "b": {k: M[b].get(k) for k in ("conditionId", "question", "eslug", "endDate", "liquidityNum", "volume24hr", "bestBid", "bestAsk", "negRisk")}}
            r["minliq"] = min(M[a].get("liquidityNum") or 0, M[b].get("liquidityNum") or 0)
            rows.append(r)
            f.write(json.dumps(r, sort_keys=True) + "\n")
    with open(os.path.join(res, "candidates_summary.txt"), "w") as f:
        f.write(f"universe markets {N}; pairs scored {len(pairs)}; pairs cos>=0.5 {len(kept)}\n")
        for k, v in sorted(lab.items()):
            f.write(f"  {k}: {v}\n")
        for kind in ("same_text", "other"):
            f.write(f"\n== top {kind} pairs by the smaller liquidity (cos>=0.75) ==\n")
            sel = sorted((r for r in rows if r["kind"] == kind and r["cos"] >= 0.75), key=lambda r: -r["minliq"])[:80]
            for r in sel:
                f.write(f"{r['cos']:.3f} liq {r['minliq']:.0f} diff={r['diff'][:6]}\n  A [{r['a']['eslug']}] {r['a']['question']} | end {r['a']['endDate']} bid/ask {r['a']['bestBid']}/{r['a']['bestAsk']}\n  B [{r['b']['eslug']}] {r['b']['question']} | end {r['b']['endDate']} bid/ask {r['b']['bestBid']}/{r['b']['bestAsk']}\n")
    print(lab, len(kept))


if __name__ == "__main__":
    main()
