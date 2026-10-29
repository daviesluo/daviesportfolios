// "Stablecoin quotes USDC/GBP LIVE twin" (0180; docs/agents/reviews/2026-10-29-rx-usdc-live-prereg.md): the row the
// pre-registration shows is the migration's, it carries the USDC/GBP executor's rules, the files it froze are those files by
// sha256, and its bar is as written; and the executor's deviation names the executor as it is.
import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p));
const sha = (p) => crypto.createHash('sha256').update(read(p)).digest('hex');
const M = '0180_quotes_rx_usdc_live.sql';
const sqlOf = (f) => read(`supabase/migrations/${f}`).toString('utf8').replace(/--[^\n]*/g, '');
const rowsOf = (f) => JSON.parse(/null::public\.agent_quote_twin_specs, \$json\$(\[[\s\S]*?\])\$json\$/.exec(sqlOf(f))?.[1] ?? '[]');
const DOC = read('docs/agents/reviews/2026-10-29-rx-usdc-live-prereg.md').toString('utf8');
const DEV = read('docs/agents/reviews/2026-10-29-rx-usdc-live-deviation.md').toString('utf8');
const namedIn = (doc, f) => [...doc.matchAll(new RegExp('\\| `' + f.replace(/[.]/g, '\\.') + '` \\| ([0-9a-f]{64}) \\|', 'g'))].map((m) => m[1]);
const S = '2026-10-30T00:00:00Z';

describe("the USDC/GBP LIVE twin's pre-registration", () => {
  it('shows the row 0180 inserts, frozen: the USDC/GBP executor\'s rules at £120 from 2026-10-30 00:00', () => {
    const rows = rowsOf(M);
    const shown = [...DOC.matchAll(/```json\n(\{[^\n]*\})\n```/g)].map((m) => JSON.parse(m[1]));
    expect(shown).toEqual(rows);
    expect(DOC).toContain('**Status: FROZEN**');
    const [r] = rows;
    expect([rows.length, r.id, r.display_name, r.display_order, r.capital_gbp, r.start, r.hidden, r.migration]).toEqual([1, 'rxu120', 'Stablecoin quotes USDC/GBP LIVE twin', 13, 120, S, false, '0180']);
    expect(r.rules).toEqual({
      fill: { model: 'at', from: S }, weekend: { from: S }, holdMin: { from: S, gbp: 1 },
      weights: { from: S, book: { 'USDC-GBP': 1, 'USDT-GBP': 0 }, k: { '0.001': 1, '0.002': 1, '0.003': 0 } }, exitOffset: { from: S, ticks: 1 },
    });
  });

  it("makes the executor's tables unarmed and dry-run, its lock, its twin's tables; touches no live config, call or cron job", () => {
    const sql = sqlOf(M);
    for (const t of ['config', 'orders', 'events', 'state']) {
      expect(sql).toContain(`create table if not exists public.agent_quote_rxu_${t}`);
      expect(sql).toMatch(new RegExp(`alter table public\\.agent_quote_rxu_${t}\\s+enable row level security;`));
    }
    expect(sql).toContain('insert into public.agent_quote_rxu_config (id, dry_run, live_confirmed_at, capital_gbp) values (1, true, null, 120) on conflict (id) do nothing;');
    expect(sql).toContain("insert into public.agent_locks (name) values ('quotes-live-rxu') on conflict (name) do nothing;");
    expect(sql).toContain("select public.create_quote_twin_tables('rxu120');");
    expect(/agent_quote_live_config|edge_calls|cron\.|\bgrant\b|create policy/i.test(sql)).toBe(false);
  });

  it('names the sha256 of each file it froze, once, and each file is that one', () => {
    for (const f of [
      `supabase/migrations/${M}`, 'supabase/functions/agents/quotes_twin.ts', 'supabase/functions/agents/quotes_live.ts',
      'supabase/functions/agents/revx_sim.ts', 'supabase/functions/agents/quotes_weekend.ts',
    ]) expect(namedIn(DOC, f), f).toEqual([sha(f)]);
  });

  it('holds its bar as written', () => {
    for (const w of ['**The bar (the live executor\'s, not the twin\'s): the share is 80 % or more.**', '2026-10-30 00:00 → 2026-11-27 00:00', '36.3 % a year since 09-01']) expect(DOC).toContain(w);
  });
});

describe("the USDC/GBP executor's deviation (0180)", () => {
  it('names the executor as it is under every pre-registration that froze it, and the frozen file is unchanged', () => {
    const live = 'supabase/functions/agents/quotes_live.ts';
    expect(namedIn(DEV, live)).toEqual([sha(live), sha(live), sha(live)]);
    expect(sha('supabase/functions/agents/quotes_live_frozen.ts')).toBe('60d3f33f2bb8d328fe14693d570396afdffcc2cae9b75e05e2d4eed5ea459a52');
  });
});
