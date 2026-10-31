// The compounding's unit a pound a rung from 2026-11-01 (Davies, 2026-10-31: "c也改"), recorded apart from the twins'
// pre-registrations: the deviation quotes him, names every one it touches with each twin's old and new unit, and names the file
// that carries the rule as it is; 0189 stores the same values the code derives.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, p))).digest('hex');
const DEV = 'docs/agents/reviews/2026-10-31-compound-unit-deviation.md';

describe('the compounding unit deviation of 2026-10-31', () => {
  it('quotes Davies, names each pre-registration it touches and the rule file as it is', () => {
    const d = read(DEV);
    expect(d).toContain('"a和b都改； c也改"');
    expect(d).toContain('"live复利不仅是usdt吧，另外两个呢？"');
    for (const p of ['2026-10-26-live-size-twins-prereg.md', '2026-10-27-live-next-size-prereg.md', '2026-10-03-take-prereg.md',
      '2026-10-27-pr5-opt-twins-now-prereg.md', '2026-10-29-usdt-only-twins-prereg.md', '2026-10-29-rx-usdc-live-prereg.md']) {
      expect(d, p).toContain(`### \`docs/agents/reviews/${p}\``);
      expect(fs.existsSync(path.join(ROOT, 'docs/agents/reviews', p)), p).toBe(true);
    }
    expect(d).toContain(sha('supabase/functions/agents/quotes_compound.ts'));
  });

  it('0189 stores what the code derives: LIVE\'s step £6, live600/live1200/take50 £6, n600no03 £4, the rest unchanged', () => {
    const m = read('supabase/migrations/0189_compound_unit_a_rung.sql');
    expect(m).toContain("update public.agent_quote_live_config set compound_step_gbp = 6 where id = 1 and compound_step_gbp = 12;");
    expect(m).toContain("update public.agent_quote_twin_compound set unit_gbp = 6, step_gbp = 6 where twin_id in ('live600', 'live1200', 'take50');");
    expect(m).toContain("update public.agent_quote_twin_compound set unit_gbp = 4, step_gbp = 4 where twin_id = 'n600no03';");
    expect(read('supabase/functions/agents/quotes_compound.ts')).toContain('export const COMPOUND_UNIT_RUNGS_FROM = Date.parse("2026-11-01T00:00:00Z");');
  });
});
