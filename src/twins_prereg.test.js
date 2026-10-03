// The realistic twins' pre-registration (docs/agents/reviews/2026-10-02-pr5-realistic-twins-prereg.md) freezes the
// simulated account, the twins' driver and their migration by sha256, and names the backfills the production call loads
// and the inputs they were computed from. A frozen file edited without an addendum, a backfill that is not the bytes the
// code pins, or a pin that is not the document's fails here.
import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p));
const sha = (p) => crypto.createHash('sha256').update(read(p)).digest('hex');
const DOC = read('docs/agents/reviews/2026-10-02-pr5-realistic-twins-prereg.md').toString('utf8');
const DRIVER = read('supabase/functions/agents/quotes_twin.ts').toString('utf8');
const MANIFEST = JSON.parse(read('docs/agents/backtests/twins/MANIFEST.json').toString('utf8'));

describe("the realistic twins' pre-registration", () => {
  it('names the sha256 of each file it froze, and each file is that one, quotes_twin.ts as its deviation 1 left it', () => {
    for (const f of ['supabase/functions/agents/revx_sim.ts', 'supabase/functions/agents/quotes_twin.ts', 'supabase/migrations/0087_quote_twins.sql']) {
      const named = [...DOC.matchAll(new RegExp('\\| `' + f.replace(/[.]/g, '\\.') + '` \\| ([0-9a-f]{64}) \\|', 'g'))].map((m) => m[1]);
      // Deviation 1 (2026-10-03, its §12): quotes_twin.ts reads its twins from their rows (0088). §11 keeps the hash it was frozen at,
      // 921ce33a…; §12 names the file from then on. Every other frozen file is named once, as frozen.
      if (f.endsWith('/quotes_twin.ts')) expect(named, f).toEqual(['921ce33adc6d38274bd9c8de7909a2100ff55fdb2d50388e140379af2c578fc3', sha(f)]);
      else expect(named, f).toEqual([sha(f)]);
    }
  });

  it("names the live executor's frozen copy, and the copy is that file", () => {
    expect(DOC).toContain('`quotes_live_frozen.ts` (sha256 60d3f33f2bb8d328fe14693d570396afdffcc2cae9b75e05e2d4eed5ea459a52');
    expect(sha('supabase/functions/agents/quotes_live_frozen.ts')).toBe('60d3f33f2bb8d328fe14693d570396afdffcc2cae9b75e05e2d4eed5ea459a52');
  });

  it('pins in the code and the spec rows the backfills the document names, and each committed file is those bytes, to its end', () => {
    // Since deviation 1 a twin's backfill is its spec row's (`agent_quote_twin_specs`, 0088), and the code's seed rows
    // carry the same (src/twin_specs.test.js holds the two equal).
    const seed = JSON.parse(/\/\* spec rows \*\/ (\[[\s\S]*?\]) \/\* end spec rows \*\//.exec(DRIVER)?.[1] ?? '[]');
    const sql = read('supabase/migrations/0088_quote_twin_specs.sql').toString('utf8').replace(/--[^\n]*/g, '');
    const rows = JSON.parse(/null::public\.agent_quote_twin_specs, \$json\$(\[[\s\S]*?\])\$json\$/.exec(sql)?.[1] ?? '[]');
    for (const id of ['pr5', 'd']) {
      const file = `docs/agents/backtests/twins/${id}.json.gz`;
      const inDoc = new RegExp('\\| `' + id + '` \\|[^\\n]*\\| `' + id + '\\.json\\.gz` \\| ([0-9a-f]{64}) \\|').exec(DOC)?.[1];
      const inCode = seed.find((r) => r.id === id)?.backfill, inRow = rows.find((r) => r.id === id)?.backfill;
      expect(inDoc, id).toMatch(/^[0-9a-f]{64}$/);
      expect(inCode, id).toEqual({ file, sha256: inDoc, until: '2026-10-02T21:05:00.000Z' });
      expect(inRow, id).toEqual(inCode);
      expect(sha(file), id).toBe(inDoc);
      expect(MANIFEST.committed[`${id}.json.gz`].sha256).toBe(inDoc);
      const data = JSON.parse(zlib.gunzipSync(read(file)).toString('utf8'));
      expect([data.v, data.twin, data.until, data.orders.some((o) => 'id' in o)], id).toEqual([1, id, '2026-10-02T21:05:00.000Z', false]);
    }
  });

  it('names the inputs the backfills were computed from, and the inputs are that file', () => {
    const named = /Inputs: `twins_inputs\.json\.gz`, sha256 ([0-9a-f]{64})/.exec(DOC)?.[1];
    expect(named).toMatch(/^[0-9a-f]{64}$/);
    expect(sha('docs/agents/backtests/twins/inputs/twins_inputs.json.gz')).toBe(named);
    expect(MANIFEST.committed['inputs/twins_inputs.json.gz'].sha256).toBe(named);
    expect(MANIFEST.committed['scripts/backfill.ts'].sha256).toBe(sha('docs/agents/backtests/twins/scripts/backfill.ts'));
  });
});
