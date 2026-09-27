// weather — the keyed weather feeds behind Polymarket's temperature markets, READ-ONLY (reference §3.41 and §6).
//
//   GET ?action=probe — verify the stored credentials without placing, publishing or acknowledging anything:
//                       Météo-France's DPObs key (`meteofrance`: which version and header the gateway takes,
//                       Paris-Le Bourget's newest 6-minute reading and the service's delay on the last ten steps)
//                       and the FAA's SWIM SCDS subscription (`faa`: the FAA_SWIM_* secrets' names and forms, a TLS
//                       handshake, an SMF login, a bind to the queue and up to twenty messages, left unacknowledged).
//                       `&only=faa` runs just the parts named.
//
// A function of its own, not a part of `agents`: the FAA's feed needs Solace's npm client in a long-lived session,
// and neither belongs in the isolate that runs the live loop.
//
// Auth: `Authorization: Bearer <CRON_SECRET>` only (pg_net with the Vault `cron_secret`); deployed --no-verify-jwt
// because that bearer is not a Supabase JWT. Secrets: METEO_FRANCE_API_KEY (+ METEO_FRANCE_USERNAME), FAA_SWIM_*.
// None is ever echoed: the probe reports forms, and every string it returns is scrubbed of every one of them.

import { isCron, runWeatherProbe, weatherProbeParts, weatherSecrets } from "./probe.ts";
import { scrubDeep } from "./faa_swim.ts";
import { openSolace, tlsReach } from "./solace.ts";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

if (import.meta.main) Deno.serve(async (req: Request) => {
  try {
    if (!isCron(req, Deno.env.get("CRON_SECRET") ?? "")) return json(401, { error: "unauthorised" });
    const url = new URL(req.url);
    const action = url.searchParams.get("action") ?? "";
    if (action === "probe" && req.method === "GET") {
      return json(200, await runWeatherProbe(weatherProbeParts(url.searchParams.get("only")), { env: Deno.env.toObject(), tlsReach, session: openSolace }));
    }
    return json(404, { error: `unknown action '${action}'` });
  } catch (e) {
    const message = scrubDeep((e instanceof Error ? e.message : String(e)), weatherSecrets(Deno.env.toObject())).slice(0, 200);
    return json(500, { error: "weather crashed", message });
  }
});
