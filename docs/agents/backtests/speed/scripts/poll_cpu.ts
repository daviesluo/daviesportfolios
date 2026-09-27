// SPEED step 3: the CPU one light poll costs, measured in Deno (the Edge runtime's engine) on this machine.
//
// Sixty polls, one a second, of the fastest keyless METAR source (tgftp's station file, a conditional GET that
// answers 304 until the file changes, as a real poller would send it) plus the parse a rule needs, with this
// process's user + system CPU read from /proc/self/stat before and after. It is a cross-check of the production
// numbers (the Edge logs' `cpu_time_used` per call), not a substitute: here TLS runs to a local proxy.
//
// usage: deno run --allow-all poll_cpu.ts <station> <polls>   (reading /proc/self/stat needs --allow-all)
const station = Deno.args[0] ?? "KLGA";
const n = Number(Deno.args[1] ?? 60);
const UA = "daviesportfolios-speed-study/1.0 (research; public data only)";
const HZ = 100; // Linux USER_HZ

async function cpuTicks(): Promise<number> {
  const s = await Deno.readTextFile("/proc/self/stat");
  const f = s.slice(s.lastIndexOf(")") + 2).split(" ");
  return Number(f[11]) + Number(f[12]); // utime + stime (fields 14, 15)
}

let lm: string | null = null;
let got304 = 0, got200 = 0;
const wall: number[] = [];
const c0 = await cpuTicks();
const t0 = performance.now();
for (let i = 0; i < n; i++) {
  const a = performance.now();
  const r = await fetch(`https://tgftp.nws.noaa.gov/data/observations/metar/stations/${station}.TXT`, {
    headers: lm ? { "User-Agent": UA, "If-Modified-Since": lm } : { "User-Agent": UA },
  });
  const body = await r.text();
  if (r.status === 200) {
    got200++;
    lm = r.headers.get("last-modified");
    const raw = body.split("\n")[1] ?? "";
    const m = / (M?\d{2})\/(M?\d{2})? /.exec(raw); // the temperature group a rule reads
    if (!m) console.error("no temperature group", raw);
  } else if (r.status === 304) got304++;
  wall.push(performance.now() - a);
  await new Promise((res) => setTimeout(res, Math.max(0, 1000 - (performance.now() - a))));
}
const c1 = await cpuTicks();
wall.sort((x, y) => x - y);
const out = {
  runtime: `deno ${Deno.version.deno}`, station, polls: n, status_200: got200, status_304: got304,
  cpu_ms_total: ((c1 - c0) * 1000) / HZ, cpu_ms_per_poll: ((c1 - c0) * 1000) / HZ / n,
  wall_ms_per_request_p50: Math.round(wall[Math.floor(n / 2)]), wall_ms_per_request_p90: Math.round(wall[Math.floor(n * 0.9)]),
  seconds: Math.round((performance.now() - t0) / 1000),
};
console.log(JSON.stringify(out, null, 1));
