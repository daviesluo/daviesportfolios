"""VIEWS, exploration: one page of Gamma's closed events under the YouTube tag (146), printed, to learn the record's shape.

Public reads only. usage: probe_gamma.py [offset]
"""
import json
import sys
import time
import urllib.request


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "views-research/1.0 (public data only)", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def main():
    off = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    d = get("https://gamma-api.polymarket.com/events?tag_id=146&closed=true&limit=5&offset=%d&_=%d" % (off, int(time.time() * 1000)))
    print(len(d))
    e = d[0]
    print(json.dumps({k: (v if k != "markets" else None) for k, v in e.items()}, indent=1)[:6000])
    print(json.dumps(e["markets"][0], indent=1)[:6000])


if __name__ == "__main__":
    main()
