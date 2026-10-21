// Pins the targets function's request handling (index.ts): each path checks its own credential first; the cron path
// writes its beat before its work (0075) and never when the bearer is wrong; the page's GET needs the app token.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { type Deps, handle } from "./index.ts";

const URL_ = "https://x.supabase.co/functions/v1/targets";
function deps(over: Partial<Deps> = {}) {
  const log: string[] = [];
  const d: Deps = {
    cronSecret: "s3cret",
    beat: (k) => { log.push(`beat:${k}`); return Promise.resolve(true); },
    run: (force) => { log.push(`run:${force}`); return Promise.resolve({ slot: "x", written: 1, errors: [] }); },
    read: () => { log.push("read"); return Promise.resolve({ slot: null, asOf: null, rows: {} }); },
    verify: (t) => { log.push(`verify:${t}`); return Promise.resolve(t === "good" ? { role: "ro" } : null); },
    report: (kind) => { log.push(`report:${kind}`); return Promise.resolve(); },
    ...over,
  };
  return { d, log };
}

Deno.test("the cron path: bearer checked, then the beat, then the run", async () => {
  const { d, log } = deps();
  const res = await handle(new Request(URL_, { method: "POST", headers: { Authorization: "Bearer s3cret" } }), d);
  assertEquals([res.status, log], [200, ["beat:targets", "run:false"]]);
  const forced = deps();
  await handle(new Request(`${URL_}?force=1`, { method: "POST", headers: { Authorization: "Bearer s3cret" } }), forced.d);
  assertEquals(forced.log, ["beat:targets", "run:true"]);
});

Deno.test("a wrong or missing bearer: 403, no beat, no run", async () => {
  for (const h of [{ Authorization: "Bearer nope" }, {} as Record<string, string>]) {
    const { d, log } = deps();
    const res = await handle(new Request(URL_, { method: "POST", headers: h }), d);
    assertEquals([res.status, log], [403, []]);
  }
  // An unset secret opens nothing.
  const { d, log } = deps({ cronSecret: "" });
  assertEquals([(await handle(new Request(URL_, { method: "POST", headers: { Authorization: "Bearer " } }), d)).status, log], [403, []]);
});

Deno.test("a run's errors are reported once; a beat that fails does not stop the run", async () => {
  const { d, log } = deps({ run: () => Promise.resolve({ errors: ["yahoo: no crumb"] }), beat: () => Promise.reject(new Error("db down")) });
  const res = await handle(new Request(URL_, { method: "POST", headers: { Authorization: "Bearer s3cret" } }), d);
  assertEquals([res.status, log], [200, ["report:targets.run"]]);
});

Deno.test("the page's GET: the app token, then the read; without it 401 and nothing read", async () => {
  const ok = deps();
  const res = await handle(new Request(URL_, { headers: { "x-app-token": "good" } }), ok.d);
  assertEquals([res.status, ok.log, await res.json()], [200, ["verify:good", "read"], { slot: null, asOf: null, rows: {} }]);
  const bad = deps();
  assertEquals([(await handle(new Request(URL_, { headers: { "x-app-token": "bad" } }), bad.d)).status, bad.log], [401, ["verify:bad"]]);
  const put = deps();
  assertEquals([(await handle(new Request(URL_, { method: "PUT" }), put.d)).status, put.log], [405, []]);
});
