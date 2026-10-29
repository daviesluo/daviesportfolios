// One real minute of the recorder (`agents/fx_rec.ts`) against the two live keyless hosts, on a stub database: prints its
// report, the rows' read counts and the CPU the process used over the minute (from /proc/self/stat, Linux only).
// Starts at the next whole minute, as the cron call does.
//
// usage (from the repository root): npx --yes deno@1.46.3 run -A docs/agents/backtests/fx_second/scripts/cpu.ts
import { runFxRec } from "../../../../../supabase/functions/agents/fx_rec.ts";

const rows: Record<string, unknown[]> = {};
const db = {
  select: () => Promise.resolve([{ state: {} }]),
  upsert: (t: string, r: unknown[]) => { rows[t] = r; return Promise.resolve(); },
} as never;
const cpu = () => {
  const f = Deno.readTextFileSync("/proc/self/stat").split(") ")[1].split(" ");
  return { u: Number(f[11]) * 10, s: Number(f[12]) * 10 }; // clock ticks of 10 ms
};
await new Promise((r) => setTimeout(r, 60e3 - (Date.now() % 60e3) + 300));
const c0 = cpu(), t0 = Date.now();
const report = await runFxRec({ db, now: Date.now() });
const c1 = cpu();
console.log(JSON.stringify({ wallMs: Date.now() - t0, cpuUserMs: c1.u - c0.u, cpuSysMs: c1.s - c0.s, report }));
for (const x of (rows.fx_ticks ?? []) as Record<string, unknown>[]) {
  console.log(x.source, x.pair, "kept", (x.recv_ms as number[]).length, "reads", x.reads, "failed", x.failed, x.last_error ?? "");
}
