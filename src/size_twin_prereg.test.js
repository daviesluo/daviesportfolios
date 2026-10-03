// p50's pre-registration ("Stablecoin quotes variant-1", docs/agents/reviews/2026-10-03-pr5-size-twin-prereg.md) freezes
// the twins' driver, the simulated account, the migration that makes p50 a row, its backfill with its builder and inputs,
// and the size study's results its expectation is quoted from, by sha256. A frozen file edited without an addendum, a
// backfill that is not the bytes its row pins or not the study's s50 run, an expectation that is not the study's, or a
// migration that makes p50's tables other than by 0087's statement (or grants anyone anything) fails here.
import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p));
const sha = (p) => crypto.createHash('sha256').update(read(p)).digest('hex');
const DOC = read('docs/agents/reviews/2026-10-03-pr5-size-twin-prereg.md').toString('utf8');
const MANIFEST = JSON.parse(read('docs/agents/backtests/twins/MANIFEST.json').toString('utf8'));
const S50 = JSON.parse(read('docs/agents/backtests/twins/size/results.json').toString('utf8')).s50;
const FROZEN = [
  'supabase/functions/agents/quotes_twin.ts', 'supabase/functions/agents/revx_sim.ts', 'supabase/migrations/0088_quote_twin_specs.sql',
  'docs/agents/backtests/twins/p50.json.gz', 'docs/agents/backtests/twins/scripts/backfill.ts', 'docs/agents/backtests/twins/scripts/spec_rows.ts',
  'docs/agents/backtests/twins/inputs/twins_inputs.json.gz', 'docs/agents/backtests/twins/size/results.json',
];
const named = (f) => [...DOC.matchAll(new RegExp('\\| `' + f.replace(/[.]/g, '\\.') + '` \\| ([0-9a-f]{64}) \\|', 'g'))].map((m) => m[1]);
/** A migration's SQL without its comments. */
const sqlOf = (f) => read(`supabase/migrations/${f}`).toString('utf8').replace(/--[^\n]*/g, '');
const SQL = sqlOf('0088_quote_twin_specs.sql');
const ROW = JSON.parse(/null::public\.agent_quote_twin_specs, \$json\$(\[[\s\S]*?\])\$json\$/.exec(SQL)?.[1] ?? '[]').find((r) => r.id === 'p50');

describe("p50's pre-registration", () => {
  it('names the sha256 of each file it froze, once, and each file is that one, as its deviation 1 left it', () => {
    // Deviation 1 (2026-10-03, its §7): the driver and the simulated account gain TAKE's rule (0089). §5 keeps the hashes
    // they were frozen at; §7 names them as they are. Every other frozen file is named once, as frozen.
    const before = {
      'supabase/functions/agents/quotes_twin.ts': 'f14ecee87da252b9135dbeebcdcfd1dfa3f33c4a945c7b5b830cc2c37a61d7a8',
      'supabase/functions/agents/revx_sim.ts': '885def181e01899095745c7c1128a3dee06e11f960965ec439cc7a50642fcd48',
    };
    for (const f of FROZEN) expect(named(f), f).toEqual(before[f] ? [before[f], sha(f)] : [sha(f)]);
  });

  it('is a row of 0088: PR5\'s rule and start at £600, its own tables and lease, its backfill those bytes to their end', () => {
    const file = 'docs/agents/backtests/twins/p50.json.gz';
    expect(ROW).toEqual({
      id: 'p50', display_name: 'Stablecoin quotes variant-1', display_order: 20, engine: 'pr5', capital_gbp: 600, gov: 'account', start: '2026-09-23T15:09:00Z',
      table_prefix: 'agent_quote_twin_p50', lease: 'quotes-twin-p50', rules: null, backfill: { file, sha256: sha(file), until: '2026-10-02T21:05:00.000Z' },
      prereg: 'docs/agents/reviews/2026-10-03-pr5-size-twin-prereg.md', migration: '0088', enabled: true,
    });
    expect(MANIFEST.committed['p50.json.gz']).toEqual({ bytes: read(file).length, sha256: sha(file) });
    for (const f of ['scripts/backfill.ts', 'scripts/spec_rows.ts']) {
      expect(MANIFEST.committed[f], f).toEqual({ bytes: read(`docs/agents/backtests/twins/${f}`).length, sha256: sha(`docs/agents/backtests/twins/${f}`) });
    }
    const data = JSON.parse(zlib.gunzipSync(read(file)).toString('utf8'));
    expect([data.v, data.twin, data.until, data.orders.some((o) => 'id' in o), Number(data.config.capital_gbp)]).toEqual([1, 'p50', '2026-10-02T21:05:00.000Z', false, 600]);
  });

  it("is the size study's s50 run: its turns, orders written and sent, conversions and balances, and the expectation it quotes", () => {
    const data = JSON.parse(zlib.gunzipSync(read('docs/agents/backtests/twins/p50.json.gz')).toString('utf8'));
    const live = data.orders.filter((o) => o.mode === 'live');
    const sent = live.filter((o) => o.response?.wouldBeRefused !== true && o.state !== 'rejected').length;
    const conversions = live.filter((o) => o.leg === 'convert' && Number(o.filled_base) > 0)
      .map((o) => ({ at: o.ts, book: o.book, coins: +Number(o.filled_base).toFixed(4), price: o.avg_fill_price }));
    expect([data.sim.state.turns, live.length, sent]).toEqual([S50.summary.turns, S50.summary.ordersRows, S50.summary.sent]);
    expect(conversions).toEqual(S50.summary.conversions);
    expect(data.sim.state.venue.balances).toEqual(S50.summary.balances);
    // Its replica is PR5's twin's: the same 46 differences, all before 2026-09-24 18:13.
    expect([data.sim.state.paperCheck.events, data.sim.state.paperCheck.mismatches]).toEqual([3751, 46]);
    // The expectation the document states is the study's own figures for that run (its prose read with its line breaks as
    // spaces; its table rows as they are).
    const s = S50.summary;
    const prose = DOC.replace(/\s+/g, ' ');
    expect([s.capitalGbp, s.trips, s.won, s.realised, s.bpsPerTrip, s.annualPct]).toEqual([600, 57, 53, 3.904, 14.61, 25.68]);
    expect(prose).toContain(`**${s.trips} round trips, ${s.won} won, realised +£${s.realised.toFixed(4)}**, ${s.bpsPerTrip} bps a trip, +£${s.perDay.toFixed(4)} a day, ${s.annualPct} % a year`);
    for (const r of S50.rungs) {
      const [book, side, k] = r.rung.split(' ');
      const cell = r.trips ? `${r.trips} · ${r.won} · ${r.realised < 0 ? '−' : '+'}£${Math.abs(r.realised).toFixed(4)}` : '0';
      expect(DOC, r.rung).toContain(`| ${book} ${side} ${k.replace('%', ' %')} | ${cell}`);
    }
  });

  it("0088 makes p50's tables with 0087's own statement, row level security on everywhere, and no grant or policy for anyone", () => {
    const template = (sql) => /execute format\(\$f\$([\s\S]*?)\$f\$, /.exec(sql)?.[1] ?? '';
    expect(template(SQL)).toBe(template(sqlOf('0087_quote_twins.sql')));
    expect(template(SQL).match(/enable row level security/g)?.length).toBe(6);
    expect(SQL).toContain('alter table public.agent_quote_twin_specs enable row level security;');
    expect(SQL).toContain("set search_path = ''");
    expect(SQL).toContain("select public.create_quote_twin_tables('p50');");
    expect(SQL).not.toMatch(/\b(grant|revoke|policy|anon|authenticated|edge_calls|cron\.|net\.http|security definer)/i);
  });
});
