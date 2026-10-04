// TAKE's twin, "Stablecoin quotes variant-2" (`take50`; docs/agents/reviews/2026-10-03-take-prereg.md): its spec row as
// 0089 inserts it, its backfill the bytes the row pins, and the pre-registration's check K1 on the committed record: before
// its rule's first minute it is variant-1's (`p50`) record, every row of every table the same but the twin's own id.
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
const ROW = rowsOf('0089_quote_twin_take50.sql').find((r) => r.id === 'take50');
const P50 = rowsOf('0088_quote_twin_specs.sql').find((r) => r.id === 'p50');
const MANIFEST = JSON.parse(read('docs/agents/backtests/twins/MANIFEST.json').toString('utf8'));
const backfill = (id) => JSON.parse(zlib.gunzipSync(read(`docs/agents/backtests/twins/${id}.json.gz`)).toString('utf8'));

describe("TAKE's twin, variant-2", () => {
  it("is a row of 0089: variant-1's but for its id, name, place, tables, lease, rule, backfill and pre-registration", () => {
    const file = 'docs/agents/backtests/twins/take50.json.gz';
    expect(ROW).toEqual({
      ...P50, id: 'take50', display_name: 'Stablecoin quotes variant-2', display_order: 30, table_prefix: 'agent_quote_twin_take50', lease: 'quotes-twin-take50',
      rules: { take: { from: '2026-10-05T00:00:00Z' } }, backfill: { file, sha256: sha(file), until: '2026-10-02T21:05:00.000Z' },
      prereg: 'docs/agents/reviews/2026-10-03-take-prereg.md', migration: '0089',
    });
    expect(MANIFEST.committed['take50.json.gz']).toEqual({ bytes: read(file).length, sha256: sha(file) });
  });

  it("is variant-1's record before its rule's first minute, row for row (check K1 on the backfills)", () => {
    const a = backfill('p50'), b = backfill('take50');
    expect([a.twin, b.twin, b.until]).toEqual(['p50', 'take50', '2026-10-02T21:05:00.000Z']);
    expect(Date.parse(b.until)).toBeLessThan(Date.parse(ROW.rules.take.from));
    // The orders (without ids, client ids numbered as the builder numbers them), their fills and fees, the events, the
    // executor's state, the replica, the account and its balances: the same, but the twin's own id.
    const fills = (d) => d.orders.filter((o) => Number(o.filled_base) > 0).map((o) => [o.ts, o.book, o.rung_side, o.k, o.leg, o.side, o.filled_base, o.avg_fill_price, o.fee_gbp]);
    expect(fills(a).length).toBeGreaterThan(100);
    expect(fills(b)).toEqual(fills(a));
    expect(b.sim.state.venue.balances).toEqual(a.sim.state.venue.balances);
    for (const t of ['config', 'orders', 'events', 'state', 'paper', 'sim']) expect(b[t], t).toEqual(a[t]);
    expect(JSON.stringify({ ...b, twin: 'p50' })).toBe(JSON.stringify(a));
    expect(b.orders.some((o) => o.request?.take === true)).toBe(false);
  });
});

describe('0090 — TAKE starts on 2026-10-04 at 16:00 UTC (its Addendum 1)', () => {
  it('moves only take50\'s take.from, and only from the frozen instant', () => {
    const sql = fs.readFileSync(path.join(ROOT, 'supabase/migrations/0090_take50_from_now.sql'), 'utf8');
    const stmt = sql.split('\n').filter((l) => !l.startsWith('--')).join(' ');
    expect(stmt).toMatch(/update public\.agent_quote_twin_specs\s+set rules = jsonb_set\(rules, '\{take,from\}', '"2026-10-04T16:00:00Z"'::jsonb\)\s+where id = 'take50' and rules->'take'->>'from' = '2026-10-05T00:00:00Z';/);
    expect(Date.parse('2026-10-04T16:00:00Z')).toBeGreaterThan(Date.parse(ROW.backfill.until));
  });
});

