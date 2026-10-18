# Write MANIFEST.json: the sha256 and md5 of every pull (the raw pulls are NOT committed: about 15 MB; each pull's md5 is
# the database's own over the same text, checked by grab.py), of params.json and of every script and result.
# python3 -I scripts/manifest.py <raw dir>
import sys, os, json, hashlib
raw = sys.argv[1]
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
def h(p, algo):
    d = hashlib.new(algo); d.update(open(p, "rb").read()); return d.hexdigest()
def lines(p):
    return sum(1 for _ in open(p))
m = {
    "study": "CBBOOKS-1 (docs/agents/reviews/2026-10-18-coinbase-books-study.md): Coinbase's recorded books, prints and minute record with Revolut X's books and prints, for strategy research. Davies, 2026-10-18: \"cbbooks留着并利用起来，和revolut x的订单簿一样可以做策略研究\". Not blind.",
    "params": {"file": "params.json", "sha256": h(os.path.join(HERE, "params.json"), "sha256"),
               "frozen_in_commit": "836c6922 (before any pull was analysed)",
               "deviations": [
                   "1. params.json's conventions line says cb_trades.side is the maker's. It is the AGGRESSOR's: the recorder flips Coinbase's maker side on write (agents/cb_rec.ts lines 17-18, 72). Found by describe.py before Q1-Q6 were run (stored 'buy' prints sat at the fresh ask 83-91 % of coins); scripts/load.py reads the stored side as the aggressor's. No rule changed: every rule names the MAKER side, which is now read correctly.",
                   "2. Revolut X: six book reads in the window stored both sides empty; they are skipped (scripts/load.py).",
                   "3. Q4 (ii): a resting Revolut X order fills at most once a minute a side (as one PR5 rung re-placed each minute); params.json did not say."]},
    "read": "production, SELECT only, through the Supabase connector, 2026-10-18 04:21-04:26 UTC (sql/pull_books.sql per product and half, sql/pull_trades.sql per product (USDC-EUR in halves), sql/pull_revx.sql, sql/pull_paper.sql). Window 2026-10-10T03:00Z to 2026-10-18T03:00Z; books and prints pulled to 04:10Z for markouts. cb_trades is kept ten days: the prints of 10-10 are pruned from about 10-20, so these pulls cannot be re-run in full after that.",
    "run": [
        "for each sql/pull_*.sql (placeholders as each file says): save the connector's reply, then python3 -I scripts/grab.py <reply> <raw dir>",
        "python3 -I scripts/describe.py <raw dir>   # results/describe.json (D, Q7)",
        "python3 -I scripts/queue.py <raw dir>      # results/queue.json (Q1, Q5, Q6), about 20 s",
        "python3 -I scripts/paper.py <raw dir>      # results/paper.json (Q2)",
        "python3 -I scripts/cross.py <raw dir>      # results/cross.json (Q3, Q4)",
        "python3 -I scripts/manifest.py <raw dir>"],
    "pulls": {}, "scripts": {}, "results": {}}
for f in sorted(os.listdir(raw)):
    if f.endswith(".txt"):
        p = os.path.join(raw, f)
        text = open(p).read()
        if text.endswith("\n"): text = text[:-1]
        m["pulls"][f] = {"lines": lines(p), "md5_db": hashlib.md5(text.encode()).hexdigest(), "sha256": h(p, "sha256"), "bytes": os.path.getsize(p)}
for d in ("scripts", "sql", "results"):
    for f in sorted(os.listdir(os.path.join(HERE, d))):
        if f.endswith((".py", ".sql", ".json")):
            m["scripts" if d != "results" else "results"][f"{d}/{f}"] = h(os.path.join(HERE, d, f), "sha256")
json.dump(m, open(os.path.join(HERE, "MANIFEST.json"), "w"), indent=1)
print(len(m["pulls"]), "pulls")
