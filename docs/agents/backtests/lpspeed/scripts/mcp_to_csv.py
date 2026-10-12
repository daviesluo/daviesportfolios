"""Turn a saved Supabase-connector reply whose single row is one `string_agg` column (CSV text) into a CSV file.

Usage: python3 -I mcp_to_csv.py <saved reply> <out.csv>
The reply is the connector's JSON envelope; the rows sit between its untrusted-data markers as a JSON array.
"""
import json
import re
import sys

raw = open(sys.argv[1], encoding="utf-8").read()
outer = json.loads(raw)["result"] if raw.lstrip().startswith("{") else raw
m = re.search(r"<untrusted-data-[0-9a-f-]+>\s*(\[.*\])\s*</untrusted-data", outer, re.S)
rows = json.loads(m.group(1))
text = next(iter(rows[0].values()))
open(sys.argv[2], "w", encoding="utf-8").write(text + "\n")
print(sys.argv[2], text.count("\n"), "data lines")
