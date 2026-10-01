// Pins the beat key on both sides, what a function writes and what the watchdog looks for, on every row of the list as
// 0075 seeded it (src/cron_jobs.test.js pins that list against the migration), and the beat's one write: its row, its
// request, its timeout, and that it never throws.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { BEAT_TABLE, BEAT_TIMEOUT_MS, beatKey, beatKeyOfPath, beatKeyOfRequest, minuteOf, writeBeat } from "./beats.ts";

const EDGE = "https://flmvxigozjuizpckllvk.supabase.co/functions/v1/";
/** 0075's seed, in its order. */
const SEED_PATHS = [
  "agents?action=tick", "agents?action=quotes", "agents?action=quotesv", "agents?action=quotesd", "agents?action=books",
  "agents?action=pmrw", "agents?action=pmrw-e", "agents?action=pmrw-x", "agents?action=pmrwc", "agents?action=pmrwc-e",
  "agents?action=pmrwc-x", "agents?action=views", "agents?action=pmlive&forceFunctionRegion=eu-west-1",
  "agents?action=pmrw-select", "agents?action=pmrwc-select", "snapshot-record", "overnight-record", "edge-watchdog",
];

Deno.test("beatKeyOfPath — the function, and ?action= with the action; nothing else of the path", () => {
  assertEquals(beatKeyOfPath("agents?action=tick"), "agents?action=tick");
  assertEquals(beatKeyOfPath("agents?action=pmlive&forceFunctionRegion=eu-west-1"), "agents?action=pmlive");
  assertEquals(beatKeyOfPath("agents?forceFunctionRegion=eu-west-1&action=pmlive"), "agents?action=pmlive");
  assertEquals(beatKeyOfPath("agents?action=quotes&wait=0"), "agents?action=quotes");
  assertEquals(beatKeyOfPath("agents?wait=0"), "agents");
  assertEquals(beatKeyOfPath("snapshot-record"), "snapshot-record");
  assertEquals(beatKey("edge-watchdog", null), "edge-watchdog");
  assertEquals(beatKey("agents", ""), "agents");
});

Deno.test("every row of 0075's list: the key its function writes is the key the watchdog looks for, and no two rows share one", () => {
  for (const p of SEED_PATHS) {
    const fn = p.split("?")[0];
    assertEquals(beatKeyOfRequest(fn, EDGE + p), beatKeyOfPath(p), p);
    // However the platform spells the function's own URL, only the action is read.
    assertEquals(beatKeyOfRequest(fn, `http://localhost:9999/${p}`), beatKeyOfPath(p), p);
  }
  assertEquals(new Set(SEED_PATHS.map(beatKeyOfPath)).size, SEED_PATHS.length);
  assertEquals(beatKeyOfPath(SEED_PATHS[12]), "agents?action=pmlive");
});

Deno.test("minuteOf — the start of the UTC minute an instant falls in", () => {
  assertEquals(minuteOf(Date.UTC(2026, 9, 1, 15, 4, 59, 999)), Date.UTC(2026, 9, 1, 15, 4));
  assertEquals(minuteOf(Date.UTC(2026, 9, 1, 15, 5)), Date.UTC(2026, 9, 1, 15, 5));
});

Deno.test("writeBeat — one insert of the key alone (the database stamps the minute) that keeps a minute's first beat; false, never a throw, when it cannot be written", async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  const ok: typeof fetch = (url, init) => { seen.push({ url: String(url), init: init! }); return Promise.resolve(new Response("", { status: 201 })); };
  assert(await writeBeat("agents?action=tick", { sbUrl: "https://x.supabase.co", serviceKey: "k", fetchImpl: ok }));
  assertEquals(seen.length, 1);
  assertEquals(seen[0].url, `https://x.supabase.co/rest/v1/${BEAT_TABLE}?on_conflict=minute,path`);
  assertEquals(seen[0].init.method, "POST");
  const h = seen[0].init.headers as Record<string, string>;
  assertEquals(h.Prefer, "resolution=ignore-duplicates,return=minimal");
  assertEquals([h.apikey, h.Authorization], ["k", "Bearer k"]);
  assertEquals(JSON.parse(String(seen[0].init.body)), { path: "agents?action=tick" });
  assert(seen[0].init.signal instanceof AbortSignal);

  const env = { sbUrl: "https://x.supabase.co", serviceKey: "k" };
  assertEquals(await writeBeat("x", { ...env, fetchImpl: () => Promise.resolve(new Response('{"code":"PGRST205"}', { status: 404 })) }), false);
  assertEquals(await writeBeat("x", { ...env, fetchImpl: () => Promise.reject(new TypeError("network down")) }), false);
  // A database that does not answer costs the call its timeout, then the work goes on without a beat.
  const t0 = Date.now();
  const hung: typeof fetch = (_u, init) => new Promise((_res, rej) => init!.signal!.addEventListener("abort", () => rej(init!.signal!.reason)));
  assertEquals(await writeBeat("x", { ...env, timeoutMs: 30, fetchImpl: hung }), false);
  assert(Date.now() - t0 < 1_000);
  // No credentials: nothing is sent.
  let sent = 0;
  assertEquals(await writeBeat("x", { sbUrl: "", serviceKey: "", fetchImpl: () => { sent++; return Promise.resolve(new Response("")); } }), false);
  assertEquals(sent, 0);
  assertEquals(BEAT_TIMEOUT_MS, 2_000);
});
