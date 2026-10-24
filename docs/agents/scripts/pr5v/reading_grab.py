"""Cut {table, n, md5, text} payloads out of a saved Supabase-connector reply into <out dir>/<table>.txt, refusing any whose
md5 (computed by the database over the same text) or line count does not match. Nothing of a row is printed: only the
table, its line count and its md5. For PR5V's and rule D's readings (`reading_pull.sql`, `reading_pull_ruled.sql`);
the same cut as `backtests/pr5_review/scripts/grab_text.py`.

    python3 -I docs/agents/scripts/pr5v/reading_grab.py <saved reply> <out dir>
"""
import hashlib, json, os, sys


def grab(src, out):
    raw = open(src).read()
    try:
        outer = json.loads(raw)
        if isinstance(outer, dict) and "result" in outer:
            raw = outer["result"]
        elif isinstance(outer, list) and outer and isinstance(outer[0], dict) and "text" in outer[0]:
            raw = outer[0]["text"]
    except Exception:  # noqa: BLE001  (a reply saved as plain text)
        pass
    s, e = raw.index("[{"), raw.rindex("}]") + 2
    rows = json.loads(raw[s:e])
    os.makedirs(out, exist_ok=True)
    done = []
    for r in rows:
        p = r["payload"]
        text = p["text"] or ""
        md5 = hashlib.md5(text.encode()).hexdigest()
        n = len(text.split("\n")) if text else 0
        if md5 != p["md5"] or n != p["n"]:
            raise SystemExit(f"{p['table']}: md5 {md5} vs {p['md5']}, lines {n} vs {p['n']}")
        with open(os.path.join(out, f"{p['table']}.txt"), "w") as f:
            f.write(text + "\n" if text else "")
        done.append((p["table"], p["n"], p["md5"]))
    return done


if __name__ == "__main__":
    for t, n, h in grab(sys.argv[1], sys.argv[2]):
        print(t, n, h)
