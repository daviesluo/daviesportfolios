"""G1: every resolved BTC/ETH reach, dip, above/below and price-bucket market.

Gamma `/markets/keyset`, `closed=true`, ordered by id, one end-date month at a
time (2024-01 through 2026-09, plus 2026-10-01..04 so a 30 September title
whose endDate falls on 1 October is kept). Never `order=volume` and never an
offset. Candidates are filtered in code; a candidate that does not parse is
written to unparsed.csv with a reason.

Raw pages are not committed. $PM_DATA/g1 holds one JSONL per month so a
re-run resumes. The CSVs are rewritten from those lines.

usage: python3 -I -u docs/agents/backtests/pmstatarb/scripts/g1_pull.py
"""
import csv
import json
import os
import sys
import time
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import g1_lib  # noqa: E402
import net  # noqa: E402

GAMMA = "https://gamma-api.polymarket.com"
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(HERE, "data")
RESULTS = os.path.join(HERE, "results")
SCRATCH = os.path.join(net.DATA, "g1")

# (name, end_date_min, end_date_max). The max is exclusive, matching Gamma's window.
WINDOWS = []
y, m = 2024, 1
while (y, m) <= (2026, 9):
    y2, m2 = (y + 1, 1) if m == 12 else (y, m + 1)
    WINDOWS.append((f"{y:04d}-{m:02d}", f"{y:04d}-{m:02d}-01T00:00:00Z", f"{y2:04d}-{m2:02d}-01T00:00:00Z"))
    y, m = y2, m2
WINDOWS.append(("2026-10-tail", "2026-10-01T00:00:00Z", "2026-10-04T00:00:00Z"))


def keep(market):
    ev = (market.get("events") or [{}])[0]
    return {
        "conditionId": market.get("conditionId"),
        "question": market.get("question"),
        "endDate": market.get("endDate"),
        "closedTime": market.get("closedTime"),
        "outcomes": market.get("outcomes"),
        "outcomePrices": market.get("outcomePrices"),
        "volume": market.get("volume"),
        "volumeNum": market.get("volumeNum"),
        "clobTokenIds": market.get("clobTokenIds"),
        "orderPriceMinTickSize": market.get("orderPriceMinTickSize"),
        "feesEnabled": market.get("feesEnabled"),
        "feeSchedule": market.get("feeSchedule"),
        "description": market.get("description"),
        "events": [{"title": ev.get("title"), "slug": ev.get("slug")}],
    }


def _cursor_path(path):
    return path + ".cursor.json"


def _write_cursor(path, cursor, pages, scanned, kept):
    blob = {"cursor": cursor, "pages": pages, "scanned": scanned, "kept": kept}
    dest = _cursor_path(path)
    tmp = dest + ".tmp"
    with open(tmp, "w") as f:
        json.dump(blob, f)
        f.write("\n")
    os.replace(tmp, dest)


def _repair_partial(path):
    """Drop a torn last line left by a kill mid-write. Complete lines stay."""
    if not os.path.exists(path) or os.path.getsize(path) == 0:
        return
    with open(path, "rb+") as f:
        f.seek(0, os.SEEK_END)
        size = f.tell()
        f.seek(size - 1)
        if f.read(1) != b"\n":
            window = min(size, 2_000_000)
            f.seek(size - window)
            cut = f.read(window).rfind(b"\n")
            f.truncate(0 if cut < 0 else size - window + cut + 1)
    with open(path, "rb+") as f:
        f.seek(0, os.SEEK_END)
        size = f.tell()
        if size == 0:
            return
        window = min(size, 2_000_000)
        f.seek(size - window)
        tail = f.read(window)
        nl = tail.rfind(b"\n", 0, len(tail) - 1)
        last = tail[nl + 1:] if nl >= 0 else tail
        try:
            json.loads(last.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            f.truncate(0 if nl < 0 else size - window + nl + 1)


def _suffix(slot):
    if slot == "p60":
        return ".p60.jsonl"
    if slot == "alt":
        return ".alt.jsonl"
    return ".jsonl"


def _quarantine_cursor(tmp):
    """The cursor file holds the next cursor. After a 403 that string must not be sent again."""
    src = _cursor_path(tmp)
    if os.path.exists(src):
        os.replace(src, src + ".blocked")


def _record_gap(name, limit, pages, scanned, kept):
    """A Cloudflare 403 ends the walk. The hole stays on the record."""
    text = (
        f"STOP Cloudflare 403 on limit {limit}. "
        f"pages {pages} scanned {scanned} kept {kept}. "
        "Same User-Agent, same address, no further page size. "
        "Rows after this cursor are missing until another public source supplies them.\n"
    )
    with open(os.path.join(SCRATCH, name + ".gap.txt"), "w") as f:
        f.write(text)
    print(text, end="", flush=True)


def _pull_pages(name, start, end, limit, slot):
    """Walk one window into name + slot file. Resume from that file's own cursor.

    Cloudflare 403s one cursor string forever. Limit 100 and limit 80 both
    ended a page on that key, so both asked for the same cursor. Limit 60
    does not divide that offset. A 403 on limit 60 stops the walk: the
    cursor is quarantined, the partial stays, and nothing changes the
    User-Agent, the address, or the page size to get past it.
    """
    path = os.path.join(SCRATCH, name + _suffix(slot))
    done = os.path.join(SCRATCH, name + ".done")
    tmp = path + ".partial"
    state_path = _cursor_path(tmp)
    blocked = state_path + ".blocked"
    scanned, kept, pages, cursor = 0, 0, 0, None
    mode = "w"
    if os.path.exists(tmp) and os.path.exists(state_path):
        with open(state_path) as f:
            state = json.load(f)
        cursor = state.get("cursor") or None
        pages = int(state.get("pages") or 0)
        scanned = int(state.get("scanned") or 0)
        kept = int(state.get("kept") or 0)
        mode = "a"
        _repair_partial(tmp)
        print(name, slot or "resume", "limit", limit, "pages", pages, "kept", kept, flush=True)
    elif os.path.exists(tmp) and os.path.exists(blocked):
        pages = scanned = kept = 0
        try:
            with open(blocked) as f:
                state = json.load(f)
            pages = int(state.get("pages") or 0)
            scanned = int(state.get("scanned") or 0)
            kept = int(state.get("kept") or 0)
        except (OSError, json.JSONDecodeError, TypeError, ValueError):
            pass
        _record_gap(name, limit, pages, scanned, kept)
        raise RuntimeError(name + " STOP 403 at limit " + str(limit) + "; partial kept")
    elif os.path.exists(tmp):
        os.remove(tmp)
    with open(tmp, mode) as out:
        while True:
            params = {
                "limit": limit, "closed": "true", "order": "id", "ascending": "true",
                "end_date_min": start, "end_date_max": end,
            }
            if cursor:
                params["after_cursor"] = cursor
            try:
                d = net.get(GAMMA + "/markets/keyset", params)
            except RuntimeError as e:
                if "HTTP 403" in str(e):
                    _quarantine_cursor(tmp)
                    print(name, "HTTP 403; cursor quarantined", flush=True)
                    if slot == "p60":
                        _record_gap(name, limit, pages, scanned, kept)
                raise
            markets = d.get("markets") or []
            if not markets:
                break
            for market in markets:
                scanned += 1
                if g1_lib.is_candidate(market.get("question") or ""):
                    out.write(json.dumps(keep(market), separators=(",", ":"), sort_keys=True) + "\n")
                    kept += 1
            pages += 1
            out.flush()
            cursor = d.get("next_cursor")
            _write_cursor(tmp, cursor, pages, scanned, kept)
            if pages % 25 == 0:
                print(f"  {name} pages {pages} scanned {scanned} kept {kept}", flush=True)
            if not cursor:
                break
    os.replace(tmp, path)
    cursor_file = _cursor_path(tmp)
    if os.path.exists(cursor_file):
        os.remove(cursor_file)
    with open(done, "w") as f:
        f.write(f"limit {limit} pages {pages} scanned {scanned} kept {kept}\n")
    print(name, "pages", pages, "scanned", scanned, "kept", kept, flush=True)


def pull_window(name, start, end):
    os.makedirs(SCRATCH, exist_ok=True)
    done = os.path.join(SCRATCH, name + ".done")
    if os.path.exists(done):
        print(name, "cached", flush=True)
        return
    p60 = os.path.join(SCRATCH, name + ".p60.jsonl")
    p60_tmp = p60 + ".partial"
    if os.path.exists(p60) or os.path.exists(p60_tmp):
        _pull_pages(name, start, end, 60, "p60")
        return
    alt_tmp = os.path.join(SCRATCH, name + ".alt.jsonl.partial")
    alt_file = os.path.join(SCRATCH, name + ".alt.jsonl")
    # Limit 80 reached the same key as limit 100 (both divide 337600) and
    # Gamma issued the same cursor. Do not resume that cursor.
    if os.path.exists(alt_tmp) or os.path.exists(alt_file):
        print(name, "limit 80 hit the blocked cursor; rewalk at limit 60", flush=True)
        _pull_pages(name, start, end, 60, "p60")
        return
    try:
        _pull_pages(name, start, end, 100, "")
    except RuntimeError as e:
        if "HTTP 403" not in str(e):
            raise
        print(name, "cursor blocked, rewalk at limit 60", flush=True)
        # A 403 from this call is terminal. Do not catch it and try another page size.
        _pull_pages(name, start, end, 60, "p60")


def load_candidates():
    by_id = {}
    for name, _, _ in WINDOWS:
        for suffix in (".jsonl", ".alt.jsonl", ".p60.jsonl"):
            path = os.path.join(SCRATCH, name + suffix)
            if not os.path.exists(path):
                continue
            with open(path) as f:
                for line in f:
                    if not line.strip():
                        continue
                    row = json.loads(line)
                    cid = row.get("conditionId")
                    if cid and cid not in by_id:
                        by_id[cid] = row
    return by_id


def _fee_schedule(market):
    fs = market.get("feeSchedule")
    if isinstance(fs, str):
        try:
            fs = json.loads(fs)
        except json.JSONDecodeError:
            return {}
    return fs if isinstance(fs, dict) else {}


def fee_rate(market):
    fs = _fee_schedule(market)
    if fs.get("rate") is None:
        return ""
    return str(fs.get("rate"))


def fee_exponent(market):
    fs = _fee_schedule(market)
    if fs.get("exponent") is None:
        return ""
    return str(fs.get("exponent"))


def write_outputs(by_id):
    os.makedirs(DATA, exist_ok=True)
    os.makedirs(RESULTS, exist_ok=True)
    buckets = {name: [] for name in g1_lib.FAMILIES}
    unparsed = []
    reasons = Counter()
    clauses = []
    for market in by_id.values():
        fam, row, reason = g1_lib.parse_market(market)
        if fam == "unparsed":
            row = dict(row)
            row["reason"] = reason
            unparsed.append(row)
            reasons[reason] += 1
            continue
        buckets[fam].append(row)
        clause = g1_lib.parse_clause(market.get("description") or "")
        clause["conditionId"] = row["conditionId"]
        clause["family"] = fam
        clause["tick"] = "" if market.get("orderPriceMinTickSize") is None else str(market.get("orderPriceMinTickSize"))
        clause["fees_enabled"] = "1" if market.get("feesEnabled") else "0"
        clause["fee_rate"] = fee_rate(market)
        clauses.append(clause)
    counts = {}
    for name, rows in buckets.items():
        counts[name] = g1_lib.write_csv(os.path.join(DATA, name + ".csv"), rows)
    unparsed_cols = g1_lib.COLUMNS + ["reason"]
    with open(os.path.join(DATA, "unparsed.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=unparsed_cols, lineterminator="\n", extrasaction="ignore")
        w.writeheader()
        for r in sorted(unparsed, key=lambda r: r["conditionId"]):
            w.writerow(r)
    clause_cols = ["conditionId", "family", "field", "pair", "tz", "start_et", "end_et",
                   "noon", "clause_ok", "tick", "fees_enabled", "fee_rate", "sentence"]
    with open(os.path.join(DATA, "clauses.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=clause_cols, lineterminator="\n", extrasaction="ignore")
        w.writeheader()
        for r in sorted(clauses, key=lambda r: r["conditionId"]):
            w.writerow(r)
    # Family x month of the title end.
    grid = Counter()
    for name, rows in buckets.items():
        for r in rows:
            grid[(name, (r["title_end"] or "")[:7])] += 1
    lines = [f"candidates {len(by_id)}", f"unparsed {len(unparsed)}"]
    for reason, n in reasons.most_common():
        lines.append(f"unparsed.{reason} {n}")
    lines.append("family total")
    for name in g1_lib.FAMILIES:
        lines.append(f"{name} {counts[name]}")
    lines.append("clause_ok " + str(sum(1 for c in clauses if c["clause_ok"] == "1"))
                 + " of " + str(len(clauses)))
    lines.append("family month count")
    for (name, month), n in sorted(grid.items()):
        lines.append(f"{name} {month} {n}")
    text = "\n".join(lines) + "\n"
    with open(os.path.join(RESULTS, "g1_counts.txt"), "w") as f:
        f.write(text)
    print(text, flush=True)
    return buckets


def spot_check(buckets):
    """Ten rows re-read from Gamma, compared with the CSV on the columns a person can check."""
    picks = []
    for name in ("daily_reach", "daily_dip", "weekly_reach", "weekly_dip", "above", "below", "buckets"):
        rows = buckets.get(name) or []
        if not rows:
            continue
        rows = sorted(rows, key=lambda r: r["conditionId"])
        picks.append(rows[0])
        if len(rows) > 2:
            picks.append(rows[len(rows) // 2])
        if len(picks) >= 10:
            break
    picks = picks[:10]
    lines = [f"spot-check {len(picks)} rows re-fetched from Gamma /markets by condition_id"]
    fails = 0
    for row in picks:
        # Gamma's default is closed=false, so a resolved market comes back empty without this.
        got = net.get(GAMMA + "/markets", {"condition_ids": row["conditionId"], "closed": "true", "limit": 1})
        market = got[0] if isinstance(got, list) and got else None
        if not market:
            lines.append(f"FAIL {row['conditionId']} gamma returned nothing")
            fails += 1
            continue
        fam, again, reason = g1_lib.parse_market(market)
        bad = []
        for col in ("question", "asset", "type", "strike", "bound_lo", "bound_hi",
                    "title_start", "title_end", "payout_yes", "clobTokenIds_yes"):
            if (again.get(col) or "") != (row.get(col) or ""):
                bad.append(f"{col} csv={row.get(col)!r} gamma={again.get(col)!r}")
        mark = "FAIL" if bad or fam == "unparsed" else "ok"
        if mark == "FAIL":
            fails += 1
        lines.append(f"{mark} {row['type']} {row['asset']} {row['strike'] or (row['bound_lo']+'-'+row['bound_hi'])} "
                     f"{row['title_end']} payout {row['payout_yes']} | {row['question'][:90]}")
        for b in bad:
            lines.append("  " + b)
        if reason and fam == "unparsed":
            lines.append("  reparse " + reason)
    lines.append(f"spot-check fails {fails}")
    text = "\n".join(lines) + "\n"
    with open(os.path.join(RESULTS, "g1_spotcheck.txt"), "w") as f:
        f.write(text)
    print(text, flush=True)
    return fails


def main():
    t0 = time.time()
    for name, start, end in WINDOWS:
        pull_window(name, start, end)
    by_id = load_candidates()
    print(f"unique candidates {len(by_id)} in {time.time() - t0:.0f}s", flush=True)
    buckets = write_outputs(by_id)
    fails = spot_check(buckets)
    if fails:
        sys.exit(1)


if __name__ == "__main__":
    main()
