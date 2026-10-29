// CXBOT ("Crypto analyst", the audit docs/agents/reviews/2026-10-29-crypto-grok-bot-audit.md, migration 0163): the tables the
// code writes are the migration's, column for column; every table is locked to the service role; the mode can only be
// dry-run or paper; the function's source knows no private endpoint and reads no secret but its bearer and the scheduler's;
// and the prompt Grok is given prints the examples the Edge tests prove valid, the limits the code enforces and every rule it
// can refuse by. The Edge tests run without file access to the migration, so this is where the code's copies are held to
// the files.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const SQL_NC = read('supabase/migrations/0163_cxbot.sql').replace(/--[^\n]*/g, '');
const SCHEMA = read('supabase/functions/cxbot/schema.ts');
const RULES = read('supabase/functions/cxbot/rules.ts');
const PROMPT = read('docs/agents/cxbot/GROK_PROMPT.md');
const EXAMPLES = JSON.parse(read('docs/agents/cxbot/examples.json'));
const DIR = 'supabase/functions/cxbot';
const stripComments = (s) => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

function tablesOf(sql) {
  const out = {};
  for (const m of sql.matchAll(/create table if not exists public\.(\w+) \(([\s\S]*?)\n\);/g)) {
    out[m[1]] = m[2].split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('constraint') && !l.startsWith('primary key')).map((l) => l.split(/\s+/)[0]);
  }
  return out;
}
function schemaOf(src) {
  const out = {};
  for (const m of src.matchAll(/(cxbot_\w+): \{\s*key: "([\w,]+)",\s*columns: \[([\s\S]*?)\]/g)) out[m[1]] = [...m[3].matchAll(/"(\w+)"/g)].map((x) => x[1]);
  return out;
}

describe('CXBOT, the paper path', () => {
  it("writes only the migration's columns: schema.ts lists every table of 0163 with exactly its columns", () => {
    const t = tablesOf(SQL_NC), s = schemaOf(SCHEMA);
    expect(Object.keys(t).sort()).toEqual(Object.keys(s).sort());
    expect(Object.keys(t).length).toBe(14);
    for (const k of Object.keys(t)) expect([k, t[k]]).toEqual([k, s[k]]);
  });

  it('locks every table to the service role: row level security on, no grant and no policy', () => {
    for (const k of Object.keys(tablesOf(SQL_NC))) expect(SQL_NC).toMatch(new RegExp(`alter table public\\.${k} +enable row level security;`));
    expect(SQL_NC).not.toMatch(/\bgrant\b|create policy/i);
  });

  it('can only be dry-run or paper, starts in dry-run, and ties paper to a start; one call a minute', () => {
    expect(SQL_NC).toContain("mode            text not null default 'dry_run' check (mode in ('dry_run', 'paper'))");
    expect(SQL_NC).toContain("constraint cxbot_config_started_check check (mode <> 'paper' or started_at is not null)");
    expect(SQL_NC).toContain("venue           text not null default 'hyperliquid' check (venue in ('hyperliquid', 'binance', 'okx'))");
    expect(SQL_NC.match(/insert into public\.edge_calls/g)).toHaveLength(1);
    expect(SQL_NC).toContain("('cxbot?action=tick', 50000, 1, 23, true)");
  });

  it('knows no private endpoint and reads no secret but its bearer and the scheduler\'s', () => {
    const src = fs.readdirSync(path.join(ROOT, DIR)).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts')).map((f) => stripComments(read(`${DIR}/${f}`))).join('\n');
    const env = [...src.matchAll(/Deno\.env\.get\("(\w+)"\)/g)].map((m) => m[1]);
    expect([...new Set(env)].sort()).toEqual(['CRON_SECRET', 'CXBOT_TOKEN', 'SB_REGION', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_URL']);
    for (const bad of ['/exchange', '/fapi/v1/order', '/v5/order', '/api/v5/trade', 'private', 'signature', 'X-MBX-APIKEY', 'OK-ACCESS-KEY']) expect(src, bad).not.toContain(bad);
    const yml = read('.github/workflows/edge-functions.yml');
    expect(/PUBLIC_FNS="([^"]*)"/.exec(yml)?.[1].split(' ')).toContain('cxbot');
  });

  it('prints in the prompt exactly the examples the Edge tests prove valid', () => {
    const blocks = Object.fromEntries([...PROMPT.matchAll(/<!-- example:(\w+) -->\n```json\n([\s\S]*?)\n```/g)].map((m) => [m[1], JSON.parse(m[2])]));
    expect(Object.keys(blocks).sort()).toEqual(Object.keys(EXAMPLES).sort());
    for (const k of Object.keys(EXAMPLES)) expect([k, blocks[k]]).toEqual([k, EXAMPLES[k]]);
  });

  it('states in the prompt the limits the code enforces', () => {
    const pins = [
      ['riskPerTradeFrac: 0.01', 'at most $10 (1 % of the $1,000 budget)'], ['maxTotalRiskFrac: 0.03', 'at most $30'], ['maxDirectionRiskFrac: 0.02', 'in one direction at most $20'],
      ['maxOpen: 3', 'at most 3 positions and resting orders'], ['maxGrossMult: 2, maxNetMult: 1', 'gross at most $2,000, net (longs less shorts) at most $1,000'],
      ['minRewardRisk: 1.5', 'at least 1.5 × the stop'], ['edgeMin: 0.08', 'p\\* + 0.08'], ['kellyFraction: 0.25', '¼ Kelly'],
      ['stopMinSd: 0.75, stopMaxSd: 5, stopMinFrac: 0.01', '0.75–5 × the coin\'s one-day volatility away (`sd24` in `markets`), and at least 1 %'],
      ['maxLeverage: 3, liqStopMult: 2.5', 'at most 3×, low enough that liquidation lies 2.5 stop distances beyond your stop'],
      ['maxFundingPerHour: 0.0001', 'more than 0.01 %/h now or predicted'], ['blackoutLeadMs: 10 * M, blackoutTrailMs: 5 * M', 'from 10 minutes before to 5 minutes after'],
      ['maxTapeAgeMs: 2 * M', 'at most 2 minutes old'], ['maxSpreadBps: { BTC: 5, ETH: 5, SOL: 10 }', 'at most 5 bps (BTC, ETH) or 10 bps (SOL)'],
      ['maxSlippageFrac: 0.1', 'by at most a tenth of the stop distance'], ['minWorkingMs: 5 * M, maxWorkingMs: 24 * H', '5 minutes to 24 hours'],
      ['maxHoldMs: 7 * DAY', 'held 7 days'], ['maxOrdersPerMinute: 3, maxOrdersDay: 30', '30 orders a UTC day; 3 trading requests a minute'],
      ['stopSlippage: 0.0005', 'the stop less 5 bps'], ['maxMarginFrac: 0.5', 'margin in use at most half the equity'],
      ['everyHours: 4, answerMs: 20 * M, stopSd: 1, limitSd: 2, minStopFrac: 0.01, holdMs: 72 * H', 'within 20\n  minutes'],
      ['pmHorizonsH: [24, 8, 2]', '24 h, 8 h and 2 h before'], ['pmAnswerMs: 15 * M', 'answer within 15 minutes'],
    ];
    for (const [code, words] of pins) {
      expect(RULES, code).toContain(code);
      expect(PROMPT, words).toContain(words);
    }
    expect(PROMPT).toContain('−$20 today');
    expect(PROMPT).toContain('−$100 from the start');
    expect(RULES).toContain('export const CXBOT_CALENDAR_UNTIL_MS = Date.parse("2027-01-01T00:00:00Z");');
    expect(PROMPT).toContain('the release list ends 2026-12-31');
  });

  it('names in the prompt every rule the server can refuse by', () => {
    const src = stripComments(RULES + read(`${DIR}/engine.ts`) + read(`${DIR}/index.ts`));
    const named = new Set([...src.matchAll(/(?:rule: |no\()"(\w+)"/g), ...src.matchAll(/\? "(pending)" : "(one_per_coin)"/g)].flatMap((m) => m.slice(1).filter(Boolean)));
    expect(named.size).toBeGreaterThan(30);
    for (const r of named) expect(PROMPT, r).toContain('`' + r + '`');
  });

  it('carries the desk ledger, the wake schedule, the scoring of a timeout and the session rule', () => {
    for (const words of [
      '`CXBOT_LEDGER.md` on the branch **`cxbot-ledger`**', 'Keep it under 10 KB (10,240 bytes)', 'about 23:27 UK time',
      'where the price then stands between the stop (0) and the limit (1)', 'Never log in to, or use, any exchange account, API key, wallet or session the server or its recorder uses',
      '00:00, 04:00, 08:00, 12:00, 16:00, 20:00', 'T−60, T−20, T+5, T+15, T+60', 'every 30 minutes while you hold',
    ]) expect(PROMPT, words).toContain(words);
    const seed = read('docs/agents/cxbot/ledger_seed.md');
    expect(Buffer.byteLength(seed)).toBeLessThan(10240);
    expect(seed).toContain('cxbot-ledger');
  });
});
