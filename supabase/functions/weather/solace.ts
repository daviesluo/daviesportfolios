// The real SCDS session for `faa_swim.ts`: Solace's own JavaScript client (solclientjs, its production build) over the
// Deno TLS shim in `solace_tls.ts`. Kept apart from the probe's logic so the tests never load the client, and apart
// from the `agents` function so a Solace session never shares an isolate with the live loop.
//
// Read-only by construction: the session creates no publisher and sends no message; the consumer binds to the
// subscriber's own queue in CLIENT acknowledge mode and never acknowledges, so every message it reads stays queued.

import solaceLib from "npm:solclientjs@10.18.3/lib/solclientjs.js";
import { disarmSolaceTls, installSolaceTls } from "./solace_tls.ts";
import type { FaaMessage, FaaSession } from "./faa_swim.ts";

// deno-lint-ignore no-explicit-any
const solace: any = (solaceLib as any)?.default ?? solaceLib;
let factoryReady = false;

function initFactory() {
  if (factoryReady) return;
  const fp = new solace.SolclientFactoryProperties();
  fp.profile = solace.SolclientFactoryProfiles.version10;
  solace.SolclientFactory.init(fp);
  solace.SolclientFactory.setLogLevel(solace.LogLevel.ERROR);
  factoryReady = true;
}

// deno-lint-ignore no-explicit-any
const describe = (e: any) => ({
  error: String(e?.infoStr ?? e?.message ?? e ?? "unknown").slice(0, 300),
  code: e?.responseCode ?? e?.errorCode ?? null,
  subcode: e?.errorSubcode ?? e?.subcode ?? null,
});

// deno-lint-ignore no-explicit-any
function toMessage(m: any): FaaMessage {
  const props: Record<string, unknown> = {};
  try {
    const map = m.getUserPropertyMap?.();
    for (const k of map?.getKeys?.() ?? []) props[k] = map.getField(k)?.getValue?.() ?? null;
  } catch { /* no properties */ }
  let payload: Uint8Array | string | null = null, type = "unknown";
  try {
    const t = m.getType?.();
    type = solace.MessageType?.nameOf?.(t) ?? String(t);
    if (t === solace.MessageType.TEXT) payload = String(m.getSdtContainer?.()?.getValue?.() ?? "");
    else {
      const xml = m.getXmlContent?.();
      const bin = m.getBinaryAttachment?.();
      if (xml) payload = typeof xml === "string" ? xml : new Uint8Array(xml);
      else if (typeof bin === "string") payload = Uint8Array.from(bin, (c: string) => c.charCodeAt(0) & 0xff);
      else if (bin) payload = new Uint8Array(bin);
    }
  } catch { /* unreadable body: reported as empty */ }
  return {
    destination: m.getDestination?.()?.getName?.() ?? null,
    senderTimestamp: m.getSenderTimestamp?.() ?? null,
    receiverTimestamp: m.getReceiverTimestamp?.() ?? null,
    type,
    redelivered: Boolean(m.isRedelivered?.()),
    receivedAt: Date.now(),
    properties: props,
    payload,
  };
}

/** A fresh SCDS session. `connect` logs in; `consume` binds to the queue and collects without acknowledging. */
export async function openSolace(): Promise<FaaSession> {
  initFactory();
  installSolaceTls();
  // deno-lint-ignore no-explicit-any
  let session: any = null, consumer: any = null;
  return {
    async connect({ url, vpn, user, password, timeoutMs }) {
      const t0 = Date.now();
      session = solace.SolclientFactory.createSession({
        url, vpnName: vpn, userName: user, password,
        connectRetries: 0, reconnectRetries: 0, connectTimeoutInMsecs: timeoutMs,
        generateReceiveTimestamps: true, generateSendTimestamps: false,
      });
      const result = await new Promise<{ up: boolean; error?: string; code?: unknown; subcode?: unknown }>((resolve) => {
        const timer = setTimeout(() => resolve({ up: false, error: `no answer in ${timeoutMs + 2000} ms` }), timeoutMs + 2000);
        session.on(solace.SessionEventCode.UP_NOTICE, () => { clearTimeout(timer); resolve({ up: true }); });
        // deno-lint-ignore no-explicit-any
        session.on(solace.SessionEventCode.CONNECT_FAILED_ERROR, (e: any) => { clearTimeout(timer); resolve({ up: false, ...describe(e) }); });
        // deno-lint-ignore no-explicit-any
        session.on(solace.SessionEventCode.DISCONNECTED, (e: any) => { clearTimeout(timer); resolve({ up: false, ...describe(e ?? "disconnected") }); });
        try { session.connect(); } catch (e) { clearTimeout(timer); resolve({ up: false, ...describe(e) }); }
      });
      return { ...result, ms: Date.now() - t0 };
    },

    async consume({ queue, maxMessages, listenMs }) {
      const t0 = Date.now();
      const messages: FaaMessage[] = [];
      consumer = session.createMessageConsumer({
        queueDescriptor: { name: queue, type: solace.QueueType.QUEUE },
        acknowledgeMode: solace.MessageConsumerAcknowledgeMode.CLIENT,
        windowSize: Math.max(1, Math.min(255, maxMessages)),
        createIfMissing: false,
      });
      const bound = await new Promise<{ bound: boolean; error?: string; code?: unknown; subcode?: unknown }>((resolve) => {
        const timer = setTimeout(() => resolve({ bound: false, error: "no bind answer in 10 s" }), 10_000);
        consumer.on(solace.MessageConsumerEventName.UP, () => { clearTimeout(timer); resolve({ bound: true }); });
        // deno-lint-ignore no-explicit-any
        consumer.on(solace.MessageConsumerEventName.CONNECT_FAILED_ERROR, (e: any) => { clearTimeout(timer); resolve({ bound: false, ...describe(e) }); });
        // deno-lint-ignore no-explicit-any
        consumer.on(solace.MessageConsumerEventName.DOWN_ERROR, (e: any) => { clearTimeout(timer); resolve({ bound: false, ...describe(e) }); });
        // deno-lint-ignore no-explicit-any
        consumer.on(solace.MessageConsumerEventName.MESSAGE, (m: any) => { if (messages.length < maxMessages) messages.push(toMessage(m)); });
        try { consumer.connect(); } catch (e) { clearTimeout(timer); resolve({ bound: false, ...describe(e) }); }
      });
      if (bound.bound) {
        const deadline = t0 + listenMs;
        while (messages.length < maxMessages && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
      }
      return { ...bound, ms: Date.now() - t0, messages };
    },

    async close() {
      try { consumer?.disconnect?.(); } catch { /* already down */ }
      if (session) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 3000);
          try {
            session.on(solace.SessionEventCode.DISCONNECTED, () => { clearTimeout(timer); resolve(); });
            session.disconnect();
          } catch { clearTimeout(timer); resolve(); }
        });
        try { session.dispose(); } catch { /* already disposed */ }
      }
      disarmSolaceTls();
    },
  };
}

/** A TLS handshake with the broker and nothing else: whether SCDS is reachable from where the function runs. */
export async function tlsReach(host: string, port: number): Promise<{ ok: boolean; ms: number; error?: string }> {
  const t0 = Date.now();
  try {
    const conn = await Deno.connectTls({ hostname: host, port });
    await conn.handshake();
    conn.close();
    return { ok: true, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, error: (e instanceof Error ? e.message : String(e)).slice(0, 300) };
  }
}
