// YouTube Data API v3, READ-ONLY, keyed by an API key (no OAuth): the public statistics of public channels and videos,
// nothing that belongs to an account. It exists for Polymarket's view-count markets ("# of views of MrBeast video on
// day 3", resolved on the video's own view counter), whose underlying nothing else records minute by minute.
//
// The key travels in the `X-Goog-Api-Key` header, never in a URL, so no error that quotes a URL can carry it; every
// error string is scrubbed of it as well, before it is cut. Quota: 10,000 units a day by default (Google's quota day
// ends at midnight Pacific time); every call this file can make costs 1 unit.

export const YT_BASE = "https://www.googleapis.com/youtube/v3";

/** Every method this client may call. A test fails if the probe asks for anything else. */
export const YT_READS = ["channels", "playlistItems", "videos"] as const;
export type YtRead = typeof YT_READS[number];

/** MrBeast's channel, which the probe checks its handle lookup against. */
export const MRBEAST_CHANNEL = "UCX6OQ3DkcsbYNE6H8uQQuVA";
/** The channels with open Polymarket view-count markets on 2026-09-26 (Gamma tag 146: `mrbeast-views-*`, `mrbeast-gaming-views`). */
export const YT_PROBE_HANDLES = ["@MrBeast", "@MrBeastGaming"] as const;
/** The probe reads the newest upload's view count this many times, this far apart: how often the API's counter moves. */
export const YT_PROBE_SAMPLES = 7;
export const YT_PROBE_GAP_MS = 5_000;

export type YtEnv = { key: string; base?: string; fetchImpl?: typeof fetch };
export type YtReply = { ok: boolean; status: number; data?: any; error?: string; reason?: string | null };

/** The key's shape, never a character of it: Google API keys are `AIza` + 35 URL-safe characters. */
export function ytKeyForm(key: string): string {
  return /^AIza[0-9A-Za-z_-]{35}$/.test(key) ? "google-api-key" : `unexpected form (${key.length} chars)`;
}

/** `s` with every occurrence of the key replaced; run BEFORE any cut, or a cut could keep part of it. */
export function ytScrub(s: string, key: string): string {
  return key ? s.split(key).join("[redacted]") : s;
}

/** One GET of the Data API. Errors come back as Google words them (`reason` e.g. keyInvalid, accessNotConfigured, quotaExceeded). */
export async function ytGet(env: YtEnv, method: YtRead, params: Record<string, string>): Promise<YtReply> {
  if (!(YT_READS as readonly string[]).includes(method)) return { ok: false, status: 0, error: `not a read: ${method}` };
  const u = new URL(`${env.base ?? YT_BASE}/${method}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  try {
    const res = await (env.fetchImpl ?? fetch)(u, {
      method: "GET",
      headers: { "X-Goog-Api-Key": env.key, Accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* not JSON: the text is the error below */ }
    if (!res.ok || data?.error) {
      const e = data?.error;
      const reason = e?.errors?.[0]?.reason ?? e?.details?.find?.((d: any) => d?.reason)?.reason ?? e?.status ?? null;
      return { ok: false, status: res.status, reason: reason == null ? null : ytScrub(String(reason), env.key).slice(0, 80), error: ytScrub(String(e?.message ?? text), env.key).slice(0, 300) };
    }
    return { ok: true, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, error: ytScrub(e instanceof Error ? e.message : String(e), env.key).slice(0, 300) };
  }
}

const num = (x: unknown): number | null => (x == null || x === "" || !Number.isFinite(Number(x)) ? null : Number(x));
const failed = (r: YtReply) => ({ status: r.status, reason: r.reason ?? null, error: r.error ?? null });

/**
 * What the key may do, read-only: the channels behind the open view markets (by handle, checked against MrBeast's known
 * id), their newest uploads with the fields a recorder would read, and one video's counter read `samples` times `gapMs`
 * apart — whether the API's view count moves between reads a few seconds apart. Reports no part of the key.
 */
export async function youtubeProbe(
  env: YtEnv,
  opts: { samples?: number; gapMs?: number; sleep?: (ms: number) => Promise<void>; now?: () => number } = {},
): Promise<Record<string, unknown>> {
  const samples = opts.samples ?? YT_PROBE_SAMPLES, gapMs = opts.gapMs ?? YT_PROBE_GAP_MS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  let units = 0;
  const get = (m: YtRead, p: Record<string, string>) => { units++; return ytGet(env, m, p); };
  const out: Record<string, unknown> = { keyForm: ytKeyForm(env.key), transport: "X-Goog-Api-Key header" };

  const channels: Record<string, unknown>[] = [];
  const uploads: { channel: string; videoId: string; publishedAt: string }[] = [];
  for (const handle of YT_PROBE_HANDLES) {
    const r = await get("channels", { part: "snippet,statistics,contentDetails", forHandle: handle });
    if (!r.ok) {
      channels.push({ handle, ...failed(r) });
      if (r.status === 400 || r.status === 403) break;   // a key problem answers the same for every handle: one is enough
      continue;
    }
    const c = r.data?.items?.[0];
    const playlist = c?.contentDetails?.relatedPlaylists?.uploads ?? null;
    const row: Record<string, unknown> = {
      handle, status: r.status, id: c?.id ?? null, title: c?.snippet?.title ?? null,
      subscriberCount: num(c?.statistics?.subscriberCount), viewCount: num(c?.statistics?.viewCount), videoCount: num(c?.statistics?.videoCount),
      hiddenSubscriberCount: c?.statistics?.hiddenSubscriberCount ?? null, uploads: playlist,
    };
    if (handle === "@MrBeast") row.matchesKnownId = c?.id === MRBEAST_CHANNEL;
    if (playlist) {
      const pl = await get("playlistItems", { part: "contentDetails", playlistId: playlist, maxResults: "3" });
      if (pl.ok) {
        const items = (pl.data?.items ?? []) as any[];
        row.newest = items.map((x) => ({ videoId: x?.contentDetails?.videoId ?? null, publishedAt: x?.contentDetails?.videoPublishedAt ?? null }));
        row.playlistFields = Object.keys(items[0]?.contentDetails ?? {});
        for (const x of items) if (x?.contentDetails?.videoId && x?.contentDetails?.videoPublishedAt) uploads.push({ channel: handle, videoId: x.contentDetails.videoId, publishedAt: x.contentDetails.videoPublishedAt });
      } else {
        row.newest = failed(pl);
      }
    }
    channels.push(row);
  }
  out.channels = channels;

  if (uploads.length) {
    const v = await get("videos", { part: "snippet,statistics,contentDetails", id: uploads.map((u) => u.videoId).join(",") });
    if (v.ok) {
      const items = (v.data?.items ?? []) as any[];
      out.videos = {
        status: v.status, count: items.length, statisticsFields: Object.keys(items[0]?.statistics ?? {}),
        rows: items.map((x) => ({
          id: x?.id ?? null, channel: x?.snippet?.channelTitle ?? null, title: x?.snippet?.title ?? null, publishedAt: x?.snippet?.publishedAt ?? null,
          viewCount: num(x?.statistics?.viewCount), likeCount: num(x?.statistics?.likeCount), commentCount: num(x?.statistics?.commentCount),
          duration: x?.contentDetails?.duration ?? null, live: x?.snippet?.liveBroadcastContent ?? null,
        })),
      };
    } else {
      out.videos = failed(v);
    }

    // The newest upload's counter, read again and again: does the API's number move between reads seconds apart?
    const newest = [...uploads].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))[0];
    const reads: Record<string, unknown>[] = [];
    for (let i = 0; i < samples; i++) {
      if (i) await sleep(gapMs);
      const r = await get("videos", { part: "statistics", id: newest.videoId });
      const it = r.ok ? r.data?.items?.[0] : null;
      reads.push(r.ok ? { at: new Date(now()).toISOString(), viewCount: num(it?.statistics?.viewCount), etag: it?.etag ?? null } : { at: new Date(now()).toISOString(), ...failed(r) });
    }
    const counts = reads.map((x) => x.viewCount).filter((x): x is number => typeof x === "number");
    let changes = 0;
    for (let i = 1; i < counts.length; i++) if (counts[i] !== counts[i - 1]) changes++;
    out.cadence = { videoId: newest.videoId, channel: newest.channel, publishedAt: newest.publishedAt, gapMs, reads, changes };
  }
  out.units = units;
  return out;
}
