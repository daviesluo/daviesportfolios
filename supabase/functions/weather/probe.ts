// The `weather` function's request handling, apart from its entry point so the tests can load it without the Solace
// client: who may call, which probe parts run, and the probe itself with every transport injected.

import { constantTimeEqual } from "../_shared/token.ts";
import { MF_KEY_NAMES, meteoFranceProbe } from "./meteofrance.ts";
import { faaProbe, faaScrubList, faaSecrets, scrubDeep, type FaaSession } from "./faa_swim.ts";

/** Only the scheduler's bearer (pg_net with the Vault `cron_secret`): nothing here is for the page. */
export function isCron(req: Request, cronSecret: string): boolean {
  const auth = req.headers.get("authorization") ?? "";
  return cronSecret !== "" && auth.startsWith("Bearer ") && constantTimeEqual(auth.slice(7).trim(), cronSecret);
}

/** The probe's parts, each a credential of its own. `?only=faa` runs just that one; anything unknown is dropped. */
export const WEATHER_PROBE_PARTS = ["meteofrance", "faa"] as const;
export function weatherProbeParts(only: string | null): Set<string> | null {
  if (!only) return null;
  const picked = new Set(only.split(",").map((x) => x.trim().toLowerCase()).filter((x) => (WEATHER_PROBE_PARTS as readonly string[]).includes(x)));
  return picked.size ? picked : null;
}

/** The first of `names` that is set, trimmed; empty when none is. */
export function envFirst(names: readonly string[], env: Record<string, string>): string {
  for (const n of names) { const v = env[n]; if (v && v.trim()) return v.trim(); }
  return "";
}

export type WeatherProbeDeps = {
  env: Record<string, string>;
  fetchImpl?: typeof fetch;
  tlsReach: (host: string, port: number) => Promise<{ ok: boolean; ms: number; error?: string }>;
  session: () => Promise<FaaSession>;
  now?: () => number;
};

/** Every weather secret's value, for scrubbing whatever a request returns. */
export function weatherSecrets(env: Record<string, string>): string[] {
  return [...MF_KEY_NAMES, "METEO_FRANCE_USERNAME", "Meteo_France_USERNAME", "METEOFRANCE_USERNAME"].map((n) => env[n] ?? "").concat(faaScrubList(faaSecrets(env)));
}

/** Every part asked for, read-only. The report is scrubbed of every weather secret once more at the end. */
export async function runWeatherProbe(only: Set<string> | null, deps: WeatherProbeDeps): Promise<Record<string, unknown>> {
  const want = (p: string) => !only || only.has(p);
  const out: Record<string, unknown> = { at: new Date((deps.now ?? Date.now)()).toISOString(), parts: only ? [...only] : [...WEATHER_PROBE_PARTS] };
  const mfKey = envFirst(MF_KEY_NAMES, deps.env);
  const mfUser = envFirst(["METEO_FRANCE_USERNAME", "Meteo_France_USERNAME", "METEOFRANCE_USERNAME"], deps.env);
  if (want("meteofrance")) {
    out.meteofrance = mfKey
      ? { usernameSet: mfUser !== "", ...(await meteoFranceProbe({ key: mfKey, fetchImpl: deps.fetchImpl }, { now: deps.now, secrets: mfUser ? [mfUser] : [] })) }
      : { error: "METEO_FRANCE_API_KEY is not set", usernameSet: mfUser !== "" };
  }
  if (want("faa")) out.faa = await faaProbe({ env: deps.env, tlsReach: deps.tlsReach, session: deps.session, now: deps.now });
  return scrubDeep(out, weatherSecrets(deps.env));
}
