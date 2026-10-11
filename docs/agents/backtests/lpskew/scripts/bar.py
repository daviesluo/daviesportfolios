"""LP-SKEW-FT bar (frozen). Usage: python3 bar.py days.json marks.json
days.json: rows of sql/readout.sql's first statement; marks.json: rows of its second."""
import json, sys, random, bisect, datetime as dt
from collections import defaultdict

R = 0.737          # live-prep's pooled R (paid / formula), 2026-10-11
ARMS = ("base", "cap40", "skew")

def main(days_path, marks_path):
    days = json.load(open(days_path)); marks = json.load(open(marks_path))
    by = defaultdict(dict)
    for r in days: by[r["arm"]][str(r["day"])[:10]] = r
    D = sorted(set(by["base"]) & set(by["cap40"]) & set(by["skew"]))
    net = {a: [] for a in ARMS}
    for a in ARMS:
        prev = 0.0
        for d in D:
            m = float(by[a][d]["marked_usd"])
            net[a].append(m - prev + R * float(by[a][d]["formula_usd"])); prev = m
    settled = sum(int(by["base"][d]["settled"]) for d in D)
    mids = defaultdict(lambda: ([], []))
    for r in marks: mids[r["cond"]][0].append(int(r["t"])); mids[r["cond"]][1].append(float(r["mid"]))
    def mid(c, t):
        T, M = mids[c]; i = bisect.bisect_right(T, t) - 1
        return M[i] if i >= 0 else None
    out = {"days": D, "settled_base": settled, "arms": {}}
    for a in ARMS:
        adv = []; sh = 0.0
        for d in D:
            for t, c, side, p, z in by[a][d]["detail"]["fills"]:
                t0 = int(dt.datetime.fromisoformat(t.replace("Z", "+00:00")).timestamp())
                m60 = mid(c, t0 + 3600)
                if m60 is None: continue
                sgn = 1 if side == "B" else -1
                adv.append(sgn * (m60 - p) * z); sh += z
        out["arms"][a] = {"net": round(sum(net[a]), 2), "formula": round(sum(float(by[a][d]["formula_usd"]) for d in D), 2),
                          "markout60_per_share": round(sum(adv) / sh, 5) if sh else None,
                          "killed": any(by[a][d]["killed_at"] for d in D)}
    rng = random.Random(20261019)
    for a in ("cap40", "skew"):
        diff = [x - y for x, y in zip(net[a], net["base"])]
        s = sorted(sum(rng.choice(diff) for _ in diff) / len(diff) for _ in range(2000))
        best = max(range(len(diff)), key=lambda i: diff[i])
        rest = [x for i, x in enumerate(diff) if i != best]
        out["arms"][a]["p5_daily_diff"] = round(s[100], 4)
        out["arms"][a]["mean_without_best_day"] = round(sum(rest) / len(rest), 4) if rest else None
        out["arms"][a]["pass_net"] = bool(s[100] > 0 and rest and sum(rest) > 0)
    b, k = out["arms"]["base"], out["arms"]["skew"]
    out["H1"] = bool(b["markout60_per_share"] is not None and k["markout60_per_share"] is not None and b["markout60_per_share"] < 0
                     and k["markout60_per_share"] >= 0.7 * b["markout60_per_share"])
    out["H2"] = bool(b["formula"] > 0 and k["formula"] >= 0.75 * b["formula"])
    out["enough"] = bool(len(D) >= 7 and settled >= 3)
    print(json.dumps(out, indent=1))

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
