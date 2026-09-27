// The FAA's SWIM Cloud Distribution Service (SCDS), READ-ONLY: the subscription Davies' SWIFT Portal account holds
// (approved 2026-09-27: ITWS, "Alerts + Standard", every station). SCDS speaks one protocol, Solace's SMF over TLS
// (SCDS User Guide, 2019: "SCDS supports the Solace proprietary SMF protocol"), into a queue of the subscriber's own;
// there is no REST. A subscription left unconsumed for 60 days may be disabled.
//
// The probe's question is WXSRC's first (reference §3.41): does the feed carry anything a temperature market decides
// on? So it binds to the queue, reads a few messages WITHOUT acknowledging them (the broker redelivers them to the next
// consumer: nothing is removed, published or changed), and reports what they are. The credentials live in fourteen
// `FAA_SWIM_*` secrets whose names another tool chose; the probe reports every name, the role it read each as, and
// each value's form, never a value. Every string in the report is scrubbed of every one of them.

export const FAA_PREFIX = /^FAA_SWIM_/i;
/** SCDS's message VPNs are its products (User Guide, App. D); a VPN named one of these is reported by name. */
export const SCDS_PRODUCTS = ["AIM_FNS", "AIMFNS", "FDPS", "ITWS", "STDDS", "TBFM", "TFMS", "CSSWX", "CSS-WX", "NWP", "WMSCR"] as const;
export const SCDS_DEFAULT_PORT = 55443;
/** At most this many messages, and this long bound to the queue: enough to see the product mix, little to download. */
export const FAA_PROBE_MESSAGES = 20;
export const FAA_PROBE_LISTEN_MS = 15_000;
export const FAA_CONNECT_TIMEOUT_MS = 10_000;
/** Of each message, only this many bytes are decoded for its head and element names. */
export const FAA_HEAD_BYTES = 65_536;

export type FaaRole = "url" | "host" | "port" | "vpn" | "queue" | "user" | "password" | "factory";
export type FaaMessage = {
  destination: string | null;
  senderTimestamp: number | null;
  receiverTimestamp: number | null;
  type: string;
  redelivered: boolean;
  properties: Record<string, unknown>;
  payload: Uint8Array | string | null;
};
export type FaaSession = {
  connect(p: { url: string; vpn: string; user: string; password: string; timeoutMs: number }): Promise<{ up: boolean; ms: number; error?: string; code?: unknown; subcode?: unknown }>;
  consume(p: { queue: string; maxMessages: number; listenMs: number }): Promise<{ bound: boolean; ms: number; error?: string; code?: unknown; subcode?: unknown; messages: FaaMessage[] }>;
  close(): Promise<void>;
};
export type FaaDeps = {
  env: Record<string, string>;
  tlsReach: (host: string, port: number) => Promise<{ ok: boolean; ms: number; error?: string }>;
  session: () => Promise<FaaSession>;
  now?: () => number;
  maxMessages?: number;
  listenMs?: number;
};

/** The `FAA_SWIM_*` secrets, name → value, from the whole environment. */
export function faaSecrets(env: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter(([k, v]) => FAA_PREFIX.test(k) && typeof v === "string").sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * Which secret plays which part, by its name. A name about the SWIFT Portal's own login (portal, account, email, web)
 * is never read as the JMS connection's: SCDS issues a separate connection username and password per subscription.
 */
export function faaRoles(names: string[]): Partial<Record<FaaRole, string>> {
  const portal = /PORTAL|SWIFT|ACCOUNT|EMAIL|WEB|LOGIN/i;
  const pick = (...res: RegExp[]) => {
    for (const re of res) {
      const hit = names.find((n) => re.test(n.replace(FAA_PREFIX, "")) && !portal.test(n.replace(FAA_PREFIX, "")));
      if (hit) return hit;
    }
    return undefined;
  };
  const roles: Partial<Record<FaaRole, string>> = {
    url: pick(/(PROVIDER|JMS|BROKER|CONNECTION|SMF)_?URL$/i, /URL$/i, /URI$/i),
    host: pick(/HOST(NAME)?$/i),
    port: pick(/PORT$/i),
    vpn: pick(/VPN(_?NAME)?$/i, /VPN/i),
    queue: pick(/QUEUE(_?NAME)?$/i, /QUEUE/i),
    user: pick(/CONNECTION_?USER(_?NAME)?$/i, /JMS_?USER(_?NAME)?$/i, /USER(_?NAME)?$/i),
    password: pick(/CONNECTION_?PASS(WORD)?$/i, /JMS_?PASS(WORD)?$/i, /PASS(WORD)?$/i),
    factory: pick(/FACTORY/i),
  };
  return Object.fromEntries(Object.entries(roles).filter(([, v]) => v)) as Partial<Record<FaaRole, string>>;
}

/** Where to connect: a URL secret if there is one, else host and port; an SMF URL is `tcps://host:port`. */
export function faaTarget(values: Record<string, string>, roles: Partial<Record<FaaRole, string>>): { url: string; host: string; port: number } | { error: string } {
  const raw = (roles.url && values[roles.url]?.trim()) || (roles.host && values[roles.host]?.trim()) || "";
  if (!raw) return { error: "no URL or host secret" };
  const portSecret = roles.port ? Number(values[roles.port]) : NaN;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `tcps://${raw}`;
  let u: URL;
  try { u = new URL(withScheme.replace(/^(smfs|tcps|ssl|tls):\/\//i, "https://").replace(/^(smf|tcp):\/\//i, "http://")); } catch { return { error: "the URL or host secret does not parse" }; }
  const scheme = withScheme.slice(0, withScheme.indexOf(":")).toLowerCase();
  if (scheme === "tcp" || scheme === "smf" || scheme === "http" || scheme === "ws") return { error: `a plaintext scheme (${scheme}); SCDS takes TLS only` };
  const port = u.port ? Number(u.port) : Number.isFinite(portSecret) && portSecret > 0 ? portSecret : SCDS_DEFAULT_PORT;
  return { url: `tcps://${u.hostname}:${port}`, host: u.hostname, port };
}

/** Each secret's form, never its value: a host's last two labels and port, a VPN's product name, lengths otherwise. */
export function faaForms(values: Record<string, string>, roles: Partial<Record<FaaRole, string>>): Record<string, Record<string, unknown>> {
  const roleOf = Object.fromEntries(Object.entries(roles).map(([r, n]) => [n, r]));
  const vpn = roles.vpn ? values[roles.vpn]?.trim() ?? "" : "";
  const out: Record<string, Record<string, unknown>> = {};
  for (const [name, raw] of Object.entries(values)) {
    const v = raw.trim(), role = roleOf[name] ?? null;
    const f: Record<string, unknown> = { role, length: v.length, empty: v === "" };
    if (role === "url" || role === "host") {
      const m = /^([a-z][a-z0-9+.-]*):\/\/([^/:]+)(?::(\d+))?/i.exec(v) ?? /^()([^/:]+)(?::(\d+))?/.exec(v);
      if (m) {
        const labels = m[2].split(".");
        f.scheme = m[1] ? m[1].toLowerCase() : null;
        f.port = m[3] ? Number(m[3]) : null;
        f.hostSuffix = labels.length >= 2 ? labels.slice(-2).join(".") : null;
        f.labels = labels.length;
      }
    } else if (role === "port") {
      f.port = /^\d+$/.test(v) ? Number(v) : null;
    } else if (role === "vpn") {
      f.product = (SCDS_PRODUCTS as readonly string[]).includes(v.toUpperCase()) ? v.toUpperCase() : null;
    } else if (role === "queue") {
      f.segments = v.split(".").length;
      f.namesVpn = vpn !== "" && v.toUpperCase().includes(vpn.toUpperCase());
      f.product = (SCDS_PRODUCTS as readonly string[]).find((p) => v.toUpperCase().split(/[._-]/).includes(p)) ?? null;
    } else if (role === "user") {
      f.hasAt = v.includes("@");
    }
    out[name] = f;
  }
  return out;
}

/**
 * The values to scrub from a report: every `FAA_SWIM_*` value but the VPN's and the port's, which are SCDS's product
 * name and a port number, published in its user guide, and which the report needs (a VPN called ITWS scrubbed would
 * take every "ITWS" out of the messages' topics with it). A host is scrubbed; its form keeps the domain.
 */
export function faaScrubList(values: Record<string, string>, roles: Partial<Record<FaaRole, string>> = faaRoles(Object.keys(values))): string[] {
  const keep = new Set([roles.vpn, roles.port].filter(Boolean));
  return Object.entries(values).filter(([n, v]) => !keep.has(n) && !/^\d{1,6}$/.test(v.trim())).map(([, v]) => v);
}

/** Every string in `x`, however deep, with each secret replaced. */
export function scrubDeep<T>(x: T, secrets: readonly string[]): T {
  const vals = [...new Set(secrets.map((s) => s.trim()).filter((s) => s.length >= 4))].sort((a, b) => b.length - a.length);
  const scrub = (s: string) => vals.reduce((acc, v) => acc.split(v).join("[redacted]"), s);
  return JSON.parse(JSON.stringify(x, (_k, v) => (typeof v === "string" ? scrub(v) : v))) as T;
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

/** One message as the probe reports it: where it was published, how old it was on arrival, and what it looks like. */
export async function summariseMessage(m: FaaMessage, now: number): Promise<Record<string, unknown>> {
  let bytes: Uint8Array | null = null, text = "", encoding = "none";
  if (typeof m.payload === "string") {
    text = m.payload.slice(0, FAA_HEAD_BYTES);
    encoding = "text";
    bytes = new TextEncoder().encode(m.payload);
  } else if (m.payload instanceof Uint8Array) {
    bytes = m.payload;
    let body: Uint8Array | null = m.payload;
    encoding = "binary";
    if (m.payload[0] === 0x1f && m.payload[1] === 0x8b) {
      encoding = "gzip";
      body = m.payload.length <= 4_000_000 ? await gunzip(m.payload) : null;
    }
    text = body ? new TextDecoder("utf-8", { fatal: false }).decode(body.subarray(0, FAA_HEAD_BYTES)) : "";
  }
  const elements = [...new Set([...text.matchAll(/<([A-Za-z_][\w.-]*:)?([A-Za-z_][\w.-]*)[\s>/]/g)].map((x) => x[2]))];
  const root = elements.find((e) => e !== "xml") ?? null;
  const airports = [...new Set([...text.matchAll(/\b(K[A-Z]{3})\b/g)].map((x) => x[1]))].slice(0, 12);
  const props = Object.fromEntries(Object.entries(m.properties).slice(0, 24).map(([k, v]) => [k, typeof v === "string" ? v.slice(0, 80) : v]));
  return {
    destination: m.destination,
    type: m.type,
    redelivered: m.redelivered,
    sentAt: m.senderTimestamp ? new Date(m.senderTimestamp).toISOString() : null,
    ageAtReceiptS: m.senderTimestamp && m.receiverTimestamp ? Math.round((m.receiverTimestamp - m.senderTimestamp) / 1000) : null,
    ageNowS: m.senderTimestamp ? Math.round((now - m.senderTimestamp) / 1000) : null,
    bytes: bytes?.length ?? 0,
    encoding,
    root,
    elements: elements.slice(0, 20),
    airports,
    mentionsTemperature: /temperature|airTemp|<[\w:]*temp[\w]*[\s>]/i.test(text),
    properties: props,
    head: text.replace(/\s+/g, " ").slice(0, 300),
  };
}

/**
 * What the subscription gives, read-only: the secrets' names and forms, a TLS handshake with the broker, an SMF login,
 * a bind to the queue, and up to `maxMessages` messages summarised and left unacknowledged. Places, publishes and
 * acknowledges nothing.
 */
export async function faaProbe(deps: FaaDeps): Promise<Record<string, unknown>> {
  const now = deps.now ?? Date.now;
  const values = faaSecrets(deps.env);
  const names = Object.keys(values);
  const roles = faaRoles(names);
  const secrets = faaScrubList(values, roles);
  const out: Record<string, unknown> = { names, count: names.length, roles, forms: faaForms(values, roles) };
  const target = faaTarget(values, roles);
  const missing = (["vpn", "queue", "user", "password"] as const).filter((r) => !roles[r] || !values[roles[r]!]?.trim());
  if ("error" in target || missing.length) {
    out.ready = false;
    out.why = "error" in target ? target.error : `no secret read as ${missing.join(", ")}`;
    return scrubDeep(out, secrets);
  }
  out.target = { scheme: "tcps", port: target.port, hostSuffix: target.host.split(".").slice(-2).join(".") };

  out.tls = await deps.tlsReach(target.host, target.port);
  if (!(out.tls as { ok: boolean }).ok) return scrubDeep(out, secrets);

  let session: FaaSession | null = null;
  try {
    session = await deps.session();
    const login = await session.connect({
      url: target.url, vpn: values[roles.vpn!].trim(), user: values[roles.user!].trim(), password: values[roles.password!], timeoutMs: FAA_CONNECT_TIMEOUT_MS,
    });
    out.session = login;
    if (login.up) {
      const got = await session.consume({ queue: values[roles.queue!].trim(), maxMessages: deps.maxMessages ?? FAA_PROBE_MESSAGES, listenMs: deps.listenMs ?? FAA_PROBE_LISTEN_MS });
      const t = now();
      const messages = [];
      for (const m of got.messages) messages.push(await summariseMessage(m, t));
      const byRoot: Record<string, number> = {}, byDestination: Record<string, number> = {};
      for (const m of messages) {
        const r = String(m.root ?? "(none)"), d = String(m.destination ?? "(none)").split("/").slice(0, 3).join("/");
        byRoot[r] = (byRoot[r] ?? 0) + 1;
        byDestination[d] = (byDestination[d] ?? 0) + 1;
      }
      out.queue = {
        bound: got.bound, ms: got.ms, error: got.error ?? null, code: got.code ?? null, subcode: got.subcode ?? null,
        received: messages.length, byRoot, byDestination,
        anyTemperature: messages.some((m) => m.mentionsTemperature),
        messages,
      };
    }
  } catch (e) {
    out.error = e instanceof Error ? e.message : String(e);
  } finally {
    try { await session?.close(); } catch { /* already gone */ }
  }
  return scrubDeep(out, secrets);
}
