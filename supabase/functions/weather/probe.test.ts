// Pins for the `weather` function's request handling: only the scheduler's bearer is let in, `?only=` picks the parts,
// a part not asked for makes no request, and the whole report is scrubbed of every weather secret.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { envFirst, isCron, runWeatherProbe, WEATHER_PROBE_PARTS, weatherProbeParts, weatherSecrets } from "./probe.ts";
import type { FaaSession } from "./faa_swim.ts";

const req = (auth?: string) => new Request("https://x.supabase.co/functions/v1/weather?action=probe", { headers: auth ? { authorization: auth } : {} });

Deno.test("isCron: the scheduler's bearer only; no secret configured lets nobody in", () => {
  assertEquals(isCron(req("Bearer s3cret-cron"), "s3cret-cron"), true);
  assertEquals(isCron(req("Bearer wrong"), "s3cret-cron"), false);
  assertEquals(isCron(req(), "s3cret-cron"), false);
  assertEquals(isCron(req("s3cret-cron"), "s3cret-cron"), false);
  assertEquals(isCron(req("Bearer "), ""), false);
});

Deno.test("weatherProbeParts: `?only=` picks parts by name, ignores unknown ones, and no list means every part", () => {
  assertEquals(weatherProbeParts(null), null);
  assertEquals([...weatherProbeParts(" FAA ")!], ["faa"]);
  assertEquals([...weatherProbeParts("meteofrance,nonsense")!], ["meteofrance"]);
  assertEquals(weatherProbeParts("nonsense"), null);
  assertEquals([...WEATHER_PROBE_PARTS], ["meteofrance", "faa"]);
});

Deno.test("envFirst: the first name that is set, trimmed", () => {
  assertEquals(envFirst(["A", "B"], { B: "  x  " }), "x");
  assertEquals(envFirst(["A"], { A: "   " }), "");
});

const ENV = {
  METEO_FRANCE_API_KEY: "planted-mf-key-0123456789",
  METEO_FRANCE_USERNAME: "planted-mf-user",
  FAA_SWIM_HOST: "ems-planted.swim.faa.gov",
  FAA_SWIM_VPN: "ITWS",
  FAA_SWIM_QUEUE: "planted-queue-name.OUT",
  FAA_SWIM_CONNECTION_USERNAME: "planted-conn-user",
  FAA_SWIM_CONNECTION_PASSWORD: "planted-conn-pass",
};

Deno.test("runWeatherProbe: only=faa asks Météo-France nothing; only=meteofrance opens no Solace session", async () => {
  let fetches = 0, sessions = 0;
  const fetchImpl = (async () => { fetches++; return new Response("{}", { status: 401 }); }) as typeof fetch;
  const session = async (): Promise<FaaSession> => {
    sessions++;
    return { connect: async () => ({ up: false, ms: 1, error: "refused" }), consume: async () => ({ bound: false, ms: 1, messages: [] }), close: async () => {} };
  };
  const tlsReach = async () => ({ ok: true, ms: 1 });
  const faaOnly = await runWeatherProbe(new Set(["faa"]), { env: ENV, fetchImpl, tlsReach, session });
  assertEquals([fetches, sessions], [0, 1]);
  assert(!("meteofrance" in faaOnly));
  const mfOnly = await runWeatherProbe(new Set(["meteofrance"]), { env: ENV, fetchImpl, tlsReach, session });
  assertEquals(sessions, 1);
  assert(fetches > 0);
  assert(!("faa" in mfOnly));
  assertEquals((mfOnly.meteofrance as { usernameSet: boolean }).usernameSet, true);
});

Deno.test("runWeatherProbe: whatever a source echoes, no weather secret reaches the report", async () => {
  const echo = Object.values(ENV).join(" | ");
  const fetchImpl = (async () => new Response(`denied: ${echo}`, { status: 401 })) as typeof fetch;
  const session = async (): Promise<FaaSession> => ({
    connect: async () => ({ up: false, ms: 1, error: `refused ${echo}` }),
    consume: async () => ({ bound: false, ms: 1, messages: [] }),
    close: async () => {},
  });
  const out = await runWeatherProbe(null, { env: ENV, fetchImpl, tlsReach: async () => ({ ok: true, ms: 1, error: echo }), session });
  const text = JSON.stringify(out);
  for (const [k, v] of Object.entries(ENV)) if (k !== "FAA_SWIM_VPN") assert(!text.includes(v), `${k} in the report`);
  assert(weatherSecrets(ENV).includes(ENV.METEO_FRANCE_API_KEY));
  assert(!weatherSecrets(ENV).includes("ITWS"));
});
