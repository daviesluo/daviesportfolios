// @vitest-environment node
// The browser checks wait on what they check, not on the clock (review F13, 2026-10-08). The sweep had 164 fixed
// `waitForTimeout` sleeps and the perf matrix six: too long on a fast machine, and a guess on a loaded one, where two CI
// runs flaked on them and the scoreboard check read the book before its exchange rates. A sleep may still be a polling
// loop's interval, and a fixed wait where nothing but time can answer the check, a thing that must NOT happen, said so
// in a comment just above it that starts "a fixed wait:". Those are counted, and the count may only go down.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// The fixed waits each file keeps, each one said why. Lower the number when one goes; never raise it.
const FIXED = { 'e2e/app-sweep.mjs': 3, 'e2e/perf-matrix.mjs': 0 };

// A polling loop: a `while`, or a counted `for` (`for (;;)`, `for (let i = 0; …; i++)`). A `for … of` walks a list (the
// viewports, the ranges) and its body is where the old sleeps sat, so it is no poll.
const POLL = /\bwhile\s*\(|\bfor\s*\([^)]*;/;
// How far below its loop's head a poll's interval may sit: a poll is a few lines, a section is hundreds.
const NEAR = 10;
/** A line without its strings, whose braces are not blocks. */
const code = (/** @type {string} */ line) => line.replace(/(['"`])(?:\\.|(?!\1).)*?\1/g, '""');

/**
 * Every `waitForTimeout` call in `text` that is not a polling loop's interval, with whether the comment just above it
 * says why. A call is a poll's interval when its own line is the loop (`while (…) await page.waitForTimeout(50)`), or
 * the block it sits in is a polling loop's body opened at most NEAR lines above it, found by walking back to the brace
 * that opens that block.
 * @param {string} text
 * @returns {{ line: number, said: boolean, text: string }[]}
 */
export function fixedWaits(text) {
  const lines = text.split('\n');
  /** @type {{ line: number, said: boolean, text: string }[]} */
  const out = [];
  lines.forEach((line, i) => {
    if (!/\.waitForTimeout\(/.test(line) || POLL.test(code(line))) return;
    let depth = 0;
    for (let j = i - 1; j >= 0; j--) {
      const l = code(lines[j]);
      depth += (l.match(/\}/g) || []).length - (l.match(/\{/g) || []).length;
      if (depth < 0) {
        if (POLL.test(l) && i - j <= NEAR) return;
        break;
      }
    }
    let k = i - 1;
    while (k >= 0 && /^\s*\/\//.test(lines[k])) k -= 1;
    const above = lines.slice(k + 1, i).join(' ');
    out.push({ line: i + 1, said: /\/\/ a fixed wait:/.test(above), text: line.trim() });
  });
  return out;
}

describe('the browser checks wait on conditions', () => {
  for (const [file, allowed] of Object.entries(FIXED)) {
    const waits = fixedWaits(fs.readFileSync(path.join(HERE, file), 'utf8'));

    it(`${file}: every fixed wait outside a polling loop says why`, () => {
      expect(waits.filter((w) => !w.said)).toEqual([]);
    });

    it(`${file}: keeps ${allowed} fixed wait(s), and never more`, () => {
      expect(waits.map((w) => `${w.line}: ${w.text}`)).toHaveLength(allowed);
    });
  }

  it('tells a loop\'s interval and a said wait from a bare sleep', () => {
    const sample = [
      'async function a(page) {',
      '  await page.click("x");',
      '  await page.waitForTimeout(300);',
      '  while (Date.now() < by) { if (await ok()) return; await page.waitForTimeout(50); }',
      '  for (let i = 0; i < 9; i++) {',
      '    const t = `${i}`;',
      '    if (t === "{") { await go(); }',
      '    await page.waitForTimeout(100);',
      '  }',
      '  // a fixed wait: nothing must be sent, and only time shows that.',
      '  await page.waitForTimeout(600);',
      '  const f = () => {',
      '    return page.waitForTimeout(80);',
      '  };',
      '  for (const vp of viewports) {',
      '    await page.click(vp);',
      '    await page.waitForTimeout(350);',
      '  }',
      '}',
    ].join('\n');
    expect(fixedWaits(sample)).toEqual([
      { line: 3, said: false, text: 'await page.waitForTimeout(300);' },
      { line: 11, said: true, text: 'await page.waitForTimeout(600);' },
      { line: 13, said: false, text: 'return page.waitForTimeout(80);' },
      { line: 17, said: false, text: 'await page.waitForTimeout(350);' },
    ]);
  });
});
