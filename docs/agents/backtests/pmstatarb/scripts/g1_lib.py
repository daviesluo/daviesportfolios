"""Parse a Polymarket crypto price question into the G1 columns.

Title dates come from the question only. The settlement window is a separate
read of the description (settlement text decides the window the studies use).
Nothing here touches the network.
"""
import csv
import datetime as dt
import json
import re

MONTHS = {
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6,
    "july": 7, "august": 8, "september": 9, "sept": 9, "sep": 9, "october": 10,
    "november": 11, "december": 12,
}
MON_PAT = "|".join(sorted((m for m in MONTHS if len(m) > 3), key=len, reverse=True) + ["Sept", "Sep"])
DATE_PAT = (
    rf"(?P<mon>{MON_PAT})\s+(?P<day>\d{{1,2}})(?:st|nd|rd|th)?"
    rf"(?:\s*,\s*(?P<year>20\d{{2}}))?"
)
DATE_RE = re.compile(DATE_PAT, re.I)
# The same date with no names, so a range can contain it twice.
DATE_ANON = re.sub(r"\?P<[^>]+>", "", DATE_PAT)
ASSET_RE = re.compile(r"\b(bitcoin|ethereum|btc|eth)\b", re.I)
CANDIDATE_RE = re.compile(
    r"\b(reach|reaches|reaching|dip|dips|dipping|above|below|between|hit|hits|"
    r"price|less than|greater than|more than)\b", re.I)
# Dollar amounts, a bare "120k" / "119.5k" (the daily ladder's wording), or a
# 4-digit / comma number. The k/m form is its own alternative: "120" is not
# four digits, so it would otherwise be dropped.
NUM_RE = re.compile(
    r"\$\s*(?P<d>[0-9][0-9,]*(?:\.[0-9]+)?)\s*(?P<ds>[kKmM])?"
    r"|(?<![\d$.])(?P<k>[0-9]+(?:\.[0-9]+)?)\s*(?P<ks>[kKmM])\b"
    r"|(?<![\d$])(?P<b>[0-9]{1,3}(?:,[0-9]{3})+|[0-9]{4,})(?!\d)")

COLUMNS = [
    "conditionId", "question", "event_title", "asset", "type", "strike",
    "bound_lo", "bound_hi", "title_start", "title_end", "endDate", "closedTime",
    "payout_yes", "volume", "clobTokenIds_yes",
]
FAMILIES = (
    "daily_reach", "daily_dip", "weekly_reach", "weekly_dip",
    "above", "below", "buckets",
)


def loads(v, default):
    if v is None or v == "":
        return default
    if isinstance(v, str):
        try:
            return json.loads(v)
        except json.JSONDecodeError:
            return default
    return v


def parse_num(body, suffix):
    if body is None:
        return None
    x = float(body.replace(",", ""))
    suf = (suffix or "").lower()
    if suf == "k":
        x *= 1000
    elif suf == "m":
        x *= 1_000_000
    return x


def find_numbers(text):
    out = []
    for m in NUM_RE.finditer(text):
        if m.group("d") is not None:
            out.append(parse_num(m.group("d"), m.group("ds")))
        elif m.group("k") is not None:
            out.append(parse_num(m.group("k"), m.group("ks")))
        else:
            raw = m.group("b")
            # A bare 4-digit year left behind after the date was removed is not a strike.
            if raw and re.fullmatch(r"20[0-3]\d", raw):
                continue
            out.append(parse_num(raw, None))
    return [n for n in out if n is not None and n > 0]


def _iso(year, month, day):
    try:
        return dt.date(year, month, day).isoformat()
    except ValueError:
        return None


def pick_date(month, day, explicit, end_iso, slug):
    """The calendar date named in the title, year from the title, else the year that lands nearest endDate."""
    years = []
    if explicit:
        years = [int(explicit)]
    else:
        if end_iso and len(end_iso) >= 4 and end_iso[:4].isdigit():
            years.append(int(end_iso[:4]))
        m = re.search(r"(20\d{2})", slug or "")
        if m and int(m.group(1)) not in years:
            years.append(int(m.group(1)))
    if not years:
        return None
    end = None
    if end_iso and len(end_iso) >= 10:
        try:
            end = dt.date.fromisoformat(end_iso[:10])
        except ValueError:
            end = None
    best = None
    for y in years:
        options = [y] if explicit else [y - 1, y, y + 1]
        for yy in options:
            iso = _iso(yy, month, day)
            if not iso:
                continue
            got = dt.date.fromisoformat(iso)
            score = abs((got - end).days) if end else 0
            if best is None or score < best[0]:
                best = (score, iso)
    # A wrong year is ~365 days away. The window start can sit up to a few weeks before endDate.
    if best is None or best[0] > 40:
        return None
    return best[1]


def blank_dates(question):
    return DATE_RE.sub(" ", question)


def _date_at(match, end_iso, slug, year_fallback=None):
    mon = MONTHS[match.group("mon").lower()]
    return pick_date(mon, int(match.group("day")), match.group("year") or year_fallback, end_iso, slug)


def title_dates(question, end_iso, slug):
    """(start, end, kind) from the question text. kind is 'on', 'before', 'range' or None.

    A range is two month-dates, or one month-date and a bare day ('October 6-12').
    Named groups cannot repeat in one expression, so the two dates are read by finditer.
    """
    q = question
    range_m = re.search(
        rf"{DATE_ANON}\s*(?:-|–|—|to|through)\s*(?:{DATE_ANON}|\d{{1,2}}(?:st|nd|rd|th)?)",
        q, re.I)
    if range_m:
        dates = list(DATE_RE.finditer(range_m.group(0)))
        if dates:
            start = _date_at(dates[0], end_iso, slug)
            if len(dates) >= 2:
                end = _date_at(dates[1], end_iso, slug, dates[0].group("year"))
            else:
                bare = re.search(r"(?:-|–|—)\s*(\d{1,2})(?:st|nd|rd|th)?\s*$", range_m.group(0))
                mon = MONTHS[dates[0].group("mon").lower()]
                end = pick_date(mon, int(bare.group(1)), dates[0].group("year"), end_iso, slug) if bare else None
            if start and end:
                if end < start:
                    start, end = end, start
                return start, end, "range"
    before = re.search(rf"\bbefore\s+{DATE_PAT}", q, re.I)
    if before:
        end = _date_at(before, end_iso, slug)
        return ("", end, "before") if end else ("", "", None)
    on = re.search(rf"\bon\s+{DATE_PAT}", q, re.I)
    if on:
        day = _date_at(on, end_iso, slug)
        return (day, day, "on") if day else ("", "", None)
    # "on 4/20" or "on 4/20/22", the older wording.
    num = re.search(r"\bon\s+(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?", q)
    if num:
        year = num.group(3)
        if year and len(year) == 2:
            year = "20" + year
        got = pick_date(int(num.group(1)), int(num.group(2)), year, end_iso, slug)
        return (got, got, "on") if got else ("", "", None)
    return "", "", None


def asset_of(question):
    hits = {m.group(1).lower() for m in ASSET_RE.finditer(question)}
    btc = "bitcoin" in hits or "btc" in hits
    eth = "ethereum" in hits or "eth" in hits
    if btc and eth:
        return None
    if btc:
        return "BTC"
    if eth:
        return "ETH"
    return None


def family_of(kind, span_days):
    if kind == "touch_up" and span_days == 0:
        return "daily_reach"
    if kind == "touch_dn" and span_days == 0:
        return "daily_dip"
    if kind == "touch_up" and span_days is None:
        return "weekly_reach"  # "before <date>": the title names no start; the clause file has the window
    if kind == "touch_dn" and span_days is None:
        return "weekly_dip"
    if kind == "touch_up" and span_days is not None and 1 <= span_days <= 10:
        return "weekly_reach"
    if kind == "touch_dn" and span_days is not None and 1 <= span_days <= 10:
        return "weekly_dip"
    if kind == "above":
        return "above"
    if kind == "below":
        return "below"
    if kind == "bucket":
        return "buckets"
    return None


def classify(question):
    low = question.lower()
    if re.search(r"\bbetween\b|\bless than\b|\bgreater than\b|\bmore than\b|\bor (?:higher|lower|more|less)\b", low):
        return "bucket"
    if re.search(r"\breach|\breaches\b", low):
        return "touch_up"
    if re.search(r"\bdip|\bdips\b", low):
        return "touch_dn"
    if re.search(r"\babove\b", low):
        return "above"
    if re.search(r"\bbelow\b", low):
        return "below"
    return None


def fmt_strike(n):
    if n is None:
        return ""
    if abs(n - round(n)) < 1e-6:
        return str(int(round(n)))
    return f"{n:.4f}".rstrip("0").rstrip(".")


def payout_yes(outcomes, prices):
    outcomes, prices = loads(outcomes, []), loads(prices, [])
    if not outcomes or not prices or len(outcomes) != len(prices):
        return None
    try:
        i = [str(o).lower() for o in outcomes].index("yes")
    except ValueError:
        return None
    try:
        p = float(prices[i])
    except (TypeError, ValueError):
        return None
    if p >= 0.999:
        return "1"
    if p <= 0.001:
        return "0"
    return None


def yes_token(outcomes, ids):
    outcomes, ids = loads(outcomes, []), loads(ids, [])
    if not outcomes or not ids:
        return ""
    try:
        i = [str(o).lower() for o in outcomes].index("yes")
    except ValueError:
        return ""
    if i >= len(ids):
        return ""
    return str(ids[i])


def fmt_volume(market):
    raw = market.get("volumeNum")
    if raw is None or raw == "":
        raw = market.get("volume")
    if raw is None or raw == "":
        return ""
    try:
        x = float(raw)
    except (TypeError, ValueError):
        return str(raw)
    if abs(x - round(x)) < 1e-6:
        return str(int(round(x)))
    return f"{x:.4f}".rstrip("0").rstrip(".")


def is_candidate(question):
    return bool(ASSET_RE.search(question or "") and CANDIDATE_RE.search(question or ""))


def parse_market(market):
    """Return (family or 'unparsed', row, reason). row has COLUMNS."""
    question = (market.get("question") or "").strip()
    events = market.get("events") or []
    ev = events[0] if events else {}
    title = ev.get("title") or ""
    slug = ev.get("slug") or market.get("slug") or ""
    end_iso = market.get("endDate") or ""
    base = {
        "conditionId": market.get("conditionId") or "",
        "question": question,
        "event_title": title,
        "asset": "",
        "type": "",
        "strike": "",
        "bound_lo": "",
        "bound_hi": "",
        "title_start": "",
        "title_end": "",
        "endDate": end_iso,
        "closedTime": market.get("closedTime") or "",
        "payout_yes": payout_yes(market.get("outcomes"), market.get("outcomePrices")) or "",
        "volume": fmt_volume(market),
        "clobTokenIds_yes": yes_token(market.get("outcomes"), market.get("clobTokenIds")),
    }
    asset = asset_of(question)
    # "on August 1 at 5PM ET" is an intraday bracket, not the daily partition.
    if re.search(r"\bat\s+\d{1,2}(?::\d{2})?\s*(?:AM|PM)?\b", question, re.I):
        base["asset"] = asset or ""
        return "unparsed", base, "intraday_clock"
    kind = classify(question)
    start, end, how = title_dates(question, end_iso, slug)
    base["title_start"] = start or ""
    base["title_end"] = end or ""
    if not asset:
        return "unparsed", base, "no_asset" if not ASSET_RE.search(question) else "both_assets"
    base["asset"] = asset
    if not kind:
        return "unparsed", base, "no_type"
    if not end:
        return "unparsed", base, "no_title_date"
    nums = find_numbers(blank_dates(question))
    if kind == "bucket":
        low = question.lower()
        if re.search(r"\bbetween\b", low):
            if len(nums) < 2:
                return "unparsed", base, "bucket_bounds"
            lo, hi = sorted(nums[:2])
            base["bound_lo"], base["bound_hi"] = fmt_strike(lo), fmt_strike(hi)
        elif re.search(r"\bless than\b|\bor (?:lower|less)\b", low):
            if not nums:
                return "unparsed", base, "bucket_bounds"
            base["bound_hi"] = fmt_strike(nums[0])
        elif re.search(r"\bgreater than\b|\bmore than\b|\bor (?:higher|more)\b", low):
            if not nums:
                return "unparsed", base, "bucket_bounds"
            base["bound_lo"] = fmt_strike(nums[0])
        else:
            return "unparsed", base, "bucket_bounds"
    else:
        if len(nums) != 1:
            return "unparsed", base, "strike_count"
        base["strike"] = fmt_strike(nums[0])
        base["type"] = kind
    if kind == "bucket":
        base["type"] = "bucket"
    if not base["payout_yes"]:
        return "unparsed", base, "unresolved"
    if how == "on" or (start and end and start == end):
        span = 0
    elif how == "before" and not start:
        span = None
    elif start and end:
        span = (dt.date.fromisoformat(end) - dt.date.fromisoformat(start)).days
    else:
        span = None
    if kind in ("above", "below") and span not in (0,):
        # A terminal market is "on a date". A range is not this family.
        return "unparsed", base, "terminal_not_one_day"
    if kind in ("touch_up", "touch_dn") and span is not None and span > 10:
        return "unparsed", base, "long_window"
    fam = family_of(kind, span)
    if not fam:
        return "unparsed", base, "no_family"
    # Window of the study: title end inside 2024-01-01 .. 2026-09-30.
    if end < "2024-01-01" or end > "2026-09-30":
        return "unparsed", base, "outside_window"
    return fam, base, ""


def parse_clause(desc):
    """The settling sentence. Returns a dict; clause_ok is 0 when the sentence was not recognised."""
    raw = desc or ""
    d = raw.replace("\u201c", '"').replace("\u201d", '"').replace("\u2018", "'").replace("\u2019", "'")
    head = d[:800]
    field_m = re.search(r'final\s+"?(High|Low|Close)"?', head, re.I)
    field = field_m.group(1).capitalize() if field_m else ""
    if re.search(r"BTC\s*/\s*USDT|BTCUSDT", head, re.I):
        pair = "BTCUSDT"
    elif re.search(r"ETH\s*/\s*USDT|ETHUSDT", head, re.I):
        pair = "ETHUSDT"
    else:
        pair = ""
    noon = "1" if re.search(r"12:00 in the ET timezone \(noon\)", head, re.I) else "0"
    start_et, end_et = "", ""
    hours = re.search(
        r"between\s+(\d{1,2}:\d{2}\s*(?:AM|PM)?)\s+ET\s+and\s+(\d{1,2}:\d{2}\s*(?:AM|PM)?)\s+ET",
        head, re.I)
    span = re.search(
        r"between\s+([A-Za-z]+)\s+(\d{1,2}),\s*(20\d{2}),?\s+(\d{1,2}:\d{2})"
        r"\s+and\s+([A-Za-z]+)\s+(\d{1,2}),\s*(20\d{2}),?\s+(\d{1,2}:\d{2})",
        head, re.I)
    if span:
        def one(mon, day, year, clock):
            key = mon.lower()
            if key not in MONTHS:
                return ""
            iso = _iso(int(year), MONTHS[key], int(day))
            return f"{iso}T{clock}" if iso else ""
        start_et = one(span.group(1), span.group(2), span.group(3), span.group(4))
        end_et = one(span.group(5), span.group(6), span.group(7), span.group(8))
    elif hours:
        start_et = _clock(hours.group(1))
        end_et = _clock(hours.group(2))
    elif noon == "1":
        start_et = end_et = "12:00"
    tz = "ET" if re.search(r"\bET\b|ET timezone", head) else ""
    ok = "1" if field and pair and tz and (start_et or noon == "1") else "0"
    sentence = re.sub(r"\s+", " ", raw).strip()[:320]
    return {
        "field": field, "pair": pair, "tz": tz, "start_et": start_et, "end_et": end_et,
        "noon": noon, "clause_ok": ok, "sentence": sentence,
    }


def _clock(text):
    m = re.match(r"(\d{1,2}):(\d{2})\s*(AM|PM)?", text.strip(), re.I)
    if not m:
        return ""
    h, minute = int(m.group(1)), int(m.group(2))
    ap = (m.group(3) or "").upper()
    if ap == "PM" and h < 12:
        h += 12
    if ap == "AM" and h == 12:
        h = 0
    return f"{h:02d}:{minute:02d}"


def write_csv(path, rows):
    rows = sorted(rows, key=lambda r: r["conditionId"])
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS, lineterminator="\n", extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow(r)
    return len(rows)


def self_test():
    cases = [
        ("Will Bitcoin reach $91,000 on September 13?", "2026-09-14T04:00:00Z",
         "what-price-will-bitcoin-hit-on-september-13-2026", "daily_reach", "BTC", "91000", "2026-09-13", "2026-09-13"),
        ("Will Bitcoin reach 120500 on August 15?", "2025-08-16T04:00:00Z",
         "what-price-will-bitcoin-hit-on-august-15", "daily_reach", "BTC", "120500", "2025-08-15", "2025-08-15"),
        ("Will Bitcoin dip to 118000 on August 15?", "2025-08-16T04:00:00Z",
         "x", "daily_dip", "BTC", "118000", "2025-08-15", "2025-08-15"),
        # The daily ladder drops the dollar sign on the day after it starts.
        ("Will Bitcoin reach 120k on August 16?", "2025-08-17T04:00:00Z",
         "what-price-will-bitcoin-hit-on-august-16", "daily_reach", "BTC", "120000", "2025-08-16", "2025-08-16"),
        ("Will Bitcoin reach 119.5k on August 16?", "2025-08-17T04:00:00Z",
         "x", "daily_reach", "BTC", "119500", "2025-08-16", "2025-08-16"),
        ("Will Bitcoin dip to 118k on August 16?", "2025-08-17T04:00:00Z",
         "x", "daily_dip", "BTC", "118000", "2025-08-16", "2025-08-16"),
        ("Will Ethereum reach $2,300 on March 9?", "2026-03-10T04:00:00Z",
         "what-price-will-ethereum-hit-on-march-9", "daily_reach", "ETH", "2300", "2026-03-09", "2026-03-09"),
        ("Will Ethereum dip to $1,650 on March 9?", "2026-03-10T04:00:00Z",
         "x", "daily_dip", "ETH", "1650", "2026-03-09", "2026-03-09"),
        ("Will Bitcoin reach $114K before July 14?", "2025-07-14T04:00:00Z",
         "what-price-will-bitcoin-hit-before-july-14", "weekly_reach", "BTC", "114000", "", "2025-07-14"),
        ("Will Bitcoin dip to $108K before July 14?", "2025-07-14T04:00:00Z",
         "x", "weekly_dip", "BTC", "108000", "", "2025-07-14"),
        ("Will the price of Bitcoin be above $112,000 on October 15?", "2025-10-15T16:00:00Z",
         "bitcoin-above-on-october-15", "above", "BTC", "112000", "2025-10-15", "2025-10-15"),
        ("Will the price of Bitcoin be less than $100K on September 5?", "2025-09-05T16:00:00Z",
         "bitcoin-price-on-september-5", "buckets", "BTC", "", "2025-09-05", "2025-09-05"),
        ("Will the price of Bitcoin be between $100K and $102K on September 5?", "2025-09-05T16:00:00Z",
         "x", "buckets", "BTC", "", "2025-09-05", "2025-09-05"),
        ("Will the price of Bitcoin be greater than $118K on September 5?", "2025-09-05T16:00:00Z",
         "x", "buckets", "BTC", "", "2025-09-05", "2025-09-05"),
        ("Will the price of Ethereum be less than $3800 on September 5?", "2025-09-05T16:00:00Z",
         "x", "buckets", "ETH", "", "2025-09-05", "2025-09-05"),
    ]
    bounds = {
        "less than $100K": ("", "100000"),
        "between $100K and $102K": ("100000", "102000"),
        "greater than $118K": ("118000", ""),
        "less than $3800": ("", "3800"),
    }
    for q, end, slug, fam, asset, strike, start, tend in cases:
        market = {
            "question": q, "endDate": end, "closedTime": "t", "conditionId": "0xabc",
            "outcomes": '["Yes","No"]', "outcomePrices": '["1","0"]', "volumeNum": 10,
            "clobTokenIds": '["yes-token","no-token"]',
            "events": [{"title": "event", "slug": slug}],
        }
        got_fam, row, reason = parse_market(market)
        assert got_fam == fam, (q, got_fam, reason, row)
        assert row["asset"] == asset and row["strike"] == strike, (q, row)
        assert row["title_start"] == start and row["title_end"] == tend, (q, row["title_start"], row["title_end"])
        assert row["payout_yes"] == "1" and row["clobTokenIds_yes"] == "yes-token"
        for needle, (lo, hi) in bounds.items():
            if needle in q:
                assert row["bound_lo"] == lo and row["bound_hi"] == hi, (q, row)
    # NO won.
    no = parse_market({
        "question": "Will Bitcoin reach $91,000 on September 13?",
        "endDate": "2026-09-14T04:00:00Z", "conditionId": "c",
        "outcomes": ["Yes", "No"], "outcomePrices": ["0", "1"], "volume": "15.5",
        "clobTokenIds": ["y", "n"], "events": [{"slug": "what-price-will-bitcoin-hit-on-october-13-2026", "title": "t"}],
    })
    assert no[1]["payout_yes"] == "0" and no[1]["volume"] == "15.5", no
    # Outside the window.
    old = parse_market({
        "question": "Will the price of Bitcoin (BTC) be above $42,000 on 4/20?",
        "endDate": "2022-04-20T16:00:00Z", "conditionId": "c",
        "outcomes": ["Yes", "No"], "outcomePrices": ["0", "1"],
        "clobTokenIds": ["y", "n"], "events": [{"slug": "x", "title": "t"}],
    })
    assert old[0] == "unparsed" and old[2] == "outside_window", old
    weekly = (
        'This market will immediately resolve to "Yes" if any Binance 1 minute candle for Bitcoin (BTC/USDT) '
        "between July 9, 2025, 10:00 and July 13, 2025, 23:59 in the ET timezone has a final \"High\" price "
        "equal to or greater than the price specified in the title."
    )
    c = parse_clause(weekly)
    assert c["clause_ok"] == "1" and c["field"] == "High" and c["pair"] == "BTCUSDT", c
    assert c["start_et"] == "2025-07-09T10:00" and c["end_et"] == "2025-07-13T23:59", c
    daily = (
        "any Binance 1-minute candle for Bitcoin (BTC/USDT) on the date specified in the title, "
        "between 9:30 AM ET and 11:59 PM ET has a final \"High\" price"
    )
    c = parse_clause(daily)
    assert c["start_et"] == "09:30" and c["end_et"] == "23:59" and c["field"] == "High", c
    noon = 'the Binance 1 minute candle for BTC/USDT 12:00 in the ET timezone (noon) has a final "Close" price'
    c = parse_clause(noon)
    assert c["noon"] == "1" and c["field"] == "Close" and c["start_et"] == "12:00", c
    low = 'ETH/USDT on the date specified in the title, between 12:00 AM ET and 11:59 PM ET has a final "Low" price'
    c = parse_clause(low)
    assert c["field"] == "Low" and c["pair"] == "ETHUSDT" and c["start_et"] == "00:00" and c["end_et"] == "23:59", c
    assert parse_clause("no settlement here")["clause_ok"] == "0"
    intra = parse_market({
        "question": "Will the price of Bitcoin be less than $117K on August 1 at 5PM ET?",
        "endDate": "2025-08-01T21:00:00Z", "conditionId": "c",
        "outcomes": ["Yes", "No"], "outcomePrices": ["0", "1"],
        "clobTokenIds": ["y", "n"], "events": [{"slug": "x", "title": "t"}],
    })
    assert intra[0] == "unparsed" and intra[2] == "intraday_clock", intra
    ranged = parse_market({
        "question": "Will Bitcoin reach $100,000 October 6-12?",
        "endDate": "2025-10-12T04:00:00Z", "conditionId": "c",
        "outcomes": ["Yes", "No"], "outcomePrices": ["0", "1"],
        "clobTokenIds": ["y", "n"], "events": [{"slug": "x-2025", "title": "t"}],
    })
    assert ranged[0] == "weekly_reach" and ranged[1]["title_start"] == "2025-10-06" and ranged[1]["title_end"] == "2025-10-12", ranged
    both = parse_market({
        "question": "Will Bitcoin reach $100,000 from October 6 to October 12?",
        "endDate": "2025-10-12T04:00:00Z", "conditionId": "c",
        "outcomes": ["Yes", "No"], "outcomePrices": ["1", "0"],
        "clobTokenIds": ["y", "n"], "events": [{"slug": "x-2025", "title": "t"}],
    })
    assert both[0] == "weekly_reach" and both[1]["title_start"] == "2025-10-06", both
    print("g1_lib self-test ok", len(cases), "questions")


if __name__ == "__main__":
    self_test()
