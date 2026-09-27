// Pins for the view-count recorder (views.ts): what it reads from Gamma's events, how it finds the video a market
// counts and the instant it counts it, the change-only record, and whole runs against fakes of Gamma, the CLOB and the
// YouTube Data API held to what each real one does (the key in a header, a NO book the mirror of its YES book).
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ChangeLog, deadlinesOf, HOT_AFTER_MS, HOT_BEFORE_MS, isoSeconds, isViewEvent, marketVideo, pacificDay, phaseAt, runEnd, runViews, SHORT_MAX_S,
  viewMarketsOf, VIEWS_OPEN_ROW_MS, VIEWS_RUN_MS, WARM_BEFORE_MS, windowHoursOf, YT_WINDOW_BUDGET,
  type ChannelRow, type VideoRow, type ViewMarketRow,
} from "./views.ts";
import { memDb, type Row } from "./testing.ts";

const YT_KEY = "AIzaSyPLANTED-yt-key_0123456789ABCDEFGH";
const BEAST = "UCX6OQ3DkcsbYNE6H8uQQuVA", GAMING = "UCIPPMRA040LQr5QPyJEbmXA";
const POSTED = "2026-09-26T16:00:04Z";                          // the Gaming upload the day-1 market counts
const DEADLINE = Date.parse(POSTED) + 24 * 3_600e3;             // 2026-09-27 16:00:04 UTC

const gamingDay1 = {
  slug: "of-views-of-next-mrbeast-gaming-video-on-day-1-20260922", title: "# of views of next MrBeast Gaming video on day 1?",
  startDate: "2026-09-22T23:13:42Z",
  description: "This market will resolve according to the number of views the next YouTube video posted by MrBeast Gaming gets in the first 24 hours after being posted. " +
    "The resolution source for this market is MrBeast Gaming's YouTube channel (https://www.youtube.com/@MrBeastGaming), specifically the 'views' counter for the described video. " +
    "Note: This market refers to MrBeast Gaming's next video to be posted. Shorts, previews, or other videos released other than the referenced video will not be considered.",
  markets: [
    { conditionId: "0xg1", clobTokenIds: '["y-g1","n-g1"]', groupItemTitle: "15–17.5M", question: "15-17.5M?", closed: false, enableOrderBook: true },
    { conditionId: "0xg2", clobTokenIds: '["y-g2","n-g2"]', groupItemTitle: "17.5–20M", question: "17.5-20M?", closed: false, enableOrderBook: true },
    { conditionId: "0xg0", clobTokenIds: '["y-g0","n-g0"]', groupItemTitle: "<10M", question: "<10M?", closed: true, enableOrderBook: true },
  ],
};
const beastDay2 = {
  slug: "of-views-of-mrbeast-video-on-day-2-20260919", title: "# of views of MrBeast video on day 2?", startDate: "2026-09-20T02:49:00Z",
  description: "…gets in the first 48 hours after being posted. MrBeast's YouTube channel (https://www.youtube.com/@MrBeast). " +
    "Note: This market refers only to the video \"I Built A City\" by MrBeast (see: https://www.youtube.com/watch?v=v9QtM6qnG50).",
  markets: [{ conditionId: "0xb1", clobTokenIds: '["y-b1","n-b1"]', groupItemTitle: "60-65M", question: "60-65M?", closed: false }],
};
const subscribers = {
  slug: "will-mrbeast-hit-million-subscribers-by-september-30-2026", title: "Will MrBeast hit ... subscribers", startDate: "2026-09-01T12:24:53Z",
  description: "…if the MrBeast YouTube channel (https://www.youtube.com/@MrBeast) hits the specified number of subscribers by September 30, 2026, 11:59 PM ET.",
  markets: [{ conditionId: "0xs1", clobTokenIds: '["y-s1","n-s1"]', groupItemTitle: "519m", question: "519m?", closed: false }],
};
const rogan = {
  slug: "what-will-be-said-on-the-first-joe-rogan-experience-episode", title: "What will be said on Rogan?", startDate: "2026-09-26T00:00:00Z",
  description: "Joe Rogan's podcast on https://www.youtube.com/@joerogan", markets: [{ conditionId: "0xr", clobTokenIds: '["y-r","n-r"]', closed: false }],
};
const EVENTS = [gamingDay1, beastDay2, subscribers, rogan];

Deno.test("windowHoursOf: hours, days and weeks as the rules say them; nothing when they do not", () => {
  assertEquals(windowHoursOf("gets in the first 24 hours after being posted"), 24);
  assertEquals(windowHoursOf("gets in the first 7 days after being posted"), 168);
  assertEquals(windowHoursOf("in the first 168 hours"), 168);
  assertEquals(windowHoursOf("in its first 1 week"), 168);
  assertEquals(windowHoursOf("hits the specified number of views by September 30"), null);
});

Deno.test("viewMarketsOf: the open markets of a view event, with the handle, the named video and the hours; other events give nothing", () => {
  const at = "2026-09-27T01:00:00.000Z";
  const g = viewMarketsOf(gamingDay1, at);
  assertEquals(g.map((m) => [m.cond, m.yes, m.no, m.handle, m.video_id, m.window_h]), [
    ["0xg1", "y-g1", "n-g1", "@MrBeastGaming", null, 24],
    ["0xg2", "y-g2", "n-g2", "@MrBeastGaming", null, 24],
  ]);                                                           // the closed bracket is not recorded
  assertEquals([g[0].event_start, g[0].label, g[0].last_seen], ["2026-09-22T23:13:42Z", "15–17.5M", at]);
  assertEquals(viewMarketsOf(beastDay2, at).map((m) => [m.handle, m.video_id, m.window_h]), [["@MrBeast", "v9QtM6qnG50", 48]]);
  assertEquals(viewMarketsOf(subscribers, at).map((m) => [m.handle, m.video_id, m.window_h]), [["@MrBeast", null, null]]);
  assertEquals([isViewEvent(rogan), viewMarketsOf(rogan, at)], [false, []]);
});

Deno.test("isoSeconds reads YouTube's durations; a Short is at most three minutes", () => {
  assertEquals([isoSeconds("PT16M19S"), isoSeconds("PT40S"), isoSeconds("PT1H2M3S"), isoSeconds("P1DT2H"), isoSeconds("P0D")], [979, 40, 3723, 93_600, 0]);
  assertEquals([isoSeconds(""), isoSeconds("PT"), isoSeconds("16:19"), isoSeconds(null)], [null, null, null, null]);
  assertEquals(SHORT_MAX_S, 180);
});

Deno.test("pacificDay: Google's quota day turns at midnight Pacific (07:00 UTC in summer time, 08:00 in winter)", () => {
  assertEquals(pacificDay(Date.parse("2026-09-27T06:59:59Z")), "2026-09-26");
  assertEquals(pacificDay(Date.parse("2026-09-27T07:00:00Z")), "2026-09-27");
  assertEquals(pacificDay(Date.parse("2026-12-01T07:59:59Z")), "2026-11-30");
  assertEquals(pacificDay(Date.parse("2026-12-01T08:00:00Z")), "2026-12-01");
});

const CHANNELS: ChannelRow[] = [
  { channel_id: BEAST, handle: "@MrBeast", title: "MrBeast", uploads: "UUX6OQ3DkcsbYNE6H8uQQuVA" },
  { channel_id: GAMING, handle: "@MrBeastGaming", title: "MrBeast Gaming", uploads: "UUIPPMRA040LQr5QPyJEbmXA" },
];
const VIDEOS: VideoRow[] = [
  { video_id: "gamingShort", channel_id: GAMING, title: "a Short", published_at: "2026-09-24T12:00:00Z", duration_s: 45, short: true },
  { video_id: "PyLGTmWz37U", channel_id: GAMING, title: "Minecraft World", published_at: POSTED, duration_s: 979, short: false },
  { video_id: "gamingLater", channel_id: GAMING, title: "later", published_at: "2026-09-29T16:00:00Z", duration_s: 900, short: false },
  { video_id: "v9QtM6qnG50", channel_id: BEAST, title: "I Built A City", published_at: "2026-09-19T16:00:01Z", duration_s: 1143, short: false },
];

Deno.test("marketVideo: the video the rules name, else the channel's first upload after the event began that is not a Short", () => {
  const [g1] = viewMarketsOf(gamingDay1, "2026-09-27T01:00:00.000Z");
  const [b1] = viewMarketsOf(beastDay2, "2026-09-27T01:00:00.000Z");
  assertEquals(marketVideo(g1, VIDEOS, CHANNELS)?.video_id, "PyLGTmWz37U");   // the Short posted first does not count
  assertEquals(marketVideo(b1, VIDEOS, CHANNELS)?.video_id, "v9QtM6qnG50");
  assertEquals(marketVideo(g1, VIDEOS.filter((v) => v.video_id !== "PyLGTmWz37U" && v.video_id !== "gamingLater"), CHANNELS), null);   // not posted yet
  assertEquals(marketVideo({ ...g1, handle: "@mrbeastgaming" }, VIDEOS, CHANNELS)?.video_id, "PyLGTmWz37U");                     // handles match in any case
  const [s1] = viewMarketsOf(subscribers, "2026-09-27T01:00:00.000Z");
  assertEquals(marketVideo(s1, VIDEOS, CHANNELS), null);                                     // a channel's totals count no video
  assertEquals(viewMarketsOf({ ...subscribers, description: "the channel (https://www.youtube.com/@MrBeast." }, "x")[0].handle, "@MrBeast");
});

Deno.test("deadlinesOf + phaseAt: each video's counting instant, with every open market on that video, and its windows", () => {
  const ms = [...viewMarketsOf(gamingDay1, "x"), ...viewMarketsOf(beastDay2, "x"), ...viewMarketsOf(subscribers, "x")];
  const dl = deadlinesOf(ms, VIDEOS, CHANNELS);
  assertEquals(dl.map((d) => [d.video_id, new Date(d.at).toISOString(), d.tokens]), [
    ["v9QtM6qnG50", "2026-09-21T16:00:01.000Z", ["y-b1"]],
    ["PyLGTmWz37U", "2026-09-27T16:00:04.000Z", ["y-g1", "y-g2"]],
  ]);                                                           // the subscriber market counts no video, so it has no window
  assertEquals(phaseAt(DEADLINE, DEADLINE - HOT_BEFORE_MS), "hot");
  assertEquals(phaseAt(DEADLINE, DEADLINE + HOT_AFTER_MS), "hot");
  assertEquals(phaseAt(DEADLINE, DEADLINE + HOT_AFTER_MS + 1), null);
  assertEquals(phaseAt(DEADLINE, DEADLINE - HOT_BEFORE_MS - 1), "warm");
  assertEquals(phaseAt(DEADLINE, DEADLINE - WARM_BEFORE_MS), "warm");
  assertEquals(phaseAt(DEADLINE, DEADLINE - WARM_BEFORE_MS - 1), null);
});

Deno.test("ChangeLog: an unchanged read extends its row, a change starts one, a gap starts one, and a batch names each row once", () => {
  const log = new ChangeLog("yt_video_reads", "video_id", ["views", "likes", "comments"]);
  const t = Date.parse("2026-09-27T12:00:00Z");
  log.seed([{ video_id: "a", ts: "2026-09-27T11:58:00.000Z", views: 5, likes: 1, comments: 1, seen_until: "2026-09-27T11:59:00.000Z", reads: 4 }]);
  assertEquals(log.observe("a", t, { views: 5, likes: 1, comments: 1 }), "same");
  assertEquals(log.observe("a", t + 1_000, { views: 6, likes: 1, comments: 1 }), "new");
  assertEquals(log.observe("a", t + 2_000, { views: 6, likes: 1, comments: 1 }), "same");
  assertEquals(log.take(), [
    { video_id: "a", ts: "2026-09-27T11:58:00.000Z", views: 5, likes: 1, comments: 1, seen_until: "2026-09-27T12:00:00.000Z", reads: 5 },
    { video_id: "a", ts: "2026-09-27T12:00:01.000Z", views: 6, likes: 1, comments: 1, seen_until: "2026-09-27T12:00:02.000Z", reads: 2 },
  ]);
  assertEquals(log.take(), []);                                 // nothing changed since
  // The same value after a gap longer than VIEWS_OPEN_ROW_MS is a new row: nobody saw the counter in between.
  assertEquals(log.observe("a", t + 2_000 + VIEWS_OPEN_ROW_MS + 1, { views: 6, likes: 1, comments: 1 }), "new");
  // A write that failed is offered again, and a newer copy of the same row wins.
  const rows = log.take();
  log.giveBack(rows);
  log.observe("a", t + 3_000 + VIEWS_OPEN_ROW_MS, { views: 6, likes: 1, comments: 1 });
  const again = log.take();
  assertEquals(again.length, 1);
  assertEquals(again[0].reads, 2);
});

// ---------------------------------------------------------------------------------------------------------------------
// Whole runs, against fakes of the three hosts.

type Call = { method: string; url: URL; headers: Headers; body: unknown };

/**
 * Gamma's events, the CLOB's books and the Data API, all served from one fake clock. The Gaming video's counter moves
 * in batches every 30 s, as the probe found the API's does; the books move every 20 s. The Data API refuses a request
 * without the key in its header, and answers `quotaExceeded` once `quotaAfter` calls have been made.
 */
function hosts(clock: { now: number }, opts: { quotaAfter?: number } = {}) {
  const calls: Call[] = [];
  const yt = () => calls.filter((c) => c.url.hostname === "www.googleapis.com").length;
  const fetchImpl = (async (input: Request | URL | string, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const headers = new Headers(init?.headers);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method: (init?.method ?? "GET").toUpperCase(), url, headers, body });
    clock.now += 40;                                            // every reply takes 40 ms
    const ok = (x: unknown) => new Response(JSON.stringify(x), { status: 200 });
    if (url.hostname === "gamma-api.polymarket.com" && url.pathname === "/events") {
      assertEquals([url.searchParams.get("tag_id"), url.searchParams.get("closed")], ["146", "false"]);
      return ok(EVENTS);
    }
    if (url.hostname === "clob.polymarket.com" && url.pathname === "/books") {
      const step = Math.floor(clock.now / 20_000);
      return ok((body as { token_id: string }[]).map(({ token_id }) => ({
        asset_id: token_id, tick_size: "0.01",
        bids: [{ price: "0.40", size: String(100 + (step % 3)) }, { price: "0.39", size: "5" }],
        asks: [{ price: "0.42", size: "7" }],
      })));
    }
    if (url.hostname === "www.googleapis.com") {
      if (headers.get("X-Goog-Api-Key") !== YT_KEY || url.searchParams.has("key")) return new Response(JSON.stringify({ error: { code: 403, errors: [{ reason: "forbidden" }] } }), { status: 403 });
      if (opts.quotaAfter != null && yt() > opts.quotaAfter) {
        return new Response(JSON.stringify({ error: { code: 403, message: "quota", errors: [{ reason: "quotaExceeded" }] } }), { status: 403 });
      }
      const q = url.searchParams, path = url.pathname.replace("/youtube/v3/", "");
      if (path === "channels" && q.get("forHandle")) {
        const c = CHANNELS.find((x) => x.handle!.toLowerCase() === q.get("forHandle")!.toLowerCase());
        return ok({ items: c ? [{ id: c.channel_id, snippet: { title: c.title }, contentDetails: { relatedPlaylists: { uploads: c.uploads } } }] : [] });
      }
      if (path === "channels") {
        return ok({ items: q.get("id")!.split(",").map((id) => ({ id, statistics: { subscriberCount: "518000000", viewCount: "140927554036", videoCount: "1003" } })) });
      }
      if (path === "playlistItems") {
        const ch = CHANNELS.find((c) => c.uploads === q.get("playlistId"))!;
        return ok({ items: VIDEOS.filter((v) => v.channel_id === ch.channel_id).map((v) => ({ contentDetails: { videoId: v.video_id, videoPublishedAt: v.published_at } })) });
      }
      if (path === "videos" && q.get("part") === "statistics") {
        const batch = Math.floor(clock.now / 30_000);
        return ok({ items: q.get("id")!.split(",").map((id) => ({ id, statistics: { viewCount: String(id === "PyLGTmWz37U" ? 6_987_687 + 13_000 * batch : 72_662_350), likeCount: "10", commentCount: "20" } })) });
      }
      if (path === "videos") {
        return ok({ items: q.get("id")!.split(",").map((id) => VIDEOS.find((v) => v.video_id === id)).filter(Boolean).map((v) => ({
          id: v!.video_id, snippet: { channelId: v!.channel_id, title: v!.title, publishedAt: v!.published_at }, contentDetails: { duration: `PT${v!.duration_s}S` },
        })) });
      }
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { calls, fetchImpl, yt };
}

function world(startIso: string, seed: Record<string, Row[]> = {}, opts: { quotaAfter?: number } = {}) {
  const clock = { now: Date.parse(startIso) };
  const { db, tables } = memDb({ agent_locks: [{ name: "views", lease_until: "1970-01-01T00:00:00.000Z", holder: null }], ...seed }, { now: () => clock.now });
  const h = hosts(clock, opts);
  const deps = (key: string | null = YT_KEY) => ({
    db, holder: crypto.randomUUID(), yt: key ? { key, fetchImpl: h.fetchImpl } : null, pm: { fetchImpl: h.fetchImpl },
    clock: () => clock.now, sleep: async (ms: number) => { clock.now += ms; },
  });
  return { clock, db, tables, h, deps };
}

Deno.test("runViews — a discovery minute far from any deadline: markets, channels, uploads, one read of each, the units counted", async () => {
  const w = world("2026-09-27T12:00:00.000Z");
  const r = await runViews(w.deps());
  assertEquals(r.errors, []);
  assertEquals(r.discovered, { events: 3, markets: 4, channels: 2, videos: 4 });
  assertEquals(w.tables.pm_view_markets.map((m) => m.cond).sort(), ["0xb1", "0xg1", "0xg2", "0xs1"]);
  assertEquals(w.tables.yt_channels.map((c) => [c.channel_id, c.handle]).sort(), [[GAMING, "@MrBeastGaming"], [BEAST, "@MrBeast"]].sort());
  assertEquals(w.tables.yt_videos.find((v) => v.video_id === "gamingShort")?.short, true);
  // Each tracked video read once (the week-old named one too), each YES book once, the channels' totals on a fifth minute.
  assertEquals(w.tables.yt_video_reads.map((x) => x.video_id).sort(), ["PyLGTmWz37U", "gamingLater", "gamingShort", "v9QtM6qnG50"]);
  assertEquals(w.tables.pm_view_books.map((x) => x.token).sort(), ["y-b1", "y-g1", "y-g2", "y-s1"]);
  assertEquals(w.tables.yt_channel_reads.length, 2);
  // 2 handles + 2 upload lists + 1 batch of new videos' records + 1 batch of counters + 1 of channel totals.
  assertEquals(r.units, 7);
  assertEquals(w.tables.yt_quota, [{ day: "2026-09-27", units: 7 }]);
  assertEquals(r.windowReads, 0);
  assert(w.clock.now - Date.parse("2026-09-27T12:00:00Z") < 5_000, "no window open: the run ends at once");
  // The key went in the header on every Data API call, and in no URL.
  for (const c of w.h.calls.filter((x) => x.url.hostname === "www.googleapis.com")) {
    assertEquals([c.headers.get("X-Goog-Api-Key"), c.url.searchParams.get("key"), c.url.href.includes("AIza")], [YT_KEY, null, false]);
  }
  assertEquals(w.tables.agent_locks[0].holder, null);         // the lease is given back
});

Deno.test("runViews — inside a deadline's hot window it reads every second until 56 s, and stores each batch once", async () => {
  const start = new Date(DEADLINE - 5 * 60e3 + 56e3).toISOString();   // 15:56:00.000 UTC: a minute, not a fifth one
  const w = world(start);
  // A first run discovers (no market stored yet), so this one reads every second of its minute.
  const r = await runViews(w.deps());
  assertEquals(r.errors, []);
  assertEquals(r.tracked.windows, 1);
  assert(r.windowReads >= 50 && r.windowReads <= 55, `${r.windowReads} window reads`);
  assert(w.clock.now - Date.parse(start) <= VIEWS_RUN_MS + 1_000, "the run ends inside its budget");
  // The Gaming counter moved in 30-s batches: one row per batch, each read many times, the instants between rows known to a second.
  const g = w.tables.yt_video_reads.filter((x) => x.video_id === "PyLGTmWz37U").sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  assert(g.length >= 2 && g.length <= 3, `${g.length} rows`);
  for (let i = 1; i < g.length; i++) {
    assert(Number(g[i].views) > Number(g[i - 1].views));
    const gap = Date.parse(String(g[i].ts)) - Date.parse(String(g[i - 1].seen_until));
    assert(gap > 0 && gap <= 1_200, `a batch placed within ${gap} ms`);
  }
  assert(g.reduce((a, x) => a + Number(x.reads), 0) >= 50);
  // Only the hot video and its two markets were read every second; the named MrBeast video once, at the minute.
  assertEquals(w.tables.yt_video_reads.filter((x) => x.video_id === "v9QtM6qnG50").map((x) => x.reads), [1]);
  const g1 = w.tables.pm_view_books.filter((x) => x.token === "y-g1");
  assert(g1.length >= 3 && g1.length <= 4, `${g1.length} book rows (its size changes every 20 s)`);
  assertEquals(w.tables.pm_view_books.filter((x) => x.token === "y-s1").length, 1);
  assertEquals(w.tables.yt_quota[0].units, r.units);
});

Deno.test("runViews — the next minute extends the rows still open instead of starting new ones", async () => {
  const w = world("2026-09-27T12:00:00.000Z");
  await runViews(w.deps());
  w.clock.now = Date.parse("2026-09-27T12:01:00.000Z");
  const r = await runViews(w.deps());
  assertEquals(r.errors, []);
  assertEquals(r.discovered, null);                             // not a fifth minute, and markets are stored
  const v = w.tables.yt_video_reads.filter((x) => x.video_id === "v9QtM6qnG50");
  assertEquals(v.map((x) => x.reads), [2]);
  assert(String(v[0].seen_until).startsWith("2026-09-27T12:01:00"));
  assertEquals(r.units, 1);                                     // one batch of counters; channel totals only every fifth minute
});

Deno.test("runViews — past the window budget the windows read books only; a quota refusal stops YouTube for the run", async () => {
  const start = new Date(DEADLINE - 5 * 60e3 + 56e3).toISOString();
  const w = world(start, { yt_quota: [{ day: "2026-09-27", units: YT_WINDOW_BUDGET }] });
  const r = await runViews(w.deps());
  assert(r.windowReads >= 50);
  assertEquals(r.units, 6);                                     // the minute's reads only (below the day's 9,800); none in the window
  assert(w.tables.pm_view_books.filter((x) => x.token === "y-g1").length >= 3, "books are still read every second");

  const q = world(start, {}, { quotaAfter: 3 });
  const rq = await runViews(q.deps());
  assert(rq.errors.some((e) => e.includes("quota")), rq.errors.join(" | "));
  assert(q.h.yt() <= 5, `${q.h.yt()} Data API calls after the refusal`);
});

Deno.test("runViews — another run's lease: nothing is read. No key: books and markets still recorded, no Data API call", async () => {
  const w = world("2026-09-27T12:00:00.000Z", { agent_locks: [{ name: "views", lease_until: "2026-09-27T12:00:30.000Z", holder: "someone" }] });
  const r = await runViews(w.deps());
  assertEquals([r.skipped, w.h.calls.length], ["another run holds the views lease", 0]);

  const n = world("2026-09-27T12:00:00.000Z");
  const rn = await runViews(n.deps(null));
  assertEquals([rn.units, n.h.yt()], [0, 0]);
  assertEquals(n.tables.pm_view_books.length, 4);
  assertEquals(n.tables.pm_view_markets.length, 4);
});

Deno.test("runViews — the rows still open are read page by page: thirty tokens' books a second apart are more than one page", async () => {
  // 30 tokens × 40 rows inside the last three minutes = 1,200 rows. One PostgREST page holds 1,000, so a single read
  // lost the last five tokens' open rows and started a duplicate row for each (the first version of this recorder).
  const t0 = Date.parse("2026-09-27T12:01:00.000Z");
  const tokens = Array.from({ length: 30 }, (_, i) => `tok${String(i).padStart(2, "0")}`);
  const now = { bids: [[0.4, 100 + (Math.floor((t0 + 40) / 20_000) % 3)], [0.39, 5]], asks: [[0.42, 7]] };
  const books: Row[] = tokens.flatMap((token) => Array.from({ length: 40 }, (_, k) => {
    const ts = new Date(t0 - 160_000 + k * 4_000).toISOString();
    const last = k === 39;
    return { token, ts, bids: last ? now.bids : [[0.4, k + 1]], asks: now.asks, seen_until: last ? new Date(t0 - 1_000).toISOString() : ts, reads: 1 };
  }));
  const markets: Row[] = tokens.map((yes, i) => ({
    cond: `0xm${i}`, yes, no: `n${i}`, event_slug: "totals", event_start: "2026-09-01T00:00:00Z", label: null, question: null,
    handle: "@MrBeast", video_id: null, window_h: null, last_seen: new Date(t0 - 60e3).toISOString(),
  }));
  const w = world(new Date(t0).toISOString(), { pm_view_books: books, pm_view_markets: markets });
  const r = await runViews(w.deps());
  assertEquals(r.errors, []);
  assertEquals(r.discovered, null);
  for (const token of tokens) {
    const rows = w.tables.pm_view_books.filter((x) => x.token === token);
    assertEquals(rows.length, 40, `${token}: its open row was extended, not duplicated`);
    const newest = rows.reduce((a, b) => (String(a.ts) > String(b.ts) ? a : b));
    assertEquals([newest.reads, String(newest.seen_until) > new Date(t0).toISOString()], [2, true], token);
  }
});

Deno.test("runViews — a run that starts late in its minute still stops reading 56 s into the minute", async () => {
  const start = new Date(DEADLINE - 5 * 60e3 + 56e3 + 3_000).toISOString();   // 15:56:03: a cold start three seconds late
  const w = world(start);
  const r = await runViews(w.deps());
  assertEquals(runEnd(Date.parse(start)), Date.parse("2026-09-27T15:56:56.000Z"));
  assert(w.clock.now <= Date.parse("2026-09-27T15:56:57.000Z"), new Date(w.clock.now).toISOString());
  assert(r.windowReads >= 48 && r.windowReads <= 52, `${r.windowReads} window reads`);
});
