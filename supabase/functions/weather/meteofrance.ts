// Météo-France's public observation API ("DonneesPubliquesObservation", DPObs), READ-ONLY, keyed by the API key
// Davies' portal account issued on 2026-09-27. Its 6-minute readings of Paris-Le Bourget (LFPB) are the one keyed feed
// WXSRC (reference §3.41) found that might reach the Paris temperature market's deciding reading before the takers do.
//
// The key travels in a header, never in a URL, and every string this file reports is scrubbed of it before it is cut.
// The portal is a WSO2 gateway: an API key goes in an `apikey` header, an OAuth2 access token in `Authorization:
// Bearer`; the probe tries the first and falls back to the second, and says which one the gateway took. The free plan
// allows 50 requests a minute; the service keeps 24 hours of readings.

export const MF_BASE = "https://public-api.meteofrance.fr/public/DPObs";
/** Both published versions; the key's own `subscribedAPIs` claim says which one the account holds. */
export const MF_VERSIONS = ["v1", "v2"] as const;
export type MfVersion = typeof MF_VERSIONS[number];
export const MF_KEY_NAMES = ["METEO_FRANCE_API_KEY", "Meteo_France_API_KEY", "METEOFRANCE_API_KEY", "meteo_france_api_key"];
/** Paris-Le Bourget, the station behind Polymarket's Paris market (WXSRC's table: LFPB). */
export const MF_STATION_MATCH = /BOURGET/i;
/** Readings come every six minutes, on the minute (:00, :06 … :54), so the METAR's :00 and :30 are among them. */
export const MF_STEP_MS = 6 * 60_000;
/** The probe reads this many past steps by date, one request each, for the service's own insert delay. */
export const MF_PROBE_HISTORY = 10;
/** Kelvin to Celsius: DPObs reports `t` in kelvin. */
export const KELVIN = 273.15;

export type MfAuth = "apikey" | "bearer";
export type MfEnv = { key: string; base?: string; fetchImpl?: typeof fetch };
export type MfReply = { ok: boolean; status: number; text: string; contentType: string; error?: string };

/** `s` with every occurrence of each secret replaced; run BEFORE any cut, or a cut could keep part of one. */
export function scrubText(s: string, secrets: readonly string[]): string {
  let out = s;
  for (const v of secrets) if (v && v.length >= 4) out = out.split(v).join("[redacted]");
  return out;
}

function b64urlJson(part: string): Record<string, unknown> | null {
  try {
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    const obj = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
    return obj && typeof obj === "object" ? obj as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

const isoSec = (x: unknown): string | null => (typeof x === "number" && Number.isFinite(x) ? new Date(x * 1000).toISOString() : null);

/**
 * The key's shape, never a character of it. A WSO2 API key is a signed JWT whose claims say when it expires, which
 * APIs it is subscribed to and at what rate; those claims are reported, while the subject, the application's owner and
 * any IP or referrer it is pinned to are not (whether a pin is set is: a pin would block Supabase's egress).
 */
export function mfKeyForm(key: string): Record<string, unknown> {
  const parts = key.split(".");
  if (parts.length === 3 && parts.every((p) => /^[A-Za-z0-9_-]+={0,2}$/.test(p))) {
    const h = b64urlJson(parts[0]), p = b64urlJson(parts[1]);
    if (h && p) {
      const apis = Array.isArray(p.subscribedAPIs) ? p.subscribedAPIs as Record<string, unknown>[] : [];
      return {
        form: "jwt", length: key.length, alg: h.alg ?? null,
        issuedAt: isoSec(p.iat), expiresAt: isoSec(p.exp), keyType: p.keytype ?? null,
        tiers: p.tierInfo && typeof p.tierInfo === "object" ? Object.keys(p.tierInfo as object) : [],
        subscribedApis: apis.map((a) => ({ name: a?.name ?? null, context: a?.context ?? null, version: a?.version ?? null, tier: a?.subscriptionTier ?? null })),
        ipPinned: typeof p.permittedIP === "string" ? p.permittedIP.trim() !== "" : null,
        refererPinned: typeof p.permittedReferer === "string" ? p.permittedReferer.trim() !== "" : null,
      };
    }
  }
  return { form: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key) ? "uuid" : "opaque", length: key.length };
}

export function mfHeaders(key: string, auth: MfAuth): Record<string, string> {
  return auth === "apikey" ? { apikey: key, Accept: "*/*" } : { Authorization: `Bearer ${key}`, Accept: "*/*" };
}

/** One GET of DPObs. The body comes back as text: the station list is CSV, a reading JSON, GeoJSON or CSV. */
export async function mfGet(env: MfEnv, path: string, params: Record<string, string>, auth: MfAuth): Promise<MfReply> {
  const u = new URL(`${env.base ?? MF_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  try {
    const res = await (env.fetchImpl ?? fetch)(u, { method: "GET", headers: mfHeaders(env.key, auth), redirect: "manual", signal: AbortSignal.timeout(15_000) });
    const text = await res.text();
    const contentType = res.headers.get("content-type") ?? "";
    return res.ok
      ? { ok: true, status: res.status, text, contentType }
      : { ok: false, status: res.status, text: "", contentType, error: scrubText(text, [env.key]).replace(/\s+/g, " ").slice(0, 300) };
  } catch (e) {
    return { ok: false, status: 0, text: "", contentType: "", error: scrubText(e instanceof Error ? e.message : String(e), [env.key]).slice(0, 300) };
  }
}

/** A CSV body as rows of named fields: the separator is whichever of `;` or `,` the header uses more. */
export function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (!lines.length) return [];
  const sep = (lines[0].match(/;/g)?.length ?? 0) >= (lines[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const head = lines[0].split(sep).map((h) => h.trim().replace(/^"|"$/g, ""));
  return lines.slice(1).map((l) => {
    const cells = l.split(sep).map((c) => c.trim().replace(/^"|"$/g, ""));
    return Object.fromEntries(head.map((h, i) => [h, cells[i] ?? ""]));
  });
}

/** A reading body in any of the three formats, as plain records. */
export function parseReadings(text: string): Record<string, unknown>[] {
  const t = text.trim();
  if (t.startsWith("[") || t.startsWith("{")) {
    try {
      const j = JSON.parse(t);
      if (Array.isArray(j)) return j.filter((x) => x && typeof x === "object");
      if (j?.type === "FeatureCollection" && Array.isArray(j.features)) return j.features.map((f: any) => ({ ...(f?.properties ?? {}) }));
      if (j && typeof j === "object") return [j];
    } catch { /* not JSON after all: try CSV */ }
  }
  return parseCsv(t);
}

/** The station rows whose name matches, with the id and the name under whatever the list calls them. */
export function findStations(rows: Record<string, string>[], match: RegExp): { id: string; name: string; lat: string | null; lon: string | null }[] {
  if (!rows.length) return [];
  const keys = Object.keys(rows[0]);
  const idKey = keys.find((k) => /^id[_ ]?station$/i.test(k)) ?? keys.find((k) => /^id$/i.test(k)) ?? keys[0];
  const nameKey = keys.find((k) => /nom|name/i.test(k)) ?? keys[1] ?? keys[0];
  const latKey = keys.find((k) => /^lat/i.test(k)), lonKey = keys.find((k) => /^lon/i.test(k));
  return rows
    .filter((r) => match.test(r[nameKey] ?? ""))
    .map((r) => ({ id: r[idKey], name: r[nameKey], lat: latKey ? r[latKey] : null, lon: lonKey ? r[lonKey] : null }));
}

const ms = (x: unknown): number | null => {
  if (typeof x !== "string" || !x) return null;
  const t = Date.parse(x);
  return Number.isFinite(t) ? t : null;
};

/** One reading as the probe reports it: its times, the delays between them, and the temperature in °C to a tenth. */
export function readingRow(r: Record<string, unknown>, readAt?: number): Record<string, unknown> {
  const v = ms(r.validity_time), ins = ms(r.insert_time), ref = ms(r.reference_time);
  const k = Number(r.t);
  return {
    validity: r.validity_time ?? null, insert: r.insert_time ?? null, reference: r.reference_time ?? null,
    insertLagS: v != null && ins != null ? Math.round((ins - v) / 1000) : null,
    referenceLagS: v != null && ref != null ? Math.round((ref - v) / 1000) : null,
    ageAtReadS: v != null && readAt != null ? Math.round((readAt - v) / 1000) : null,
    tC: r.t == null || r.t === "" || !Number.isFinite(k) ? null : Math.round((k - KELVIN) * 10) / 10,
    station: r.geo_id_insee ?? r.id_station ?? null,
  };
}

/** The 6-minute steps before `now`, newest first, as the API's `date` parameter spells them. */
export function pastSteps(now: number, n: number): string[] {
  const top = Math.floor(now / MF_STEP_MS) * MF_STEP_MS;
  return Array.from({ length: n }, (_, i) => new Date(top - (i + 1) * MF_STEP_MS).toISOString().replace(/\.\d{3}Z$/, "Z"));
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * What the key may read, read-only: which version and header the gateway accepts, the Le Bourget station's id in the
 * station list, its newest 6-minute reading and the last `history` steps by date, with the service's own delay from
 * the reading's time to its insert. Every request is a GET; at most 20 of the 50 a minute.
 */
export async function meteoFranceProbe(env: MfEnv, opts: { now?: () => number; history?: number; secrets?: string[] } = {}): Promise<Record<string, unknown>> {
  const now = opts.now ?? Date.now;
  const secrets = [env.key, ...(opts.secrets ?? [])];
  let calls = 0;
  const get = (path: string, params: Record<string, string>, auth: MfAuth) => { calls++; return mfGet(env, path, params, auth); };
  const out: Record<string, unknown> = { keyForm: mfKeyForm(env.key), transport: "header" };

  // Which version answers, under which header. The station list is the cheapest read both versions share.
  const tried: Record<string, unknown>[] = [];
  let chosen: { version: MfVersion; auth: MfAuth; path: string; rows: Record<string, string>[] } | null = null;
  for (const version of MF_VERSIONS) {
    // Once a header works, the other version is asked under that header only: the header question is settled.
    const auths: readonly MfAuth[] = chosen ? [chosen.auth] : ["apikey", "bearer"];
    for (const auth of auths) {
      let r: MfReply | null = null, path = "";
      for (const p of ["liste-stations", "list-stations"]) {
        path = `/${version}/${p}`;
        r = await get(path, {}, auth);
        if (r.status !== 404) break;
      }
      tried.push({ version, auth, path, status: r!.status, ...(r!.ok ? { contentType: r!.contentType, bytes: r!.text.length } : { error: r!.error }) });
      if (r!.ok) {
        const rows = parseCsv(r!.text);
        if (!chosen) chosen = { version, auth, path, rows };
        break;   // this version works under this header; the other header need not be tried
      }
      if (r!.status !== 401 && r!.status !== 403) break;   // not an auth refusal: the other header will not change it
    }
  }
  out.access = tried;
  if (!chosen) {
    out.calls = calls;
    return out;
  }
  out.version = chosen.version;
  out.auth = chosen.auth;
  out.stationList = { path: chosen.path, rows: chosen.rows.length, fields: Object.keys(chosen.rows[0] ?? {}) };
  const stations = findStations(chosen.rows, MF_STATION_MATCH);
  out.stations = stations;
  const station = stations.find((s) => /^\d{8}$/.test(s.id)) ?? stations[0];
  if (!station) {
    out.calls = calls;
    return out;
  }

  // The newest reading, in the first format the version serves.
  const path6 = `/${chosen.version}/station/infrahoraire-6m`;
  let format: string | null = null, latest: Record<string, unknown> | null = null, fields: string[] = [];
  const formats: Record<string, unknown>[] = [];
  for (const f of ["json", "geojson", "csv"]) {
    const r = await get(path6, { id_station: station.id, format: f }, chosen.auth);
    const readAt = now();
    formats.push({ format: f, status: r.status, ...(r.ok ? { contentType: r.contentType } : { error: r.error }) });
    if (r.ok) {
      const rows = parseReadings(r.text);
      format = f;
      fields = Object.keys(rows[0] ?? {});
      const newest = [...rows].sort((a, b) => (ms(b.validity_time) ?? 0) - (ms(a.validity_time) ?? 0))[0];
      latest = newest ? readingRow(newest, readAt) : null;
      break;
    }
    if (r.status !== 400 && r.status !== 406 && r.status !== 415) break;   // a format refusal is worth another format; nothing else is
  }
  out.latest = { path: path6, station: station.id, formats, format, fields, reading: latest };

  // The last steps by date: the service's own insert delay, step by step.
  if (format) {
    const steps = pastSteps(now(), opts.history ?? MF_PROBE_HISTORY);
    const rows: Record<string, unknown>[] = [];
    for (const date of steps) {
      const r = await get(path6, { id_station: station.id, date, format }, chosen.auth);
      if (!r.ok) { rows.push({ date, status: r.status, error: r.error }); continue; }
      const got = parseReadings(r.text);
      rows.push(got.length ? { date, ...readingRow(got[0]) } : { date, status: r.status, empty: true });
    }
    const lags = rows.map((x) => x.insertLagS).filter((x): x is number => typeof x === "number");
    out.history = { steps: rows.length, rows, insertLagS: { min: lags.length ? Math.min(...lags) : null, median: median(lags), max: lags.length ? Math.max(...lags) : null } };
  }
  out.calls = calls;
  // Nothing above quotes the key; this makes sure of it for whatever an upstream echoed.
  return JSON.parse(scrubText(JSON.stringify(out), secrets));
}
