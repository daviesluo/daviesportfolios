// "Stablecoin quotes variant-3" (`p50x1`; docs/agents/reviews/2026-10-09-p50x1-prereg.md): variant-1's twin with its exit
// one tick beyond fair from its window's first minute. Its spec row as 0108 inserts it, its backfill the bytes the row
// pins and variant-1's record row for row before the offset starts, and the files its pre-registration froze, by sha256.
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
const ROW = rowsOf('0108_quote_twin_p50x1.sql').find((r) => r.id === 'p50x1');
const P50 = rowsOf('0088_quote_twin_specs.sql').find((r) => r.id === 'p50');
const MANIFEST = JSON.parse(read('docs/agents/backtests/twins/MANIFEST.json').toString('utf8'));
const DOC = read('docs/agents/reviews/2026-10-09-p50x1-prereg.md').toString('utf8');
const backfill = (id) => JSON.parse(zlib.gunzipSync(read(`docs/agents/backtests/twins/${id}.json.gz`)).toString('utf8'));

describe("p50x1, variant-1 with its exit a tick beyond fair", () => {
  it("is a row of 0108: variant-1's but for its id, name, place, tables, lease, rule, backfill and pre-registration", () => {
    const file = 'docs/agents/backtests/twins/p50x1.json.gz';
    expect(ROW).toEqual({
      ...P50, id: 'p50x1', display_name: 'Stablecoin quotes variant-3', display_order: 35, table_prefix: 'agent_quote_twin_p50x1', lease: 'quotes-twin-p50x1',
      rules: { exitOffset: { ticks: 1, from: '2026-10-12T00:00:00Z' } }, backfill: { file, sha256: sha(file), until: '2026-10-02T21:05:00.000Z' },
      prereg: 'docs/agents/reviews/2026-10-09-p50x1-prereg.md', migration: '0108',
    });
    expect(MANIFEST.committed['p50x1.json.gz']).toEqual({ bytes: read(file).length, sha256: sha(file) });
    // Its offset starts on a Monday at 00:00 UTC, after its backfill ends: its window's first minute.
    const from = new Date(ROW.rules.exitOffset.from);
    expect([from.getUTCDay(), from.getUTCHours(), from.getUTCMinutes()]).toEqual([1, 0, 0]);
    expect(from.getTime()).toBeGreaterThan(Date.parse(ROW.backfill.until));
    // The pre-registration shows the row as the migration inserts it.
    expect(JSON.parse(/```json\n(\{[^\n]*\})\n```/.exec(DOC)?.[1] ?? 'null')).toEqual(ROW);
  });

  it("is variant-1's record before its offset starts, row for row (the backfills)", () => {
    const a = backfill('p50'), b = backfill('p50x1');
    expect([a.twin, b.twin, b.until]).toEqual(['p50', 'p50x1', '2026-10-02T21:05:00.000Z']);
    const fills = (d) => d.orders.filter((o) => Number(o.filled_base) > 0).map((o) => [o.ts, o.book, o.rung_side, o.k, o.leg, o.side, o.filled_base, o.avg_fill_price, o.fee_gbp]);
    expect(fills(a).length).toBeGreaterThan(100);
    expect(fills(b)).toEqual(fills(a));
    for (const t of ['config', 'orders', 'events', 'state', 'paper', 'sim']) expect(b[t], t).toEqual(a[t]);
    expect(JSON.stringify({ ...b, twin: 'p50' })).toBe(JSON.stringify(a));
  });

  it('names the sha256 of each file it froze, and each file is that one', () => {
    const named = (f) => [...DOC.matchAll(new RegExp('\\| `' + f.replace(/[.]/g, '\\.') + '` \\| ([0-9a-f]{64}) \\|', 'g'))].map((m) => m[1]);
    for (const f of [
      'supabase/migrations/0108_quote_twin_p50x1.sql', 'docs/agents/backtests/twins/p50x1.json.gz', 'supabase/functions/agents/quotes_live.ts',
      'supabase/functions/agents/quotes_twin.ts', 'supabase/functions/agents/revx_sim.ts',
    ]) expect(named(f), f).toEqual([sha(f)]);
  });
});
