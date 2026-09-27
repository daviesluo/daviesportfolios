"""VIEWS exploration: search the stored pre-boundary comments for a pattern (printed; nothing written).

usage: comments_grep.py <regex> [max]
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vcommon as V  # noqa: E402


def main():
    pat = re.compile(sys.argv[1], re.I)
    mx = int(sys.argv[2]) if len(sys.argv) > 2 else 80
    cs = []
    for p in V.pmnet.list_json(os.path.join(V.DATA, "comments")):
        d = V.load(p)
        for c in d["comments"]:
            c["src"] = os.path.basename(p)
            cs.append(c)
    cs.sort(key=lambda c: c["t"])
    hits = [c for c in cs if pat.search(c["body"] or "")]
    print("comments", len(cs), "hits", len(hits))
    for c in hits[:mx]:
        print(V.iso(c["t"]), c["src"][:18], "|", (c["body"] or "")[:300].replace("\n", " "))


if __name__ == "__main__":
    main()
