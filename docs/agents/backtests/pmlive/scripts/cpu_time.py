"""Runs one command and prints its output, then one JSON line with the CPU its process used: user and system seconds
from getrusage(RUSAGE_CHILDREN), what a shell's `time` reports, every thread counted, and the wall time. For
mid_selection_time.ts (2026-10-02), whose run lines are in its header."""
import json, resource, subprocess, sys, time

t0 = time.monotonic()
r = subprocess.run(sys.argv[1:], capture_output=True, text=True)
wall = time.monotonic() - t0
use = resource.getrusage(resource.RUSAGE_CHILDREN)
sys.stdout.write(r.stdout)
sys.stderr.write(r.stderr)
print(json.dumps({"args": sys.argv[1 + sys.argv[1:].index("mid_selection_time.ts"):] if "mid_selection_time.ts" in sys.argv else sys.argv[1:],
                  "exit": r.returncode, "cpu_user_s": round(use.ru_utime, 3), "cpu_sys_s": round(use.ru_stime, 3), "wall_s": round(wall, 3)}))
sys.exit(r.returncode)
