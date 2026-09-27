// Pins for the FAA SWIM SCDS probe: which secret is read as which part (the portal's own login is never the JMS
// connection's), where it connects (TLS only), that no value reaches the report even from a broker that echoes them,
// that it reads messages without acknowledging them, and that a message is described by what it carries.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  FAA_PROBE_MESSAGES, faaForms, faaProbe, faaRoles, faaScrubList, faaSecrets, faaTarget, scrubDeep, summariseMessage,
  type FaaMessage, type FaaSession,
} from "./faa_swim.ts";

/** Fourteen secrets in the shape another tool stored them: every value planted, none a word the report could contain. */
const ENV: Record<string, string> = {
  FAA_SWIM_HOST: "ems-planted-7.swim.faa.gov",
  FAA_SWIM_PORT: "55443",
  FAA_SWIM_VPN: "ITWS",
  FAA_SWIM_QUEUE: "planted.user.gmail.com.ITWS.0a1b2c3d-planted-queue.OUT",
  FAA_SWIM_CONNECTION_USERNAME: "planted.user.gmail.com",
  FAA_SWIM_CONNECTION_PASSWORD: "Pl4nted-Conn-Passw0rd!",
  FAA_SWIM_CONNECTION_FACTORY: "planted.cf.ITWS",
  FAA_SWIM_PORTAL_USERNAME: "planted-portal-login",
  FAA_SWIM_PORTAL_PASSWORD: "Pl4nted-Portal-Passw0rd?",
  FAA_SWIM_SUBSCRIPTION_ID: "sub-planted-000417",
  FAA_SWIM_SUBSCRIPTION_NAME: "planted-subscription-name",
  FAA_SWIM_PRODUCT: "ITWS Alerts + Standard",
  FAA_SWIM_FILTER: "all-planted-stations",
  FAA_SWIM_PROTOCOL: "tcps",
  UNRELATED_SECRET: "must-not-be-read",
};
const SECRET_VALUES = Object.entries(ENV).filter(([k]) => k.startsWith("FAA_SWIM_") && !["FAA_SWIM_VPN", "FAA_SWIM_PORT", "FAA_SWIM_PROTOCOL"].includes(k)).map(([, v]) => v);

const itws = (i: number): FaaMessage => ({
  destination: `ITWS/CONFIGURED_ALERTS/KORD/${i}`,
  senderTimestamp: Date.parse("2026-09-27T05:00:00Z") + i * 1000,
  receiverTimestamp: Date.parse("2026-09-27T05:00:02Z") + i * 1000,
  type: "TEXT",
  redelivered: false,
  properties: { productType: "CA", airport: "KORD" },
  payload: `<?xml version="1.0"?><ns2:ITWSConfiguredAlerts xmlns:ns2="urn:itws"><airport>KORD</airport><windShear>none</windShear></ns2:ITWSConfiguredAlerts>`,
});

/** A broker stand-in: it records what it was asked, answers with `messages`, and puts every credential in its errors. */
function broker(opts: { up?: boolean; bound?: boolean; messages?: FaaMessage[] } = {}) {
  const calls: string[] = [];
  let seen: { url?: string; vpn?: string; user?: string; password?: string; queue?: string } = {};
  const session = async (): Promise<FaaSession> => ({
    async connect(p) {
      calls.push("connect");
      seen = { ...seen, url: p.url, vpn: p.vpn, user: p.user, password: p.password };
      return opts.up === false
        ? { up: false, ms: 12, error: `401 Unauthorized: ${p.user} / ${p.password} @ ${p.url}`, code: 401 }
        : { up: true, ms: 12 };
    },
    async consume(p) {
      calls.push("consume");
      seen.queue = p.queue;
      return opts.bound === false
        ? { bound: false, ms: 5, error: `Unknown Queue ${p.queue}`, code: 503, messages: [] }
        : { bound: true, ms: 5, messages: (opts.messages ?? []).slice(0, p.maxMessages) };
    },
    async close() { calls.push("close"); },
  });
  return { session, calls, seen: () => seen };
}

const reach = async () => ({ ok: true, ms: 30 });

Deno.test("faaRoles: the connection's username and password, never the portal's login", () => {
  const r = faaRoles(Object.keys(faaSecrets(ENV)));
  assertEquals(r, {
    host: "FAA_SWIM_HOST", port: "FAA_SWIM_PORT", vpn: "FAA_SWIM_VPN", queue: "FAA_SWIM_QUEUE",
    user: "FAA_SWIM_CONNECTION_USERNAME", password: "FAA_SWIM_CONNECTION_PASSWORD", factory: "FAA_SWIM_CONNECTION_FACTORY",
  });
  // with only portal credentials stored, there is no connection login to read
  assertEquals(faaRoles(["FAA_SWIM_PORTAL_USERNAME", "FAA_SWIM_PORTAL_PASSWORD"]), {});
  // a URL secret wins over a host
  assertEquals(faaRoles(["FAA_SWIM_PROVIDER_URL", "FAA_SWIM_HOST"]).url, "FAA_SWIM_PROVIDER_URL");
});

Deno.test("faaTarget: host and port, or a URL; TLS only", () => {
  assertEquals(faaTarget({ H: "ems.example.gov", P: "55443" }, { host: "H", port: "P" }), { url: "tcps://ems.example.gov:55443", host: "ems.example.gov", port: 55443 });
  assertEquals(faaTarget({ U: "tcps://ems.example.gov:55443" }, { url: "U" }), { url: "tcps://ems.example.gov:55443", host: "ems.example.gov", port: 55443 });
  assertEquals(faaTarget({ U: "smfs://ems.example.gov" }, { url: "U" }), { url: "tcps://ems.example.gov:55443", host: "ems.example.gov", port: 55443 });
  assertEquals(faaTarget({ H: "ems.example.gov:1443" }, { host: "H" }), { url: "tcps://ems.example.gov:1443", host: "ems.example.gov", port: 1443 });
  assert("error" in faaTarget({ U: "tcp://ems.example.gov:55555" }, { url: "U" }), "plaintext SMF would send the password in the clear");
  assert("error" in faaTarget({}, {}));
});

Deno.test("faaForms: forms and lengths, and not one value", () => {
  const values = faaSecrets(ENV);
  const forms = faaForms(values, faaRoles(Object.keys(values)));
  assertEquals(Object.keys(forms).length, 14);
  assertEquals(forms.FAA_SWIM_HOST, { role: "host", length: ENV.FAA_SWIM_HOST.length, empty: false, scheme: null, port: null, hostSuffix: "faa.gov", labels: 4 });
  assertEquals(forms.FAA_SWIM_VPN.product, "ITWS");
  assertEquals(forms.FAA_SWIM_QUEUE.namesVpn, true);
  assertEquals(forms.FAA_SWIM_CONNECTION_USERNAME.hasAt, false);
  const text = JSON.stringify(forms);
  for (const v of SECRET_VALUES) assert(!text.includes(v), `${v} in the forms`);
  assert(!("UNRELATED_SECRET" in forms));
});

Deno.test("faaProbe: logs in with the connection's credentials, binds its queue, reads without acknowledging, and says what came", async () => {
  const b = broker({ messages: Array.from({ length: 30 }, (_, i) => itws(i)) });
  const out = await faaProbe({ env: ENV, tlsReach: reach, session: b.session, now: () => Date.parse("2026-09-27T05:01:00Z") });
  assertEquals(b.seen(), { url: `tcps://${ENV.FAA_SWIM_HOST}:55443`, vpn: "ITWS", user: ENV.FAA_SWIM_CONNECTION_USERNAME, password: ENV.FAA_SWIM_CONNECTION_PASSWORD, queue: ENV.FAA_SWIM_QUEUE });
  // the session offers no acknowledge and no publish: connect, consume and close are all it was asked
  assertEquals(b.calls, ["connect", "consume", "close"]);
  const q = out.queue as { received: number; byRoot: Record<string, number>; anyTemperature: boolean; messages: Record<string, unknown>[] };
  assertEquals(q.received, FAA_PROBE_MESSAGES);
  assertEquals(q.byRoot, { ITWSConfiguredAlerts: FAA_PROBE_MESSAGES });
  assertEquals(q.anyTemperature, false);
  assertEquals(q.messages[0].ageAtReceiptS, 2);
  assertEquals(q.messages[0].airports, ["KORD"]);
  assertEquals(out.target, { scheme: "tcps", port: 55443, hostSuffix: "faa.gov" });
  const text = JSON.stringify(out);
  for (const v of SECRET_VALUES) assert(!text.includes(v), `${v} in the report`);
  assert(text.includes("ITWS"), "the product name is the finding and must survive the scrub");
});

Deno.test("faaProbe: a broker that echoes the credentials in its refusals gets none of them into the report", async () => {
  for (const b of [broker({ up: false }), broker({ bound: false })]) {
    const out = await faaProbe({ env: ENV, tlsReach: reach, session: b.session });
    const text = JSON.stringify(out);
    for (const v of SECRET_VALUES) assert(!text.includes(v), `${v} in the report`);
    assertEquals(b.calls.at(-1), "close");
  }
});

Deno.test("faaProbe: no TLS, no login; missing credentials, no connection at all", async () => {
  const b = broker();
  const out = await faaProbe({ env: ENV, tlsReach: async () => ({ ok: false, ms: 10_000, error: "connection timed out" }), session: b.session });
  assertEquals(b.calls, []);
  assertEquals((out.tls as { ok: boolean }).ok, false);
  const partial = await faaProbe({ env: { FAA_SWIM_HOST: "ems.example.gov", FAA_SWIM_VPN: "ITWS" }, tlsReach: reach, session: b.session });
  assertEquals(partial.ready, false);
  assertEquals(b.calls, []);
});

Deno.test("summariseMessage: a gzipped XML body is opened, its root and a temperature element found", async () => {
  const xml = `<?xml version="1.0"?><iwxxm:METAR xmlns:iwxxm="http://icao.int/iwxxm/3.0"><iwxxm:airTemperature uom="Cel">14.4</iwxxm:airTemperature><station>KLGA</station></iwxxm:METAR>`;
  const gz = new Uint8Array(await new Response(new Blob([new TextEncoder().encode(xml)]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
  const s = await summariseMessage({ destination: "CSSWX/METAR", senderTimestamp: null, receiverTimestamp: null, type: "BINARY", redelivered: true, properties: {}, payload: gz }, 0);
  assertEquals(s.encoding, "gzip");
  assertEquals(s.root, "METAR");
  assertEquals(s.mentionsTemperature, true);
  assertEquals(s.airports, ["KLGA"]);
  assertEquals(s.ageAtReceiptS, null);
});

Deno.test("scrubDeep, faaScrubList: longest first, the VPN and port kept, short values left alone", () => {
  assertEquals(scrubDeep({ a: "user.name and user", b: [1, "user.name"] }, ["user", "user.name"]), { a: "[redacted] and [redacted]", b: [1, "[redacted]"] });
  assertEquals(scrubDeep("ab cd", ["ab"]), "ab cd");
  const list = faaScrubList(faaSecrets(ENV));
  assert(!list.includes("ITWS") && !list.includes("55443") && !list.includes("tcps"));
  assertEquals(list.length, 11);
});

Deno.test("faaRoles, faaForms: the fourteen names the other tool stored on 2026-09-27, read as the probe read them", () => {
  // The names as `?action=probe&only=faa` listed them at 04:51 UTC; the values here are planted.
  const stored: Record<string, string> = {
    FAA_SWIM_CONNECTION_FACTORY: "planted.factory.name1", FAA_SWIM_CONNECTION_PASSWORD: "planted-password-000001",
    FAA_SWIM_CONNECTION_USERNAME: "planted.conn.user01", FAA_SWIM_EMAIL: "planted@example.org",
    FAA_SWIM_FILTERS: "planted1", FAA_SWIM_HOST: "ems9.swim.faa.gov", FAA_SWIM_JMS_CONNECTION_URL: "tcps://ems9.swim.faa.gov:55443",
    FAA_SWIM_MESSAGE_VPN: "ITWS", FAA_SWIM_PORT: "55443", FAA_SWIM_PRODUCT: "ITWS", FAA_SWIM_PROTOCOL: "tcps",
    FAA_SWIM_QUEUE_NAME: "planted.conn.user01.ITWS.00000000-0000-4000-8000-000000000000.OUT", FAA_SWIM_SERVICES: "plant1",
    FAA_SWIM_SUBSCRIPTION_ID: "00000000-0000-4000-8000-000000000001",
  };
  const roles = faaRoles(Object.keys(stored));
  assertEquals(roles, {
    url: "FAA_SWIM_JMS_CONNECTION_URL", host: "FAA_SWIM_HOST", port: "FAA_SWIM_PORT", vpn: "FAA_SWIM_MESSAGE_VPN",
    queue: "FAA_SWIM_QUEUE_NAME", user: "FAA_SWIM_CONNECTION_USERNAME", password: "FAA_SWIM_CONNECTION_PASSWORD",
    factory: "FAA_SWIM_CONNECTION_FACTORY",
  });
  const forms = scrubDeep(faaForms(stored, roles), faaScrubList(stored, roles));
  // the scheme, the product and the VPN survive the scrub (the 04:51 report had them all "[redacted]")
  assertEquals(forms.FAA_SWIM_JMS_CONNECTION_URL.scheme, "tcps");
  assertEquals(forms.FAA_SWIM_MESSAGE_VPN.product, "ITWS");
  assertEquals(forms.FAA_SWIM_QUEUE_NAME.product, "ITWS");
  assertEquals(forms.FAA_SWIM_PRODUCT.value, "ITWS");
  assertEquals(forms.FAA_SWIM_PROTOCOL.value, "tcps");
  const text = JSON.stringify(forms);
  for (const k of ["FAA_SWIM_CONNECTION_PASSWORD", "FAA_SWIM_CONNECTION_USERNAME", "FAA_SWIM_EMAIL", "FAA_SWIM_QUEUE_NAME", "FAA_SWIM_SUBSCRIPTION_ID", "FAA_SWIM_HOST", "FAA_SWIM_FILTERS", "FAA_SWIM_SERVICES", "FAA_SWIM_CONNECTION_FACTORY"]) {
    assert(!text.includes(stored[k]), `${k} in the forms`);
  }
});
