"""Cut {table, n, md5, text} payloads (`sql/pr5_records.sql`) out of a saved Supabase-connector reply into
<out dir>/<table>.txt, refusing any whose md5 (computed by the database over the same text) or line count does not match.
Only the table, its line count and its md5 are printed. The same cut as `docs/agents/scripts/pr5v/reading_grab.py`.

    python3 -I docs/agents/backtests/queue/scripts/grab.py <saved reply> <data>/pr5
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
    except Exception:  # noqa: BLE001
        pass
    s, e = raw.index("[{"), raw.rindex("}]") + 2
    os.makedirs(out, exist_ok=True)
    done = []
    for r in json.loads(raw[s:e]):
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
