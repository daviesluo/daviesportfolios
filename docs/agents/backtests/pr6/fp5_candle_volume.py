"""fp5's pass-76 hourly UK candles (read from git): hours, hours with volume, base volume per day. No prices read."""
import json, subprocess, datetime

REPO = "/home/user/daviesportfolios/.claude/worktrees/agent-ae3a8957301d1380a"
for sym in ("USDC-USD", "USDT-USD"):
    raw = subprocess.run(["git", "-C", REPO, "show", f"origin/cursor/revolut-x-search-d133:docs/agents/backtests/inputs/fp5_2026-09-25/pass76/{sym}_60.json"],
                         capture_output=True, check=True).stdout
    d = json.loads(raw)
    rows = d["rows"] if isinstance(d, dict) and "rows" in d else (d["data"] if isinstance(d, dict) and "data" in d else d)
    vol = [(int(r["start"]), float(r["volume"])) for r in rows]
    vol.sort()
    t0, t1 = vol[0][0], vol[-1][0] + 3600000
    days = (t1 - t0) / 86400000
    first = next(t for t, v in vol if v > 0)
    days_since = (t1 - first) / 86400000
    tot = sum(v for _, v in vol)
    print(sym, "hours", len(vol), "with volume", sum(1 for _, v in vol if v > 0),
          "span days", round(days, 1), "base volume/day over span", round(tot / days),
          "first hour with volume", datetime.datetime.fromtimestamp(first / 1000, datetime.timezone.utc).isoformat(),
          "base volume/day since then", round(tot / days_since))
