// Pins for the read-only Météo-France DPObs client and the probe's `meteofrance` part: the key rides in a header and
// never in a URL, the report carries no part of it or of the account's claims (not even from a gateway that echoes
// them back), the gateway's own choice of header is found and reported, and a reading's delays are read right.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { findStations, KELVIN, meteoFranceProbe, mfKeyForm, MF_STEP_MS, parseCsv, parseReadings, pastSteps, readingRow } from "./meteofrance.ts";

const b64url = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const SUB = "planted.user@carbon.super", OWNER = "planted-owner-name", IP = "203.0.113.77";
/** A key in WSO2's shape: a JWT whose claims name the subject, the owner and an IP pin the report must not repeat. */
const KEY = [
  b64url({ alg: "RS256", typ: "JWT", kid: "planted-kid" }),
  b64url({
    sub: SUB, application: { owner: OWNER, name: "DefaultApplication", tier: "Unlimited" }, keytype: "PRODUCTION",
    tierInfo: { "50PerMin": { tierQuotaType: "requestCount" } }, permittedIP: IP, permittedReferer: "",
    subscribedAPIs: [{ name: "DonneesPubliquesObservation", context: "/public/DPObs/v1", version: "v1", subscriptionTier: "50PerMin", subscriberTenantDomain: "carbon.super" }],
    iat: 1_790_470_000, exp: 1_885_078_000, jti: "planted-jti",
  }),
  "plantedSignatureXYZ0123456789",
].join(".");

const leaks = (text: string, secret: string) => {
  for (let i = 0; i + 10 <= secret.length; i++) if (text.includes(secret.slice(i, i + 10))) return true;
  return false;
};

const STATIONS = [
  "Id_station;Id_omm;Nom_usuel;Latitude;Longitude;Altitude;Date_ouverture;Pack",
  "93013001;07150;LE BOURGET;48.967;2.428;52;1930-01-01;RADOME",
  "95088001;07157;ROISSY;49.015;2.534;112;1974-01-01;RADOME",
  "01014002;;ARBENT;46.278;5.669;534;2003-10-01;RADOME",
].join("\n");

/** A gateway that takes the key in `accept` and answers like DPObs v1, recording every request it saw. */
function gateway(accept: "apikey" | "bearer", now: number, opts: { echo?: boolean; formats?: string[] } = {}) {
  const seen: { method: string; url: string; headers: Record<string, string> }[] = [];
  const fetchImpl = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    seen.push({ method: init?.method ?? "GET", url: url.toString(), headers });
    const okAuth = accept === "apikey" ? headers.apikey === KEY : headers.authorization === `Bearer ${KEY}`;
    const echo = opts.echo ? ` echo apikey=${headers.apikey ?? ""} auth=${headers.authorization ?? ""} ${SUB} ${OWNER} ${IP}` : "";
    if (!okAuth) return new Response(`{"code":"900902","message":"Missing Credentials"${echo ? `,"x":"${echo}"` : ""}}`, { status: 401 });
    if (!url.pathname.startsWith("/public/DPObs/v1/")) return new Response("no such version" + echo, { status: 403 });
    if (url.pathname.endsWith("/liste-stations")) return new Response(STATIONS + (opts.echo ? `\n99999999;;${echo};0;0;0;x;x` : ""), { status: 200, headers: { "content-type": "text/csv" } });
    if (url.pathname.endsWith("/station/infrahoraire-6m")) {
      const f = url.searchParams.get("format") ?? "";
      if (!(opts.formats ?? ["json"]).includes(f)) return new Response("format not supported", { status: 400 });
      const date = url.searchParams.get("date");
      const validity = date ? Date.parse(date) : Math.floor((now - 9 * 60_000) / MF_STEP_MS) * MF_STEP_MS;
      const row = { geo_id_insee: "93013001", reference_time: new Date(validity + 300_000).toISOString(), insert_time: new Date(validity + 250_000).toISOString(), validity_time: new Date(validity).toISOString(), t: 288.15 };
      const body = f === "geojson" ? JSON.stringify({ type: "FeatureCollection", features: [{ type: "Feature", properties: row }] }) : JSON.stringify([row]);
      return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { fetchImpl, seen };
}

const NOW = Date.parse("2026-09-27T05:02:30Z");

Deno.test("meteoFranceProbe: the key goes in the apikey header, never a URL, and every request is a GET", async () => {
  const g = gateway("apikey", NOW);
  const out = await meteoFranceProbe({ key: KEY, fetchImpl: g.fetchImpl }, { now: () => NOW });
  assertEquals(out.auth, "apikey");
  assertEquals(out.version, "v1");
  assert(g.seen.length > 0 && g.seen.length <= 20, `requests: ${g.seen.length}`);
  for (const r of g.seen) {
    assertEquals(r.method, "GET");
    assert(!leaks(r.url, KEY), `key in a URL: ${r.url}`);
  }
  assert(g.seen.every((r) => r.headers.apikey === KEY || r.headers.authorization === `Bearer ${KEY}`));
});

Deno.test("meteoFranceProbe: a gateway that takes only a bearer token is found, and the report says so", async () => {
  const g = gateway("bearer", NOW);
  const out = await meteoFranceProbe({ key: KEY, fetchImpl: g.fetchImpl }, { now: () => NOW });
  assertEquals(out.auth, "bearer");
  const access = out.access as { version: string; auth: string; status: number }[];
  assertEquals(access[0], { ...access[0], version: "v1", auth: "apikey", status: 401 });
  assertEquals(access[1], { ...access[1], version: "v1", auth: "bearer", status: 200 });
});

Deno.test("meteoFranceProbe: finds Le Bourget and reads its newest reading and the last ten steps with their delays", async () => {
  const g = gateway("apikey", NOW);
  const out = await meteoFranceProbe({ key: KEY, fetchImpl: g.fetchImpl }, { now: () => NOW });
  assertEquals((out.stations as { id: string }[]).map((s) => s.id), ["93013001"]);
  const latest = (out.latest as { reading: Record<string, unknown>; format: string });
  assertEquals(latest.format, "json");
  assertEquals(latest.reading.tC, 15);
  assertEquals(latest.reading.insertLagS, 250);
  assertEquals(latest.reading.referenceLagS, 300);
  const history = out.history as { steps: number; insertLagS: { median: number } };
  assertEquals(history.steps, 10);
  assertEquals(history.insertLagS.median, 250);
  // the list on each version (v2 refused under the header v1 took), one newest reading, ten steps
  assertEquals(out.calls, 13);
});

Deno.test("meteoFranceProbe: a version that refuses json is read as geojson", async () => {
  const g = gateway("apikey", NOW, { formats: ["geojson"] });
  const out = await meteoFranceProbe({ key: KEY, fetchImpl: g.fetchImpl }, { now: () => NOW });
  const latest = out.latest as { format: string; formats: { status: number }[]; reading: { tC: number } };
  assertEquals(latest.format, "geojson");
  assertEquals(latest.formats.map((f) => f.status), [400, 200]);
  assertEquals(latest.reading.tC, 15);
});

Deno.test("meteoFranceProbe: a gateway that echoes the key and the account's claims gets none of them into the report", async () => {
  const g = gateway("bearer", NOW, { echo: true });
  const out = await meteoFranceProbe({ key: KEY, fetchImpl: g.fetchImpl }, { now: () => NOW, secrets: [SUB, OWNER, IP] });
  const text = JSON.stringify(out);
  assert(!leaks(text, KEY), "the key leaked");
  for (const s of [SUB, OWNER, IP]) assert(!text.includes(s), `${s} leaked`);
});

Deno.test("mfKeyForm: reports the key's expiry, APIs and rate, and not its subject, owner or pinned IP", () => {
  const f = mfKeyForm(KEY);
  assertEquals(f.form, "jwt");
  assertEquals(f.expiresAt, new Date(1_885_078_000_000).toISOString());
  assertEquals(f.keyType, "PRODUCTION");
  assertEquals(f.tiers, ["50PerMin"]);
  assertEquals(f.subscribedApis, [{ name: "DonneesPubliquesObservation", context: "/public/DPObs/v1", version: "v1", tier: "50PerMin" }]);
  assertEquals(f.ipPinned, true);
  assertEquals(f.refererPinned, false);
  const text = JSON.stringify(f);
  for (const s of [SUB, OWNER, IP, "planted-kid", "planted-jti", "plantedSignature"]) assert(!text.includes(s), `${s} in the form`);
  assertEquals(mfKeyForm("0f8fad5b-d9cb-469f-a165-70867728950e"), { form: "uuid", length: 36 });
  assertEquals(mfKeyForm("not-a-jwt"), { form: "opaque", length: 9 });
});

Deno.test("parseCsv, findStations: the list's own column names, either separator", () => {
  assertEquals(findStations(parseCsv(STATIONS), /BOURGET/i), [{ id: "93013001", name: "LE BOURGET", lat: "48.967", lon: "2.428" }]);
  const comma = "id,name\n93013001,Le Bourget\n94054001,Orly";
  assertEquals(findStations(parseCsv(comma), /orly/i).map((s) => s.id), ["94054001"]);
});

Deno.test("parseReadings: JSON array, GeoJSON and CSV give the same record", () => {
  const row = { validity_time: "2026-09-27T04:48:00Z", t: 285.35 };
  assertEquals(parseReadings(JSON.stringify([row])), [row]);
  assertEquals(parseReadings(JSON.stringify({ type: "FeatureCollection", features: [{ properties: row }] })), [row]);
  assertEquals(parseReadings("validity_time;t\n2026-09-27T04:48:00Z;285.35"), [{ validity_time: "2026-09-27T04:48:00Z", t: "285.35" }]);
});

Deno.test("readingRow: kelvin to °C to a tenth, delays in seconds, an absent temperature stays absent", () => {
  const r = readingRow({ validity_time: "2026-09-27T04:48:00Z", insert_time: "2026-09-27T04:52:10Z", t: 285.35 }, Date.parse("2026-09-27T04:53:00Z"));
  assertEquals(r.tC, Math.round((285.35 - KELVIN) * 10) / 10);
  assertEquals(r.insertLagS, 250);
  assertEquals(r.ageAtReadS, 300);
  assertEquals(readingRow({ validity_time: "2026-09-27T04:48:00Z", t: "" }).tC, null);
  assertEquals(readingRow({ validity_time: "2026-09-27T04:48:00Z" }).tC, null);
});

Deno.test("pastSteps: the six-minute steps before now, newest first, the step still forming left out", () => {
  assertEquals(pastSteps(Date.parse("2026-09-27T05:02:30Z"), 3), ["2026-09-27T04:54:00Z", "2026-09-27T04:48:00Z", "2026-09-27T04:42:00Z"]);
  assertEquals(pastSteps(Date.parse("2026-09-27T05:00:00Z"), 1), ["2026-09-27T04:54:00Z"]);
});
