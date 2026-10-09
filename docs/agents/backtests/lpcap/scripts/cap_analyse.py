# LPCAP's table (results/cap_analysis.txt): each arm of cap_run.ts on each record and fill model, per day, at R = 1, 0.4
# and 0.2 (a day's total at R is its fills' P&L plus R x its formula reward), the return a day on the capital, the
# capital it used (peak and mean of holdings at cost and resting buys), our share of the pools it sat in, the POSTs a day
# the counter estimates, and the marginal return of each step up in capital. Run from this folder: python3 -I scripts/cap_analyse.py
import json, os
CAPS = [320, 640, 1000, 2000, 5000, 10000]
def load(n):
    p = f"results/cap_{n}.json"
    return json.load(open(p)) if os.path.exists(p) else None
def row(a, R):
    d = a["daily"]; n = len(d)
    tot = sum(x["tot"] - (1 - R) * x["rew"] for x in d)
    return tot / n
for name in ["rw", "rw_atprice", "pr", "pr_atprice"]:
    o = load(name)
    if o is None: print(f"== {name}: not run"); continue
    n = len(o["L1"]["daily"])
    print(f"== {name}: {n} days, {o['L1']['daily'][0]['day']} -> {o['L1']['daily'][-1]['day']}")
    print(f"{'arm':<16}{'mk/day':>7}{'$/d R1':>9}{'R.4':>8}{'R.2':>8}{'%/d R.4':>9}{'%/d R1':>8}{'peak':>8}{'mean':>8}{'use%':>6}{'share':>7}{'posts/d':>9}{'capW/d':>8}{'stop':>5}")
    def line(k, C):
        a = o[k]; d = a["daily"]
        rew = sum(x["rew"] for x in d); pool = sum(x["pool"] for x in d)
        peak = max(x["comMax"] for x in d); mean = sum(x["comMean"] for x in d) / len(d)
        r1, r4, r2 = row(a, 1), row(a, 0.4), row(a, 0.2)
        print(f"{k:<16}{a['chosenPerDay']:>7.1f}{r1:>9.2f}{r4:>8.2f}{r2:>8.2f}{100*r4/C:>8.2f}%{100*r1/C:>7.2f}%{peak:>8.0f}{mean:>8.0f}{100*mean/C:>5.0f}%{(rew/pool if pool else 0):>7.3f}{sum(x['posts'] for x in d)/len(d):>9.0f}{sum(x['capWithheld'] for x in d)/len(d):>8.0f}{sum(1 for x in d if x['stop']):>5}")
        return r1, r4
    line("L1", 320)
    for e in ["L1 equity R.4", "L1 equity R1"]:
        line(e, 320)
        caps = [round(x["capTotal"]) for x in o[e]["daily"]]
        print(f"{'':<16}cap at each day's close: {caps}")
    res = {}
    for pol in ["cap", "mkts", "size", "both"]:
        print(f"-- {pol}")
        res[pol] = [line(f"{pol} {C}", C) for C in CAPS]
        m = []
        for i in range(1, len(CAPS)):
            dC = CAPS[i] - CAPS[i - 1]
            m.append(f"{CAPS[i-1]}->{CAPS[i]}: R1 {100*(res[pol][i][0]-res[pol][i-1][0])/dC:+.2f}% R.4 {100*(res[pol][i][1]-res[pol][i-1][1])/dC:+.2f}%")
        print("   marginal $/day per $ added: " + "; ".join(m))
