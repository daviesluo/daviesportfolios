"""Settlement end, in UTC, from a parsed clause. No network.

The studies enter a fixed number of hours before this instant. A clock-only
clause ("23:59", "12:00") sits on the title's end date, in America/New_York.
A dated clause ("2025-07-13T23:59") is that civil time in the same zone.
The named minute is used as written: 23:59 means 23:59:00, not the close of
the candle a minute later.

usage: python3 -I docs/agents/backtests/pmstatarb/scripts/g2_time.py
"""
import datetime as dt
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
UTC = dt.timezone.utc


def settlement_end_utc(end_et, title_end, clause_ok="1"):
    """Return an aware UTC datetime, or None when the clause does not say.

    end_et is either 'YYYY-MM-DDTHH:MM' or 'HH:MM'. title_end is 'YYYY-MM-DD'.
    """
    if clause_ok != "1" or not end_et:
        return None
    if "T" in end_et:
        day, clock = end_et.split("T", 1)
    else:
        if not title_end:
            return None
        day, clock = title_end, end_et
    try:
        y, m, d = (int(x) for x in day.split("-"))
        hh, mm = (int(x) for x in clock.split(":"))
        local = dt.datetime(y, m, d, hh, mm, tzinfo=ET)
    except (ValueError, TypeError):
        return None
    return local.astimezone(UTC)


def entry_utc(end_et, title_end, hours, clause_ok="1"):
    end = settlement_end_utc(end_et, title_end, clause_ok)
    if end is None:
        return None
    return end - dt.timedelta(hours=hours)


def _iso(t):
    return t.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def self_test():
    # July is EDT (UTC−4). 23:59 ET is 03:59 UTC the next calendar day.
    weekly = settlement_end_utc("2025-07-13T23:59", "2025-07-14")
    assert _iso(weekly) == "2025-07-14T03:59:00Z", _iso(weekly)
    # A daily clock sits on the title date, not on endDate.
    daily = settlement_end_utc("23:59", "2025-08-15")
    assert _iso(daily) == "2025-08-16T03:59:00Z", _iso(daily)
    # Noon in October is still EDT, so 12:00 ET is 16:00 UTC.
    noon = settlement_end_utc("12:00", "2025-10-15")
    assert _iso(noon) == "2025-10-15T16:00:00Z", _iso(noon)
    # January is EST (UTC−5).
    winter = settlement_end_utc("12:00", "2025-01-15")
    assert _iso(winter) == "2025-01-15T17:00:00Z", _iso(winter)
    # An unread clause is not given Gamma's endDate instead.
    assert settlement_end_utc("23:59", "2025-08-15", clause_ok="0") is None
    assert settlement_end_utc("", "2025-08-15") is None
    # T−24 h is exactly 24 hours before that instant.
    t24 = entry_utc("12:00", "2025-10-15", 24)
    assert _iso(t24) == "2025-10-14T16:00:00Z", _iso(t24)
    print("g2_time self-test ok")


if __name__ == "__main__":
    self_test()
