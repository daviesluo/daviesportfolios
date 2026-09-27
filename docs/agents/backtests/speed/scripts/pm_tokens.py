"""SPEED step 3: the token ids the WebSocket and REST probes use — the open markets with the most volume in the last
24 hours, and the open daily-temperature buckets (Gamma, keyless, live data only).

usage: pm_tokens.py <out json>
"""
import json
import sys
import time
import urllib.parse
import urllib.request

UA = "daviesportfolios-speed-study/1.0 (research; public data only)"


def get(url, params):
    req = urllib.request.Request(url + "?" + urllib.parse.urlencode(params), headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def main():
    top = get("https://gamma-api.polymarket.com/markets", {"closed": "false", "active": "true", "order": "volume24hr",
                                                           "ascending": "false", "limit": 20})
    busy = []
    for m in top:
        toks = json.loads(m.get("clobTokenIds") or "[]")
        if toks:
            busy.append({"cond": m.get("conditionId"), "q": (m.get("question") or "")[:80], "tokens": toks,
                         "vol24": m.get("volume24hr")})
    temp = []
    ev = get("https://gamma-api.polymarket.com/events", {"tag_id": "103040", "closed": "false", "limit": 100})
    for e in ev:
        for m in e.get("markets") or []:
            toks = json.loads(m.get("clobTokenIds") or "[]")
            if toks and not m.get("closed"):
                temp.append({"cond": m.get("conditionId"), "q": (m.get("question") or "")[:80], "tokens": toks,
                             "vol24": m.get("volume24hr")})
    temp.sort(key=lambda x: -(x["vol24"] or 0))
    out = {"read_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "busy": busy, "temperature": temp[:60]}
    with open(sys.argv[1], "w") as f:
        json.dump(out, f, indent=1)
    print("busy", len(busy), "temperature", len(temp))
    for b in busy[:5]:
        print(" ", b["vol24"], b["q"])
    for b in temp[:5]:
        print(" ", b["vol24"], b["q"])


if __name__ == "__main__":
    main()
