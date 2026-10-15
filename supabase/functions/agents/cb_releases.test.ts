// The release list of the Coinbase blackout (cb_releases.ts): sorted, in UTC, each instant the local clock time the release is
// scheduled at (DST as it is on the day), and complete for the two tests' windows. The list against the fetched calendar
// (docs/agents/backtests/cbreview/inputs/release_calendar.json) is src/cb_blackout.test.js's, which can read files.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { CB_BLACKOUT_LEAD_MS, CB_BLACKOUT_TRAIL_MS, CB_RELEASE_MS, CB_RELEASES, cbInBlackout } from "./cb_releases.ts";

const M = 60e3;

Deno.test("the release list is ascending, strictly, in UTC, and every instant parses back to itself", () => {
  assertEquals(CB_RELEASE_MS.length, CB_RELEASES.length);
  for (let i = 0; i < CB_RELEASES.length; i++) {
    const [t] = CB_RELEASES[i];
    assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00Z$/.test(t), `${t} is a whole minute in UTC`);
    assertEquals(new Date(CB_RELEASE_MS[i]).toISOString().replace(".000Z", "Z"), t);
    if (i) assert(CB_RELEASE_MS[i] > CB_RELEASE_MS[i - 1], `${t} follows ${CB_RELEASES[i - 1][0]}`);
  }
  assertEquals([CB_BLACKOUT_LEAD_MS, CB_BLACKOUT_TRAIL_MS], [M, 5 * M]);
});

Deno.test("every instant is the clock time its release is scheduled at in its own city, DST as it is on the day", () => {
  const where = { cpi: ["America/New_York", "08:30"], nfp: ["America/New_York", "08:30"], fomc: ["America/New_York", "14:00"], ecb: ["Europe/Berlin", "14:15"], boe: ["Europe/London", "12:00"] } as const;
  for (const [t, kind] of CB_RELEASES) {
    const [zone, clock] = where[kind];
    const local = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(t));
    assertEquals(local, clock, `${kind} ${t} in ${zone}`);
  }
  // The offsets that matter in the list: Europe's summer time ended 2026-10-25 and the US's 2026-11-01.
  const at = (s: string) => CB_RELEASES.find(([t]) => t === s)![1];
  assertEquals(at("2026-10-28T18:00:00Z"), "fomc");      // 14:00 EDT
  assertEquals(at("2026-10-29T13:15:00Z"), "ecb");       // 14:15 CET
  assertEquals(at("2026-11-06T13:30:00Z"), "nfp");       // 08:30 EST
  assertEquals(at("2026-12-09T19:00:00Z"), "fomc");      // 14:00 EST
});

Deno.test("the list is complete for the windows of the two tests: the base test's to 2026-11-08 and 'Euros - 2' to 2026-11-10", () => {
  const day = (s: string) => Date.parse(`${s}T00:00:00Z`);
  const inside = (from: string, to: string) => CB_RELEASES.filter(([t]) => Date.parse(t) >= day(from) && Date.parse(t) < day(to)).map(([t, k]) => `${t.slice(0, 10)} ${k}`);
  // The Fed's, the ECB's and the Bank of England's own calendars and the NFP of 6 November: four releases in each window. The CPI of
  // 2026-11-10 falls on the last day of "- 2" but after its window's end (00:00 UTC), and is listed for what follows.
  const four = ["2026-10-28 fomc", "2026-10-29 ecb", "2026-11-05 boe", "2026-11-06 nfp"];
  assertEquals(inside("2026-10-11", "2026-11-08"), four);
  assertEquals(inside("2026-10-13", "2026-11-10"), four);
  assertEquals(CB_RELEASES.filter(([t]) => t.startsWith("2026-11-10")).map(([, k]) => k), ["cpi"]);
  // Nothing before the deploy, and nothing past the year the list was fetched for.
  assert(CB_RELEASE_MS[0] > Date.UTC(2026, 9, 15));
  assert(CB_RELEASE_MS.at(-1)! < Date.UTC(2027, 0, 1));
});

Deno.test("a release's seven dark minutes are T - 1 to T + 5 and no others, for every release in the list", () => {
  for (const T of CB_RELEASE_MS) {
    const dark: number[] = [];
    for (let m = -10; m <= 10; m++) if (cbInBlackout(T + m * M)) dark.push(m);
    assertEquals(dark, [-1, 0, 1, 2, 3, 4, 5]);
  }
});
