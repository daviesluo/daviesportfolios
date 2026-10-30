// The release blackout of the two Coinbase paper tests ("Stablecoin quotes with Euros", Deviation 3 of
// docs/agents/reviews/2026-10-10-coinbase-paper-prereg.md; "- 2", Deviation 2 of 2026-10-13-coinbase-weekend-prereg.md; Davies, 2026-10-15):
// the frozen list against the calendar that was fetched, both drivers calling the one function, and the deviations naming the bytes.
// The list's own properties (sorted, UTC, local clock times, complete for the windows, seven dark minutes) are cb_releases.test.ts's.
import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, p))).digest('hex');
/** The compounding deviation (2026-10-30, 0183), recorded apart: under each pre-registration's own heading, the files as they are. */
const APART = read('docs/agents/reviews/2026-10-30-compounding-deviation.md');
const apartFor = (doc) => {
  const s = APART.indexOf('### `' + doc + '`'), rest = s < 0 ? '' : APART.slice(s + 1), e = rest.search(/\n##/);
  return rest.slice(0, e < 0 ? undefined : e);
};
const MOD = read('supabase/functions/agents/cb_releases.ts');
const CAL = JSON.parse(read('docs/agents/backtests/cbreview/inputs/release_calendar.json'));
const BASE = read('docs/agents/reviews/2026-10-10-coinbase-paper-prereg.md');
const HOLD = read('docs/agents/reviews/2026-10-13-coinbase-weekend-prereg.md');
const MANIFEST = JSON.parse(read('docs/agents/backtests/cbwk/MANIFEST.json'));
const GROUP = "the release blackout's, changed or added 2026-10-15";

const listed = () => {
  const body = /export const CB_RELEASES[^=]*= \[([\s\S]*?)\n\];/.exec(MOD)?.[1] ?? '';
  return [...body.matchAll(/\["(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00Z)", "(\w+)"\]/g)].map((m) => [m[1], m[2]]);
};

describe('the release blackout', () => {
  it('lists exactly the fetched calendar from 2026-10-15 to 2026-12-31, instant for instant', () => {
    const want = CAL.events.filter((e) => e.t > Date.parse('2026-10-15T00:00:00Z') && e.day <= '2026-12-31').map((e) => [`${e.utc}:00`.replace('Z:00', ':00Z'), e.kind]);
    expect(want.length).toBe(10);
    expect(listed()).toEqual(want);
    // The CPI of 2026-10-14 is over and is not in it; every first-party date is the fetched one.
    expect(listed().map(([t]) => t)).not.toContain('2026-10-14T12:30:00Z');
  });

  it('marks every date that did not come from its own source as unconfirmed, and no other', () => {
    const lines = MOD.split('\n').filter((l) => /^\s+\["\d{4}/.test(l));
    for (const l of lines) {
      const kind = /"(\w+)"\],/.exec(l)?.[1];
      const day = /\["(\d{4}-\d{2}-\d{2})/.exec(l)?.[1];
      const ev = CAL.events.find((e) => e.day === day && e.kind === kind);
      expect(ev, l).toBeTruthy();
      expect(/UNCONFIRMED/.test(l), l).toBe(ev.source !== 'first-party' && !(kind === 'nfp' && day === '2026-11-06'));
    }
  });

  it('is applied by both drivers through the one function, on the fair alone', () => {
    for (const f of ['cb_quotes.ts', 'cb_hold.ts']) {
      const src = read(`supabase/functions/agents/${f}`);
      expect(src, f).toContain('import { cbInBlackout } from "./cb_releases.ts";');
      expect(src, f).toContain('const inp: MinuteInputs = { ...io, fairU: cbInBlackout(t) ? null : io.fairU, prints: mine };');
    }
    // stepMinute and the frozen replay are not touched by it.
    expect(MANIFEST.frozen["the base test's, unchanged by 0118 and by the release blackout"]).toHaveProperty('supabase/functions/agents/quotes.ts');
    expect(MANIFEST.frozen["the base test's, unchanged by 0118 and by the release blackout"]).toHaveProperty('docs/agents/backtests/cbpaper/scripts/replay.py');
  });

  it("is a deviation of each pre-registration that names its bytes, its start, its record and its pairing", () => {
    const d3 = BASE.slice(BASE.indexOf('### Deviation 3'));
    const d2 = HOLD.slice(HOLD.indexOf('**Deviation 2'));
    expect(d3.length).toBeGreaterThan(500);
    expect(d2.length).toBeGreaterThan(500);
    for (const d of [d3, d2]) {
      expect(d).toContain('目前的两个Coinbase 测试采用发布前后暂停的规则吧');
      expect(d).toMatch(/from the first minute decided after the deploy/i);
      expect(d).toMatch(/read on the record as it ran/);
      expect(d).toMatch(/paired comparison[^.]*unaffected/);
      expect(d).toContain('cb_releases.ts');
    }
    const files = Object.keys(MANIFEST.frozen[GROUP]);
    expect(files.sort()).toEqual([
      'docs/agents/backtests/cbreview/inputs/release_calendar.json', 'supabase/functions/agents/cb_blackout_world.ts', 'supabase/functions/agents/cb_quotes.test.ts',
      'supabase/functions/agents/cb_quotes.ts', 'supabase/functions/agents/cb_releases.test.ts', 'supabase/functions/agents/cb_releases.ts',
    ]);
    for (const p of files) expect(d3, p).toContain(sha(p));
    // cb_hold.ts changed since, by the compounding (0183): named as it is in that deviation, recorded apart.
    const d2now = d2 + apartFor('docs/agents/reviews/2026-10-13-coinbase-weekend-prereg.md');
    for (const p of ['supabase/functions/agents/cb_hold.ts', 'supabase/functions/agents/cb_hold.test.ts', 'supabase/functions/agents/cb_releases.ts']) expect(d2now, p).toContain(sha(p));
  });
});
