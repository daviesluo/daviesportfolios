// Pins for the TLS shim that lets Solace's npm client run on Deno 1.x: an armed `net.Socket().connect(port, host)`
// records its target instead of connecting, `tls.connect({ socket })` on it opens a Deno TLS stream to that target
// (the port as solclientjs passes it, a string), and the stream behaves as the client expects of a Node socket.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import net from "node:net";
import tls from "node:tls";
import { DenoTlsStream, disarmSolaceTls, installSolaceTls, stringBytes } from "./solace_tls.ts";

/** A TLS connection stand-in: serves `chunks` to reads, records writes, and counts closes. */
function fakeConn(chunks: Uint8Array[]) {
  const writes: Uint8Array[] = [];
  let closed = 0;
  const queue = [...chunks];
  return {
    conn: {
      handshake: async () => {},
      read: async (p: Uint8Array) => {
        await new Promise((r) => setTimeout(r, 1));
        const c = queue.shift();
        if (!c) return null;
        p.set(c);
        return c.length;
      },
      write: async (p: Uint8Array) => { writes.push(p.slice()); return p.length; },
      close: () => { closed++; },
    },
    writes,
    closed: () => closed,
  };
}

const events = (s: DenoTlsStream) => {
  const seen: string[] = [];
  const data: string[] = [];
  s.on("secureConnect", () => seen.push("secureConnect"));
  s.on("data", (b: Uint8Array) => { seen.push("data"); data.push(new TextDecoder().decode(b)); });
  s.on("error", (e: Error) => seen.push(`error:${e.message}`));
  const closed = new Promise<void>((r) => s.on("close", () => { seen.push("close"); r(); }));
  return { seen, data, closed };
};

Deno.test("DenoTlsStream: connects, says so, hands on every chunk, and closes once at end of stream", async () => {
  const f = fakeConn([new TextEncoder().encode("login-ok"), new TextEncoder().encode("msg-1")]);
  let asked: unknown = null;
  const s = new DenoTlsStream("ems.example.gov", 55443, async (o) => { asked = o; return f.conn; });
  const e = events(s);
  assert(s.write(new TextEncoder().encode("SMF-LOGIN")) === true, "write never asks the client to wait");
  await e.closed;
  assertEquals(asked, { hostname: "ems.example.gov", port: 55443 });
  assertEquals(e.seen, ["secureConnect", "data", "data", "close"]);
  assertEquals(e.data, ["login-ok", "msg-1"]);
  assertEquals(new TextDecoder().decode(f.writes[0]), "SMF-LOGIN");
  assertEquals(f.closed(), 1);
});

Deno.test("DenoTlsStream: a refused connection is an error then a close, as a Node socket reports it", async () => {
  const s = new DenoTlsStream("ems.example.gov", 55443, async () => { throw new Error("connection refused"); });
  const e = events(s);
  await e.closed;
  assertEquals(e.seen, ["error:connection refused", "close"]);
});

Deno.test("DenoTlsStream: destroyed before the connection opens, it closes the connection and reports nothing", async () => {
  const f = fakeConn([new TextEncoder().encode("late")]);
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => { release = r; });
  const s = new DenoTlsStream("ems.example.gov", 55443, async () => { await gate; return f.conn; });
  const e = events(s);
  s.destroy();
  release();
  await e.closed;
  await new Promise((r) => setTimeout(r, 10));
  assertEquals(e.seen, ["close"]);
  assertEquals(f.closed(), 1);
});

Deno.test("installSolaceTls: an armed socket records its target (a string port) and tls.connect opens the Deno stream", async () => {
  const f = fakeConn([]);
  let asked: unknown = null;
  installSolaceTls(async (o) => { asked = o; return f.conn; });
  // deno-lint-ignore no-explicit-any
  const raw: any = new (net as any).Socket();
  assert(raw.connect("55443", "ems.example.gov") === raw, "an armed connect returns the socket without connecting");
  // deno-lint-ignore no-explicit-any
  const stream = (tls as any).connect({ socket: raw, servername: "ems.example.gov" });
  assert(stream instanceof DenoTlsStream);
  const e = events(stream);
  await e.closed;
  assertEquals(asked, { hostname: "ems.example.gov", port: 55443 });
  disarmSolaceTls();
});

Deno.test("DenoTlsStream: a frame written as an \"ascii\" binary string goes out one byte a character, as Node sends it", async () => {
  // solclientjs writes every SMF frame with write(frame, "ascii"). Encoded as UTF-8, each byte above 0x7F became two,
  // and SCDS refused the login with "400 Header Parse Error" (2026-09-27).
  const f = fakeConn([]);
  const s = new DenoTlsStream("ems.example.gov", 55443, async () => f.conn);
  const e = events(s);
  const frame = String.fromCharCode(0x03, 0x8c, 0x00, 0xff, 0xe9, 0x41);
  s.write(frame, "ascii");
  await e.closed;
  assertEquals([...f.writes[0]], [0x03, 0x8c, 0x00, 0xff, 0xe9, 0x41]);
  assertEquals([...stringBytes("\u00e9", "latin1")], [0xe9]);
  assertEquals([...stringBytes("\u00e9", "utf8")], [0xc3, 0xa9]);
});
