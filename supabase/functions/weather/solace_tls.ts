// The Solace client (solclientjs) opens its TLS link the Node way: `new net.Socket().connect(port, host)`, then
// `tls.connect({ socket })` on that socket before it has connected. Deno 1.x's node compat cannot wrap a socket that is
// still connecting: the read loop dereferences an undefined handle and throws an uncaught TypeError, whether or not a
// server answers (measured 2026-09-27 on Deno 1.46.3, against nothing and against a local TLS server). This shim gives
// the client a TLS stream on Deno's own `Deno.connectTls` instead, so the same SMF bytes go over a native connection:
// against a local server the client's login arrived intact and its connect timeout fired cleanly.
//
// Only sockets created while the shim is armed are redirected; every other use of node:net and node:tls is untouched.

import net from "node:net";
import tls from "node:tls";
import { EventEmitter } from "node:events";
import { Buffer } from "node:buffer";

type ConnectTls = (o: { hostname: string; port: number; caCerts?: string[] }) => Promise<{
  handshake?: () => Promise<unknown>;
  read(p: Uint8Array): Promise<number | null>;
  write(p: Uint8Array): Promise<number>;
  close(): void;
}>;

/**
 * A string's bytes as Node writes them. solclientjs builds each SMF frame as a "binary string" (one character per byte)
 * and writes it with `"ascii"`, which Node encodes as latin1: one byte per character, the low eight bits. UTF-8 would
 * split every byte above 0x7F in two, and SCDS answered exactly that with "400 Header Parse Error" (2026-09-27).
 */
export function stringBytes(s: string, enc: string): Uint8Array {
  if (/^(ascii|latin1|binary)$/i.test(enc)) {
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
    return out;
  }
  return new TextEncoder().encode(s);
}

/** The part of a Node TLS socket that solclientjs uses: events, write, end, destroy, setNoDelay, bufferSize. */
export class DenoTlsStream extends EventEmitter {
  bufferSize = 0;
  destroyed = false;
  #conn: Awaited<ReturnType<ConnectTls>> | null = null;
  #writes: Promise<void> = Promise.resolve();
  #closed = false;

  constructor(hostname: string, port: number, connectTls: ConnectTls, caCerts?: string[]) {
    super();
    void this.#run(hostname, port, connectTls, caCerts);
  }

  async #run(hostname: string, port: number, connectTls: ConnectTls, caCerts?: string[]) {
    try {
      const conn = await connectTls({ hostname, port, ...(caCerts ? { caCerts } : {}) });
      if (this.destroyed) { try { conn.close(); } catch { /* already closed */ } return; }
      this.#conn = conn;
      if (conn.handshake) await conn.handshake();
      this.emit("secureConnect");
      const buf = new Uint8Array(65_536);
      for (;;) {
        const n = await conn.read(buf);
        if (n === null) break;
        this.emit("data", Buffer.from(buf.slice(0, n)));
      }
    } catch (e) {
      if (!this.destroyed) this.emit("error", e instanceof Error ? e : new Error(String(e)));
    }
    this.#close();
  }

  #close() {
    if (this.#closed) return;
    this.#closed = true;
    try { this.#conn?.close(); } catch { /* already closed */ }
    queueMicrotask(() => this.emit("close", false));
  }

  write(data: Uint8Array | string, enc?: unknown, cb?: unknown): boolean {
    const bytes = typeof data === "string" ? stringBytes(data, typeof enc === "string" ? enc : "utf8") : new Uint8Array(data);
    const done = typeof enc === "function" ? enc : typeof cb === "function" ? cb : null;
    this.#writes = this.#writes.then(async () => {
      let off = 0;
      while (off < bytes.length && this.#conn && !this.#closed) off += await this.#conn.write(bytes.subarray(off));
      (done as (() => void) | null)?.();
    }).catch((e) => { if (!this.destroyed) this.emit("error", e instanceof Error ? e : new Error(String(e))); });
    return true;
  }

  setNoDelay() { return this; }
  setKeepAlive() { return this; }
  pause() { return this; }
  resume() { return this; }
  end() { void this.#writes.then(() => this.#close()); return this; }
  destroy() { this.destroyed = true; this.#close(); return this; }
}

const TARGET = Symbol("solaceTarget");
let armed = false;
let installed = false;
let current: { connectTls: ConnectTls; caCerts?: string[] } | null = null;

/**
 * Patch node:net and node:tls once: while armed, `new net.Socket().connect(port, host)` only records where it was
 * going, and `tls.connect({ socket })` on such a socket returns a DenoTlsStream to that host and port.
 */
export function installSolaceTls(connectTls: ConnectTls = Deno.connectTls as unknown as ConnectTls, caCerts?: string[]) {
  armed = true;
  current = { connectTls, caCerts };
  if (installed) return;
  installed = true;
  const Socket = (net as unknown as { Socket: { prototype: Record<string | symbol, unknown> } }).Socket;
  const socketConnect = Socket.prototype.connect as (...a: unknown[]) => unknown;
  Socket.prototype.connect = function (this: Record<symbol, unknown>, ...args: unknown[]) {
    if (armed && /^\d+$/.test(String(args[0])) && typeof args[1] === "string") {
      this[TARGET] = { port: Number(args[0]), host: args[1] };
      return this;
    }
    return socketConnect.apply(this, args);
  };
  const t = tls as unknown as { connect: (...a: unknown[]) => unknown };
  const tlsConnect = t.connect;
  t.connect = function (this: unknown, ...args: unknown[]) {
    const target = (args[0] as { socket?: Record<symbol, { host: string; port: number }> } | undefined)?.socket?.[TARGET];
    if (target && current) return new DenoTlsStream(target.host, target.port, current.connectTls, current.caCerts);
    return tlsConnect.apply(this, args);
  };
}

/** Stop redirecting new sockets; streams already open keep running. */
export function disarmSolaceTls() {
  armed = false;
}
