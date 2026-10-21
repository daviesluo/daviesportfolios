// "Stablecoin quotes LIVE twin" (`live`; docs/agents/reviews/2026-10-21-live-twin-prereg.md): PR5's twin at LIVE's £120 with LIVE's
// own fill rule (`rules.fill`), its backfill LIVE's life replayed from its go-live. Its spec row as 0136 inserts it (pr5's but for its
// id, name, place, capital, tables, lease, rule, backfill and pre-registration), the row the pre-registration shows, its backfill's
// bytes, and the files the pre-registration froze, by sha256.
import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p));
const sha = (p) => crypto.createHash('sha256').update(read(p)).digest('hex');
const rowsOf = (f) => JSON.parse(/null::public\.agent_quote_twin_specs, \$json\$(\[[\s\S]*?\])\$json\$/.exec(read(`supabase/migrations/${f}`).toString('utf8').replace(/--[^\n]*/g, ''))?.[1] ?? '[]');
const ROW = rowsOf('0136_quote_twin_live.sql').find((r) => r.id === 'live');
const PR5 = rowsOf('0088_quote_twin_specs.sql').find((r) => r.id === 'pr5');
const DOC = read('docs/agents/reviews/2026-10-21-live-twin-prereg.md').toString('utf8');

describe('the LIVE twin', () => {
  it("is a row of 0136: pr5's but for its id, name, place, LIVE's capital, its tables, lease, fill rule, backfill and pre-registration", () => {
    const file = 'docs/agents/backtests/twins/live.json.gz';
    expect(ROW).toEqual({
      ...PR5, id: 'live', display_name: 'Stablecoin quotes LIVE twin', display_order: 15, capital_gbp: 120, table_prefix: 'agent_quote_twin_live', lease: 'quotes-twin-live',
      rules: { fill: { model: 'at', from: '2026-09-23T15:09:00Z' } }, backfill: { file, sha256: sha(file), until: '2026-10-21T15:09:00.000Z' },
      prereg: 'docs/agents/reviews/2026-10-21-live-twin-prereg.md', migration: '0136',
    });
    // Its backfill is its own, to that minute, at LIVE's capital, and starts trading at LIVE's go-live: no order before it.
    const data = JSON.parse(zlib.gunzipSync(read(file)).toString('utf8'));
    expect([data.v, data.twin, data.until, Number(data.config.capital_gbp)]).toEqual([1, 'live', '2026-10-21T15:09:00.000Z', 120]);
    expect(Math.min(...data.orders.map((o) => Date.parse(o.ts)))).toBeGreaterThanOrEqual(Date.parse('2026-10-01T16:29:53Z'));
    // The pre-registration shows the row as the migration inserts it, and is frozen.
    expect(JSON.parse(/```json\n(\{[^\n]*\})\n```/.exec(DOC)?.[1] ?? 'null')).toEqual(ROW);
    expect(DOC).toContain('**Status: FROZEN**');
  });

  it('names the sha256 of each file it froze, once, and each file is that one', () => {
    const named = (f) => [...DOC.matchAll(new RegExp('\\| `' + f.replace(/[.]/g, '\\.') + '` \\| ([0-9a-f]{64}) \\|', 'g'))].map((m) => m[1]);
    for (const f of [
      'supabase/migrations/0136_quote_twin_live.sql', 'docs/agents/backtests/twins/live.json.gz', 'docs/agents/backtests/livesim/scripts/backfill_live.ts',
      'docs/agents/backtests/livesim/data/inputs.json.gz', 'docs/agents/backtests/livesim/data/live_events.txt.gz',
      'supabase/functions/agents/quotes_twin.ts', 'supabase/functions/agents/revx_sim.ts',
    ]) expect(named(f), f).toEqual([sha(f)]);
  });
});
