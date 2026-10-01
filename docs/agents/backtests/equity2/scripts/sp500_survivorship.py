"""How big is the survivorship hole in a keyless S&P 500 PEAD history, 2016 -> 2026?

1. Wikipedia's "List of S&P 500 companies" (MediaWiki parse API, keyless): the
   current constituents table and the "Selected changes" table.
2. Every removal dated 2016-01-01 .. 2026-09-30: its reason text, classified.
3. For each removed ticker, Yahoo chart METADATA only: a request whose window is
   one day of 2015 (period1/period2 = 2015-12-30 .. 2015-12-31, so no bar after
   2015 can come back), keeping longName, firstTradeDate, exchangeName,
   currency and instrumentType, and whether Yahoo answers at all. No price is
   stored or printed (the meta's current-price fields are dropped unread).
Also: is the changes table complete? Walk the current list back through the
changes and count members at each year end (a complete table keeps ~500-505).
Output: ../results/sp500_survivorship.json; cache in ../inputs/sp500/.
"""
import json, os, re, time, urllib.parse, urllib.request
from datetime import datetime, timezone
from html.parser import HTMLParser

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "..", "inputs", "sp500")
os.makedirs(CACHE, exist_ok=True)
UA = {"User-Agent": os.environ.get("RESEARCH_UA", "equity-research-script/1.0 (keyless public reads)")}


def get(url, path, sleep=0.0):
    if os.path.exists(path):
        return open(path, "rb").read()
    req = urllib.request.Request(url, headers=UA)
    try:
        b = urllib.request.urlopen(req, timeout=30).read()
    except urllib.error.HTTPError as e:
        b = json.dumps({"_http_error": e.code}).encode()
    open(path, "wb").write(b)
    time.sleep(sleep)
    return b


class Tables(HTMLParser):
    def __init__(self):
        super().__init__(); self.tables = []; self.cur = None; self.row = None; self.cell = None; self.depth = 0
    def handle_starttag(self, tag, a):
        if tag == "table":
            self.depth += 1
            if self.depth == 1:
                self.cur = {"id": dict(a).get("id"), "rows": []}
        elif self.depth == 1 and tag == "tr":
            self.row = []
        elif self.depth == 1 and tag in ("td", "th"):
            self.cell = []; self.span = int(dict(a).get("rowspan", "1") or 1)
    def handle_endtag(self, tag):
        if tag == "table":
            if self.depth == 1:
                self.tables.append(self.cur)
            self.depth -= 1
        elif self.depth == 1 and tag == "tr" and self.row is not None:
            self.cur["rows"].append(self.row); self.row = None
        elif self.depth == 1 and tag in ("td", "th") and self.cell is not None:
            self.row.append((" ".join("".join(self.cell).split()), self.span)); self.cell = None
    def handle_data(self, d):
        if self.cell is not None:
            self.cell.append(d)


# Wikipedia's REST HTML (the parse API answered 429 from this container on 2026-10-01)
rest = "https://en.wikipedia.org/api/rest_v1/page/html/List_of_S%26P_500_companies"
html = get(rest, os.path.join(CACHE, "wiki_rest.html")).decode("utf-8")
import hashlib
page = {"parse": {"revid": "list sha256:" + hashlib.sha256(html.encode()).hexdigest()[:16]}}
p = Tables(); p.feed(html)
const = next(t for t in p.tables if t["id"] == "constituents")
hist = get("https://en.wikipedia.org/api/rest_v1/page/html/Historical_components_of_the_S%26P_500",
           os.path.join(CACHE, "hist_rest.html")).decode("utf-8")
ph = Tables(); ph.feed(hist)
changes = next(t for t in ph.tables if t["id"] == "changes")   # moved off the list page by 2026-10
current = [r[0][0] for r in const["rows"][1:] if r]

# expand rowspans of the changes table: columns Date, Added ticker, Added security, Removed ticker, Removed security, Reason
rows, carry = [], {}
for r in changes["rows"][2:]:
    out, it, col = [], iter(r), 0
    cells = list(r)
    full = []
    ci = 0
    for col in range(7):
        if col in carry and carry[col][1] > 0:
            full.append(carry[col][0]); carry[col][1] -= 1
        elif ci < len(cells):
            txt, span = cells[ci]; ci += 1
            full.append(txt)
            if span > 1:
                carry[col] = [txt, span - 1]
        else:
            full.append("")
    rows.append(full)


def pdate(s):
    for f in ("%B %d, %Y", "%b %d, %Y"):
        try:
            return datetime.strptime(s.strip(), f).date()
        except ValueError:
            pass
    return None


ch = []
for r in rows:
    d = pdate(r[0])
    if d:
        ch.append({"date": d.isoformat(), "added": r[1], "added_name": r[2], "removed": r[3], "removed_name": r[4], "reason": r[5]})
OUT = {"wiki_revid": page["parse"].get("revid"), "current_constituents": len(current), "change_rows": len(ch),
       "first_change": min(c["date"] for c in ch), "last_change": max(c["date"] for c in ch)}

# completeness: membership count walked back by year end
members = set(current)
by_date = sorted(ch, key=lambda c: c["date"], reverse=True)
counts, i = {}, 0
for y in range(2026, 1999, -1):
    cutoff = f"{y}-12-31"
    while i < len(by_date) and by_date[i]["date"] > cutoff:
        c = by_date[i]
        if c["added"]:
            members.discard(c["added"])
        if c["removed"]:
            members.add(c["removed"])
        i += 1
    counts[y] = len(members)
OUT["members_walked_back_at_year_end"] = counts


def classify(reason):
    s = reason.lower()
    if any(k in s for k in ("acquir", "merg", "bought", "purchase", "take private", "taken private", "buyout", "combin")):
        return "acquired_or_merged"
    if any(k in s for k in ("spun", "spin")):
        return "spin_off_related"
    if any(k in s for k in ("bankrupt", "chapter 11", "delist")):
        return "bankrupt_or_delisted"
    if any(k in s for k in ("market cap", "capitalization", "s&p 400", "s&p 600", "smallcap", "midcap", "rebalanc", "moved", "unrepresentative", "eligib")):
        return "market_cap_or_index_move"
    return "other_or_blank"


rem = [c for c in ch if "2016-01-01" <= c["date"] <= "2026-09-30" and c["removed"]]
OUT["removals_2016_2026"] = len(rem)
OUT["additions_2016_2026"] = sum(1 for c in ch if "2016-01-01" <= c["date"] <= "2026-09-30" and c["added"])
p1 = int(datetime(2015, 12, 30, tzinfo=timezone.utc).timestamp())
p2 = int(datetime(2015, 12, 31, 23, 0, tzinfo=timezone.utc).timestamp())
detail = []
for c in rem:
    t = c["removed"].replace(".", "-")
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(t)}?period1={p1}&period2={p2}&interval=1d"
    path = os.path.join(CACHE, f"yh_{t}.json")
    if not os.path.exists(path):
        try:
            raw = json.loads(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30).read())
        except urllib.error.HTTPError as e:
            raw = {"_http_error": e.code}
        except Exception as e:
            raw = {"_error": type(e).__name__}
        # keep ONLY these meta fields; current-price fields are dropped before anything is stored
        keep = ("longName", "shortName", "firstTradeDate", "exchangeName", "currency", "instrumentType", "symbol")
        res0 = ((raw.get("chart") or {}).get("result") or [None])[0] if isinstance(raw, dict) else None
        slim = {"chart": {"result": [{"meta": {k: res0["meta"].get(k) for k in keep}}]}} if res0 else \
               {k: v for k, v in raw.items() if k in ("_http_error", "_error")}
        open(path, "w").write(json.dumps(slim))
        time.sleep(1.2)
    j = json.loads(open(path).read())
    res = (j.get("chart") or {}).get("result") if isinstance(j, dict) else None
    meta = res[0]["meta"] if res else {}
    ftd = meta.get("firstTradeDate")
    detail.append({"date": c["date"], "ticker": c["removed"], "name": c["removed_name"], "class": classify(c["reason"]),
                   "yahoo_answers": bool(res), "yahoo_longName": meta.get("longName"),
                   "yahoo_first_trade": datetime.fromtimestamp(ftd, timezone.utc).date().isoformat() if ftd else None,
                   "yahoo_exchange": meta.get("exchangeName"), "yahoo_error": j.get("_http_error") if isinstance(j, dict) else None})
OUT["removed_detail"] = detail
from collections import Counter
OUT["by_class"] = dict(Counter(d["class"] for d in detail))
OUT["yahoo_answers_by_class"] = {k: {"answers": sum(1 for d in detail if d["class"] == k and d["yahoo_answers"]),
                                     "n": sum(1 for d in detail if d["class"] == k)} for k in OUT["by_class"]}
# a ticker Yahoo answers for may be a different company now: first trade after the removal date
OUT["answers_but_first_trade_after_removal"] = sum(1 for d in detail if d["yahoo_answers"] and d["yahoo_first_trade"] and d["yahoo_first_trade"] > d["date"])
json.dump(OUT, open(os.path.join(HERE, "..", "results", "sp500_survivorship.json"), "w"), indent=1, sort_keys=True)
print(json.dumps({k: v for k, v in OUT.items() if k != "removed_detail"}, indent=1))
