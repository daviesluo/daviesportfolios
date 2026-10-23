// GROKPM ("Polymarket analyst", docs/agents/reviews/2026-10-15-grokpm-prereg.md, migration 0124): the frozen
// pre-registration is the file it was, its cadence study is the files its manifest names, the journal contract it prints is
// the one the endpoint enforces (its examples are the Edge tests' own, its limits the code's), and the tables the code
// writes are the migration's, column for column. The Edge tests run without file access, so this is where the code's
// copies are held to the files.
import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, p))).digest('hex');
const PREREG_PATH = 'docs/agents/reviews/2026-10-15-grokpm-prereg.md';
const PREREG = read(PREREG_PATH);
const SQL = read('supabase/migrations/0124_grokpm.sql');
const SQL2 = read('supabase/migrations/0125_grokpm_exec.sql');
const SQL3 = read('supabase/migrations/0126_grokpm_markets.sql');
const SQL4 = read('supabase/migrations/0128_grokpm_redeem.sql');
const SQL5 = read('supabase/migrations/0138_grokpm_shadow_marks.sql');
const INGEST = read('supabase/functions/grokpm/ingest.ts');
const SCHEMA = read('supabase/functions/_shared/grokpm_schema.ts');

describe('GROKPM pre-registration', () => {
  // Frozen 2026-10-15; the sha256 of the whole file since Deviation D10 (2026-10-23: D7's reading adds the last trade
  // beside m), which added §9's D10 only. Before it, Deviation D9 (2026-10-22: D7's sample, from C-003's start without
  // the 17:05 UTC wake; sha256 c5c663f31b54fdd24d2300227f38ccf73796ba9a3c4766dad6f3b7afd89ccb09), which added §9's D9
  // only. Before it, Deviation D8 (2026-10-20: cumulative Kelly within a
  // market; sha256 0cfc80c886e615d4ac081540c6d1952135b04396de2fc813b4e90a8e6f295528), which added §9's D8 only. Before it, Deviation D7 (2026-10-20: shadow forecasts, a reading added; sha256
  // 4db2b03a3fe4e35429d5f7624835e521e90f0c5bdeebef8096a44b273c38e3de), which added §9's D7 only. Before it, Deviation
  // D6 (2026-10-17: the shared account's automatic redemption, operational),
  // which added §9's D6 only. D5 (150 orders a day, the end closed by the main session) added §9's D5 and named 150 beside
  // §9 D2's 50 and in the refusal table's `orders_day`. D4 (the pre-go audit)
  // added §9's D4 only. D3
  // (2026-10-16) added §9's D3 and three rows to A.2's refusal table; D2 before it added §9's D2 and Appendix A.2 and
  // moved the hourly request cap from 120 to 600.
  it('is frozen: its sha256', () => {
    expect(sha(PREREG_PATH)).toBe('a83d12d8907b2e1b1cabff9461ecc18538b1a1f40e15dea1ff6aa748ca20bcb2');
  });

  it("has its cadence study's files as its manifest names them, and quotes the study's own numbers", () => {
    const m = JSON.parse(read('docs/agents/backtests/grokpm/MANIFEST.json'));
    expect(Object.keys(m.sha256).length).toBe(10);
    for (const [p, h] of Object.entries(m.sha256)) expect([p, sha(`docs/agents/backtests/grokpm/${p}`)]).toEqual([p, h]);
    const out = read('docs/agents/backtests/grokpm/results/cadence.txt');
    // The headline: low attention, 30 against 60 minutes, and B's four hours.
    expect(out).toContain('checker every  30 min: catches  76.6 % of approaches');
    expect(out).toContain('checker every  60 min: catches  67.0 % of approaches');
    expect(out).toContain('240 min 8.0 %');
    expect(PREREG).toContain('| **low attention** | **94** | **11 / 62 / 886** | **10 %** | **85.5 %** | **76.6 %** | **67.0 %** | **54.7 %** | **45.0 %** |');
    expect(PREREG).toContain('| **low attention** | **1.5 %** | **2.7 %** | **4.6 %** | **8.0 %** | **14.0 %** | **29.0 %** | **84 %** | **76 %** | **65 %** |');
  });

  it("prints the endpoint's own examples and limits", () => {
    const examples = JSON.parse(read('docs/agents/backtests/grokpm/contract_examples.json'));
    for (const k of ['decision', 'cycle', 'daily', 'order', 'close']) {
      const m = new RegExp('<!-- example:' + k + ' -->\\s*```json\\n([\\s\\S]*?)\\n```').exec(PREREG);
      expect(m, k).toBeTruthy();
      expect(JSON.parse(m?.[1] ?? 'null')).toEqual(examples[k]);
    }
    const num = (name) => Number(new RegExp(`^export const ${name} = ([\\d_]+);`, 'm').exec(INGEST)?.[1].replace(/_/g, ''));
    expect([num('GROKPM_MAX_BODY_BYTES'), num('GROKPM_MAX_ROWS_PER_REQUEST'), num('GROKPM_MAX_ROWS_PER_HOUR'), num('GROKPM_MAX_REQUESTS_PER_HOUR'), num('GROKPM_MIN_SECRET_CHARS')])
      .toEqual([65536, 50, 200, 600, 32]);
    expect(PREREG).toContain('at most **50 rows** a request and **64 KiB**');
    expect(PREREG).toContain('**Limits:** 200 rows stored and 600 requests (refused ones included) in any rolling hour (120 before D2).');
    expect(PREREG).toContain('`https://flmvxigozjuizpckllvk.supabase.co/functions/v1/grokpm`');
    // The rules the brief froze, as the prompt will carry them.
    for (const rule of ['**at least 8 points**', '**at least 12 points**', '**0.90 or above**', 'under **0.05**', 'more than **30 days**', 'At most **$10 per market**', '**1/4 Kelly**',
      'At most **6 open positions**', 'at most **$25 per theme**', 'at least **$30 cash**', '**Daily loss limit −$10**', '**Total stop −$30**', '**`country` "IE"**']) {
      expect(PREREG.replace(/\s+/g, ' '), rule).toContain(rule);
    }
    expect(PREREG).toContain('**Continue only if BOTH: total P&L > 0 AND Brier_agent < Brier_market**');
  });

  it("holds the code's table list to the three migrations, column for column, and their tables to no grant or policy", () => {
    const creates = (sql) => [...sql.matchAll(/create table if not exists public\.(\w+) \(([\s\S]*?)\n\);/g)].map((m) => ({
      name: m[1],
      columns: m[2].split('\n').map((l) => l.trim()).filter((l) => /^[a-z_]+ /.test(l) && !/^(check|primary|unique|constraint)\b/.test(l)).map((l) => l.split(/\s+/)[0]),
      key: (() => {
        const lines = m[2].split('\n').map((l) => l.trim());
        const own = lines.find((l) => /^[a-z_]+ .*\bprimary key\b/.test(l))?.split(/\s+/)[0];
        return own ?? /^primary key \(([^)]*)\)/m.exec(lines.join('\n'))?.[1].replace(/\s+/g, '');
      })(),
    }));
    const tables = [...creates(SQL), ...creates(SQL2), ...creates(SQL3), ...creates(SQL4), ...creates(SQL5)];
    // 0125's added columns, in its order, after 0124's; then 0128's (D6: the redemption switch and its state).
    for (const m of (SQL2 + SQL4).matchAll(/alter table public\.(\w+) add column if not exists (\w+) /g)) {
      const t = tables.find((x) => x.name === m[1]);
      if (!t) throw new Error(`a migration adds a column to ${m[1]}, which none creates`);
      t.columns.push(m[2]);
    }
    expect(tables.map((t) => t.name)).toEqual(['grokpm_config', 'grokpm_decisions', 'grokpm_cycles', 'grokpm_daily', 'grokpm_requests', 'grokpm_snapshots', 'grokpm_activity',
      'grokpm_entries', 'grokpm_resolutions', 'grokpm_rec_state', 'grokpm_orders', 'grokpm_fills', 'grokpm_exec_state', 'grokpm_markets', 'grokpm_redeems',
      'grokpm_shadow_marks']);
    // The code's list has no table the migrations do not create.
    expect([...SCHEMA.matchAll(/^ {2}(grokpm_\w+): \{/gm)].map((m) => m[1]).sort()).toEqual(tables.map((t) => t.name).sort());
    for (const t of tables) {
      const block = new RegExp(`  ${t.name}: \\{([\\s\\S]*?)\\},\\n`).exec(SCHEMA)?.[1] ?? '';
      const cols = JSON.parse((/columns: (\[[^\]]*\])/.exec(block)?.[1] ?? 'null').replace(/,\s*\]/, ']'));
      const key = /key: "([\w,]+)"/.exec(block)?.[1];
      expect([t.name, cols, key]).toEqual([t.name, t.columns, t.key]);
      expect(SQL + SQL2 + SQL3 + SQL4 + SQL5).toMatch(new RegExp(`alter table public\\.${t.name} +enable row level security;`));
    }
    expect((SQL + SQL2 + SQL3 + SQL4 + SQL5).replace(/--[^\n]*/g, '')).not.toMatch(/\bgrant\b|create policy/i);
    // 0138 (the optimisation review's F2): the shadow forecasts' last trades, a row a decision, a price only when one was found.
    expect(SQL5).toContain("decision_id  text primary key references public.grokpm_decisions (id),");
    expect(SQL5).toContain("check ((status = 'found') = (price is not null and trade_at is not null))");
    // 0128 (D6): redemption off by default; its go step is a comment, never a statement.
    expect(SQL4).toContain('add column if not exists redeem_enabled boolean not null default false;');
    expect(SQL4).toContain('--   update public.grokpm_config set redeem_enabled = true where id = 1 and redeem_enabled = false returning redeem_enabled;');
    expect(SQL4.replace(/--[^\n]*/g, '')).not.toMatch(/redeem_enabled = true/);
    // The wallet starts null and FUNDED at $100; the stops are the brief's.
    expect(SQL).toContain('wallet           text check (wallet ~ \'^0x[0-9a-f]{40}$\')');
    expect(SQL).toContain('funded_usd       numeric not null default 100');
    expect(SQL).toContain('daily_loss_usd   numeric not null default 10');
    expect(SQL).toContain('total_stop_usd   numeric not null default 30');
    expect(SQL).toContain("insert into public.grokpm_config (id) values (1) on conflict (id) do nothing;");
    // 0125: disarmed by default; a BUY never takes; GROKPM joins the one-armed rule; live-prep disarmed only with nothing to sell.
    expect(SQL2).toContain('add column if not exists dry_run boolean not null default true;');
    expect(SQL2).toContain("check (post_only or (side = 'SELL' and category = 'C'))");
    expect(SQL2).toContain("select 'grokpm_config'::text from public.grokpm_config g where g.armed_at is not null");
    expect(SQL2).toMatch(/create trigger grokpm_config_one_armed\s+after insert or update on public\.grokpm_config\s+for each row when \(new\.armed_at is not null\)/);
    expect(SQL2.replace(/--[^\n]*/g, '')).toMatch(/update public\.pm_lp_config c\s+set live_confirmed_at = null[\s\S]*< 5;/);
    // The go statement is in the header, as a comment, and nowhere as a statement.
    expect(SQL2).toContain('--   update public.grokpm_config set dry_run = false, armed_at = now(), started_at = now()');
    expect(SQL2.replace(/--[^\n]*/g, '')).not.toMatch(/armed_at = now\(\)/);
  });

  it('deploys its endpoint without the gateway JWT check, its recorder holds no key, and it reuses the order path unchanged', () => {
    const wf = read('.github/workflows/edge-functions.yml');
    expect(/PUBLIC_FNS="([^"]*)"/.exec(wf)?.[1].split(' ')).toContain('grokpm');
    const rec = read('supabase/functions/agents/grokpm_rec.ts');
    expect(rec).not.toMatch(/Deno\.env|PRIVATE_KEY|polymarket_orders|POLYMARKET_/);
    const fn = read('supabase/functions/grokpm/index.ts') + read('supabase/functions/grokpm/exec.ts');
    // From agents/, only the database client and live-prep's pure helpers, which it imports and never copies.
    expect([...new Set([...fn.matchAll(/from "\.\.\/agents\/([\w.]+)"/g)].map((m) => m[1]))].sort()).toEqual(['db.ts', 'pm_fees.ts', 'pm_live.ts']);
    expect([...read('supabase/functions/grokpm/index.ts').matchAll(/Deno\.env\.get\("([A-Z_]+)"\)/g)].map((m) => m[1]).sort())
      .toEqual(['CRON_SECRET', 'GROKPM_LOG_TOKEN', 'POLYMARKET_RELAYER_API_KEY', 'POLYMARKET_RELAYER_API_KEY_ADDRESS', 'SB_REGION', 'SB_REGION', 'SB_REGION', 'SUPABASE_SERVICE_ROLE_KEY',
        'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_URL', 'SUPABASE_URL', 'SUPABASE_URL']);
    // Never the venue's cancel-all: the account is shared.
    expect(fn).not.toMatch(/cancelAll\(/);
  });
});
