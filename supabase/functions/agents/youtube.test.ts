// Pins for the read-only YouTube client and the probe's `youtube` part: the key rides in a header and never in a URL,
// the report carries no part of it (not even from a server that echoes it back), and the probe reads the fields a
// recorder would.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { MRBEAST_CHANNEL, YT_PROBE_SAMPLES, YT_READS, ytGet, ytKeyForm, ytScrub } from "./youtube.ts";
import { PROBE_PARTS, probeParts, runProbe } from "./index.ts";

/** A planted key in Google's shape: `AIza` + 35 characters, none of them English the report could contain by chance. */
const YT_KEY = "AIzaSyPLANTED-yt-key_0123456789ABCDEFGH";
const GAMING = "UCgamingPLANTEDchannel000";

/** Does any 10-character stretch of the key appear in `text`? A cut key leaks its prefix, not its whole. */
function leaksPart(text: string, key = YT_KEY, window = 10): string | null {
  for (let i = 0; i + window <= key.length; i++) if (text.includes(key.slice(i, i + window))) return key.slice(i, i + window);
  return null;
}

type Call = { method: string; url: URL; headers: Headers; redirect?: string; body: unknown };

/**
 * A fake of the Data API as strict as Google about the key: a request without it in `X-Goog-Api-Key` is a 403. The
 * newest upload's counter rises by 1,234 on every read. `hostile` answers every request with a 400 whose message and
 * reason echo the key and every header.
 */
function youtubeHost(hostile = false) {
  const calls: Call[] = [];
  let reads = 0;
  const fetchImpl = (async (input: Request | URL | string, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const headers = new Headers(init?.headers);
    calls.push({ method: (init?.method ?? "GET").toUpperCase(), url, headers, redirect: init?.redirect, body: init?.body });
    if (hostile) {
      const echo = [...headers].map(([k, v]) => `${k}=${v}`).join(" ");
      const error = { code: 400, message: `${"y".repeat(290)}${YT_KEY} ${echo}`, errors: [{ reason: `keyInvalid ${YT_KEY}` }], status: "INVALID_ARGUMENT" };
      return new Response(JSON.stringify({ error }), { status: 400 });
    }
    if (headers.get("X-Goog-Api-Key") !== YT_KEY) {
      return new Response(JSON.stringify({ error: { code: 403, message: "The request is missing a valid API key.", errors: [{ reason: "forbidden" }], status: "PERMISSION_DENIED" } }), { status: 403 });
    }
    const q = url.searchParams;
    const path = url.pathname.replace("/youtube/v3/", "");
    const body = path === "channels" && q.get("forHandle") === "@MrBeast"
      ? { items: [{ id: MRBEAST_CHANNEL, snippet: { title: "MrBeast" }, statistics: { subscriberCount: "400000000", viewCount: "90000000000", videoCount: "900", hiddenSubscriberCount: false }, contentDetails: { relatedPlaylists: { uploads: "UUX6OQ3DkcsbYNE6H8uQQuVA" } } }] }
      : path === "channels" && q.get("forHandle") === "@MrBeastGaming"
      ? { items: [{ id: GAMING, snippet: { title: "MrBeast Gaming" }, statistics: { subscriberCount: "50000000", viewCount: "9000000000", videoCount: "300", hiddenSubscriberCount: false }, contentDetails: { relatedPlaylists: { uploads: "UUgamingPLANTEDchannel000" } } }] }
      : path === "playlistItems" && q.get("playlistId") === "UUX6OQ3DkcsbYNE6H8uQQuVA"
      ? { items: [{ contentDetails: { videoId: "beastNEW001", videoPublishedAt: "2026-09-19T16:00:00Z" } }, { contentDetails: { videoId: "beastOLD002", videoPublishedAt: "2026-09-12T16:00:00Z" } }] }
      : path === "playlistItems" && q.get("playlistId") === "UUgamingPLANTEDchannel000"
      ? { items: [{ contentDetails: { videoId: "gamingNEW01", videoPublishedAt: "2026-09-22T20:00:00Z" } }] }
      : path === "videos" && q.get("part") === "statistics"
      ? { items: [{ id: q.get("id"), etag: `e${reads}`, statistics: { viewCount: String(5_000_000 + 1_234 * reads++), likeCount: "1", commentCount: "2" } }] }
      : path === "videos"
      ? { items: (q.get("id") ?? "").split(",").map((id, i) => ({ id, snippet: { channelTitle: "MrBeast", title: `T${i}`, publishedAt: "2026-09-19T16:00:00Z", liveBroadcastContent: "none" }, statistics: { viewCount: String(1e6 * (i + 1)), likeCount: "10", commentCount: "20" }, contentDetails: { duration: "PT20M" } })) }
      : null;
    return body === null ? new Response(JSON.stringify({ error: { code: 404, message: "not found" } }), { status: 404 }) : new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

async function withKey<T>(key: string | null, run: () => Promise<T>): Promise<T> {
  const names = ["YOUTUBE_API_KEY", "YouTube_API_KEY", "Youtube_API_KEY", "youtube_api_key"];
  const saved = new Map(names.map((n) => [n, Deno.env.get(n)]));
  for (const n of names) Deno.env.delete(n);
  if (key) Deno.env.set("YOUTUBE_API_KEY", key);
  try {
    return await run();
  } finally {
    for (const [n, v] of saved) v === undefined ? Deno.env.delete(n) : Deno.env.set(n, v);
  }
}

const noSleep = async () => {};

Deno.test("ytKeyForm names the key's shape and never a character of it", () => {
  assertEquals(ytKeyForm(YT_KEY), "google-api-key");
  assertEquals(ytKeyForm("abc"), "unexpected form (3 chars)");
  assertEquals(ytKeyForm(YT_KEY + "x"), "unexpected form (40 chars)");
});

Deno.test("ytScrub takes out every copy of the key, and does nothing without one", () => {
  assertEquals(ytScrub(`a ${YT_KEY} b ${YT_KEY}`, YT_KEY), "a [redacted] b [redacted]");
  assertEquals(ytScrub("plain", ""), "plain");
});

Deno.test("ytGet refuses any method that is not a listed read, without a request", async () => {
  const host = youtubeHost();
  // deno-lint-ignore no-explicit-any
  const r = await ytGet({ key: YT_KEY, fetchImpl: host.fetchImpl }, "search" as any, { q: "x" });
  assertEquals([r.ok, r.status, r.error], [false, 0, "not a read: search"]);
  assertEquals(host.calls.length, 0);
});

Deno.test("probeParts: `only=youtube` runs the YouTube part and nothing else", () => {
  assert((PROBE_PARTS as readonly string[]).includes("youtube"));
  assertEquals([...probeParts("youtube")!], ["youtube"]);
});

Deno.test("runProbe(youtube) — GETs to the three listed reads, the key in a header only, and the fields a recorder reads", async () => {
  const host = youtubeHost();
  const out = await withKey(YT_KEY, () => runProbe(new Set(["youtube"]), host.fetchImpl, { sleep: noSleep }));
  assertEquals(out.polymarket, undefined);
  const yt = out.youtube as Record<string, any>;

  for (const c of host.calls) {
    assertEquals([c.method, c.redirect, c.body ?? null], ["GET", "manual", null], c.url.href);
    assertEquals(c.url.origin, "https://www.googleapis.com");
    assert((YT_READS as readonly string[]).map((m) => `/youtube/v3/${m}`).includes(c.url.pathname), c.url.pathname);
    assertEquals(c.url.searchParams.get("key"), null);
    assertEquals(leaksPart(c.url.href), null, `the key in ${c.url.href}`);
    assertEquals(c.headers.get("X-Goog-Api-Key"), YT_KEY);
  }
  assertEquals(yt.keyForm, "google-api-key");
  assertEquals(yt.channels.map((c: any) => [c.handle, c.id, c.uploads]), [["@MrBeast", MRBEAST_CHANNEL, "UUX6OQ3DkcsbYNE6H8uQQuVA"], ["@MrBeastGaming", GAMING, "UUgamingPLANTEDchannel000"]]);
  assertEquals(yt.channels[0].matchesKnownId, true);
  assertEquals(yt.channels[0].subscriberCount, 400_000_000);
  assertEquals(yt.channels[0].newest[0], { videoId: "beastNEW001", publishedAt: "2026-09-19T16:00:00Z" });
  assertEquals(yt.videos.count, 3);
  assertEquals(yt.videos.statisticsFields, ["viewCount", "likeCount", "commentCount"]);
  // The newest upload across both channels is the one read again and again; its counter moved on every read here.
  assertEquals([yt.cadence.videoId, yt.cadence.reads.length, yt.cadence.changes], ["gamingNEW01", YT_PROBE_SAMPLES, YT_PROBE_SAMPLES - 1]);
  assertEquals(yt.cadence.reads[1].viewCount - yt.cadence.reads[0].viewCount, 1_234);
  // 2 channel lookups + 2 upload lists + 1 video batch + the counter reads, 1 unit each.
  assertEquals(yt.units, 5 + YT_PROBE_SAMPLES);
  assertEquals(host.calls.length, yt.units);
  assertEquals(leaksPart(JSON.stringify(out)), null, "the key reached the report");
});

Deno.test("runProbe(youtube) — a server that echoes the key gets none of it into the report, and one refusal stops the part", async () => {
  const host = youtubeHost(true);
  const out = await withKey(YT_KEY, () => runProbe(new Set(["youtube"]), host.fetchImpl, { sleep: noSleep }));
  const yt = out.youtube as Record<string, any>;
  assertEquals(yt.channels.length, 1);
  assertEquals([yt.channels[0].status, yt.units, host.calls.length], [400, 1, 1]);
  assert(String(yt.channels[0].reason).startsWith("keyInvalid"), yt.channels[0].reason);
  assert(String(yt.channels[0].error).includes("[redac"), yt.channels[0].error);   // the echo arrived and was scrubbed before the cut
  assertEquals(leaksPart(JSON.stringify(out)), null, "the key, or part of it, reached the report");
});

Deno.test("runProbe(youtube) — without the key it says so and sends nothing", async () => {
  const host = youtubeHost();
  const out = await withKey(null, () => runProbe(new Set(["youtube"]), host.fetchImpl, { sleep: noSleep }));
  assertEquals(out.youtube, { error: "YOUTUBE_API_KEY is not set" });
  assertEquals(host.calls.length, 0);
});
