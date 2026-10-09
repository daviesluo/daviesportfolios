"""S2b capacity: matched volume so far on Smarkets' NFL "Winner" markets for the games in the next 14 days.
GET /v3/events/?parent_id=7763291, /v3/events/{id}/markets/, /v3/markets/{id}/volumes/ (keyless). Prints the total and
per-game volumes (GBP of backers' stakes, as Smarkets reports `volume`). usage: python3 smarkets_volumes.py
"""
import datetime, json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from netget import get_json

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    now = datetime.datetime.now(datetime.timezone.utc)
    st, d = get_json("https://api.smarkets.com/v3/events/?parent_id=7763291&state=upcoming&limit=100")
    out = []
    for e in d["events"]:
        if e.get("type") != "american_football_match" or not e.get("start_datetime"):
            continue
        start = datetime.datetime.fromisoformat(e["start_datetime"].replace("Z", "+00:00"))
        if start > now + datetime.timedelta(days=14):
            continue
        st, mk = get_json(f"https://api.smarkets.com/v3/events/{e['id']}/markets/")
        win = [m for m in (mk or {}).get("markets", []) if m["name"] == "Winner"]
        if not win:
            continue
        st, v = get_json(f"https://api.smarkets.com/v3/markets/{win[0]['id']}/volumes/")
        time.sleep(0.3)
        out.append({"game": e["name"], "start": e["start_datetime"], "volume_gbp": (v or {}).get("volumes", [{}])[0].get("volume")})
    vols = sorted(x["volume_gbp"] or 0 for x in out)
    res = {"at": now.isoformat(), "games": len(out), "total_gbp": sum(vols), "median_gbp": vols[len(vols) // 2] if vols else None,
           "max_gbp": vols[-1] if vols else None, "rows": out}
    json.dump(res, open(os.path.join(HERE, "results", f"smarkets_nfl_volumes_{now:%Y-%m-%d}.json"), "w"), indent=1, sort_keys=True)
    print(json.dumps({k: v for k, v in res.items() if k != "rows"}))


if __name__ == "__main__":
    main()
