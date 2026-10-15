"""One resume of the September keyset from the cursor that Cloudflare 403'd.

Same page size (60), same User-Agent, same address. The marker is written
before the request, so a second run does not send it again. A 403 quarantines
the cursor and stops. Nothing here changes the request to get past the block.

usage: python3 -I -u docs/agents/backtests/pmstatarb/scripts/g1_retry_once.py
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import g1_pull  # noqa: E402

NAME = "2026-09"
START = "2026-09-01T00:00:00Z"
END = "2026-10-01T00:00:00Z"


def main():
    scratch = g1_pull.SCRATCH
    os.makedirs(scratch, exist_ok=True)
    marker = os.path.join(scratch, "2026-09.retry_once")
    if os.path.exists(marker):
        raise SystemExit("retry already attempted; not sending again")
    tmp = os.path.join(scratch, NAME + ".p60.jsonl.partial")
    blocked = tmp + ".cursor.json.blocked"
    live = tmp + ".cursor.json"
    if not os.path.exists(tmp) or not os.path.exists(blocked):
        raise SystemExit("no quarantined September cursor; not inventing a request")
    if os.path.exists(live):
        raise SystemExit("a live cursor is already on disk; not sending a second one")
    with open(marker, "w") as f:
        f.write(time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()) + "\n")
    os.replace(blocked, live)
    print("September retry once, limit 60, from the quarantined cursor", flush=True)
    try:
        g1_pull._pull_pages(NAME, START, END, 60, "p60")
    except RuntimeError as e:
        if "HTTP 403" in str(e) or "STOP 403" in str(e):
            print("retry blocked again; stopped", flush=True)
            sys.exit(2)
        raise
    print("September finished. October tail at limit 100, same client.", flush=True)
    try:
        g1_pull._pull_pages("2026-10-tail", "2026-10-01T00:00:00Z", "2026-10-04T00:00:00Z", 100, "")
    except RuntimeError as e:
        if "HTTP 403" in str(e) or "STOP 403" in str(e):
            print("October tail blocked; stopped without another page size", flush=True)
            sys.exit(2)
        raise


if __name__ == "__main__":
    main()
