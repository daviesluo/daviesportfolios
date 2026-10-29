// `cb_quote_inputs` must admit every kind the Coinbase code writes to it. On 2026-10-29 the `cb_live` switch began storing
// Coinbase's USDT-USD minutes as `cb:USDT-USD` while 0112's check still read `kind in ('fx:EURUSD')`: every write was refused
// and the USDT books went dark for two hours (fixed by 0174). This replays the migrations' kind checks and holds the code to them.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'supabase/migrations');
const FILES = fs.readdirSync(DIR).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
const kindsOf = (list) => [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]);

/** The kinds the table admits once every migration has applied: 0112's column check, then each later replacement. */
function admitted() {
  let kinds = null;
  for (const f of FILES) {
    const sql = fs.readFileSync(path.join(DIR, f), 'utf8').replace(/--[^\n]*/g, '');
    const made = /create table if not exists public\.cb_quote_inputs \(\s*kind\s+text not null check \(kind in \(([^)]*)\)\)/.exec(sql);
    if (made) kinds = kindsOf(made[1]);
    const added = /alter table public\.cb_quote_inputs add constraint cb_quote_inputs_kind_check check \(kind in \(([^)]*)\)\);/.exec(sql);
    if (added) kinds = kindsOf(added[1]);
  }
  return kinds;
}

describe('cb_quote_inputs kinds', () => {
  it('admits every kind the Coinbase code stores', () => {
    const src = fs.readFileSync(path.join(ROOT, 'supabase/functions/agents/cb_quotes.ts'), 'utf8');
    const usdt = /export const CB_USDT_KIND = "([^"]+)";/.exec(src)?.[1];
    expect(usdt).toBe('cb:USDT-USD');
    expect(src).toContain('kind: "fx:EURUSD"');
    expect(admitted()).toEqual(['fx:EURUSD', usdt]);
  });
});
