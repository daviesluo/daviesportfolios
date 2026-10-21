// @vitest-environment node
// bin/edge-test.mjs, the gates' Edge tests in several Deno processes at once (2026-10-21). Which file goes to which
// process decides only the speed; what has to hold is that every test file `deno test supabase/functions/` would run
// runs, exactly once, and that a failure anywhere fails the step. Like edge_changed.test.js, it sits in src/ because
// vitest runs here.
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileTimes, isTestFile, partition, testFiles } from '../bin/edge-test.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('edge-test.mjs — every Edge test file, once, in some shard', () => {
  it('takes the names Deno takes for a test file, and no other', () => {
    for (const n of ['index.test.ts', 'pm_live.test.ts', 'a_test.ts', 'test.ts', 'x.test.tsx', 'x.test.mjs', 'x.test.js']) {
      expect(isTestFile(n)).toBe(true);
    }
    for (const n of ['index.ts', 'testing.ts', 'contest.ts', 'latest.ts', 'x.test.json', 'x.test.ts.bak']) expect(isTestFile(n)).toBe(false);
  });

  it('finds the repository\'s test files, all under supabase/functions/', () => {
    const files = testFiles(ROOT, 'supabase/functions');
    expect(files.length).toBeGreaterThan(80);
    expect(files.every((f) => f.startsWith('./supabase/functions/') && f.endsWith('.test.ts'))).toBe(true);
    expect(files).toContain('./supabase/functions/agents/pm_live.test.ts');
  });

  it('puts every file in exactly one shard, with or without timings', () => {
    const files = testFiles(ROOT, 'supabase/functions');
    for (const times of [{}, { [files[0]]: 50_000, [files[1]]: 1 }]) {
      for (const n of [1, 2, 3, 4, 200]) {
        const shards = partition(files, n, times);
        expect(shards.length).toBe(Math.min(n, files.length));
        expect(shards.every((s) => s.length > 0)).toBe(true);
        expect(shards.flat().sort()).toEqual([...files].sort());
      }
    }
  });

  it('balances by the last run\'s seconds, longest first onto the lightest shard', () => {
    const shards = partition(['a', 'b', 'c', 'd', 'e'], 2, { a: 20, b: 14, c: 13, d: 11, e: 5 });
    // 20 → 1; 14 → 2; 13 → 2 (27); 11 → 1 (31); 5 → 2 (32).
    expect(shards).toEqual([['a', 'd'], ['b', 'c', 'e']]);
    // A file not yet timed weighs the median of the known ones (13 here), not nothing: 20 → 1; 13 (b) → 2;
    // 13 (new) → 2 (26); 5 → 1 (25).
    expect(partition(['a', 'b', 'c', 'new'], 2, { a: 20, b: 13, c: 5 })).toEqual([['a', 'c'], ['b', 'new']]);
  });

  it('reads each file\'s seconds out of a deno test output, colours or not', () => {
    const out = [
      '\x1b[0m\x1b[38;5;245mrunning 2 tests from ./supabase/functions/a.test.ts\x1b[0m',
      'first ... \x1b[0m\x1b[32mok\x1b[0m \x1b[0m\x1b[38;5;245m(12ms)\x1b[0m',
      'second ... ok (1s)',
      'running 1 test from ./supabase/functions/b.test.ts',
      'slow one ... ok (1m2s)',
      '',
      'ok | 3 passed | 0 failed (1m4s)',
    ].join('\n');
    expect(fileTimes(out)).toEqual({ './supabase/functions/a.test.ts': 1012, './supabase/functions/b.test.ts': 62_000 });
  });
});
