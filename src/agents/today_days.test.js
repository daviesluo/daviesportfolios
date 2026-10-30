// @vitest-environment jsdom
// One number for today on a Stablecoin quotes page (Davies, 2026-10-30: "策略子页面的scoreboard today的金额和days列表中today的realised的金额
// 不一致的问题也解决下"): the scoreboard's TODAY is today's realised, the figure DAYS shows on its today row, on every page the browser
// test serves (LIVE's, each twin's, Coinbase LIVE's and a Coinbase paper arm's), each from its own reader's answer; a TODAY that
// also counts what the rungs hold at their mark (LIVE's until then: its loss stop's figure) is caught.
import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup } from '@testing-library/react';
import { QuotesLiveDetail } from './agents.jsx';
import liveFixture from '../e2e/quotes_live_fixture.json';
import twinFixture from '../e2e/quotes_twin_fixture.json';
import cbLiveFixture from '../e2e/cb_live_fixture.json';
import cbHoldFixture from '../e2e/quotes_coinbase_hold_fixture.json';

afterEach(cleanup);

const m = (/** @type {string} */ s) => s;
const txt = (/** @type {Element | null | undefined} */ el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
/** A money figure as the page writes it: "+£0.23", "−$1.05", "-£0.0633". @param {string} s */
const num = (s) => {
  const v = Number(s.replace(/[−–]/g, '-').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(v) ? v : NaN;
};
/** The page's TODAY on its scoreboard and its DAYS' today realised (0 without a today row). @param {Element} root */
function todays(root) {
  const cell = [...root.querySelectorAll('.ag-scoreboard .ag-sb-cell')].find((c) => txt(c.querySelector('.ag-sb-name')) === 'TODAY');
  const row = [...root.querySelectorAll('.ag-quote-days tbody tr')].find((tr) => /today/.test(txt(tr.querySelector('td'))));
  const cells = row ? row.querySelectorAll('td') : null;
  return { scoreboard: num(txt(cell?.querySelector('.ag-sb-usd'))), days: cells ? num(txt(cells[cells.length - 1])) : 0 };
}
const view = (/** @type {any} */ q, /** @type {any} */ flags) => render(React.createElement(QuotesLiveDetail, { q, m, at: '2026-09-17T23:00:00Z', nowMs: Date.parse('2026-09-17T23:00:00Z'), ...flags })).container;
/** The two agree to the scoreboard's cents. @param {{ scoreboard: number, days: number }} t */
const agree = (t) => Number.isFinite(t.scoreboard) && Math.abs(t.scoreboard - t.days) < 0.005 + 1e-9;

const PAGES = [
  ['LIVE', liveFixture.live, {}],
  ...(/** @type {any[]} */ (twinFixture.twins)).map((t) => [`twin ${t.twin.id}`, t, { twin: true }]),
  ['Coinbase LIVE', cbLiveFixture.output, { cbLive: true }],
  ['a Coinbase paper arm', cbHoldFixture.quotesCoinbaseHold, { coinbase: true }],
];

describe("a Stablecoin quotes page's TODAY is its DAYS' today", () => {
  for (const [name, q, flags] of PAGES) {
    it(`${name}: one number`, () => {
      const t = todays(view(q, flags));
      expect(agree(t), `${name}: scoreboard ${t.scoreboard}, DAYS ${t.days}`).toBe(true);
    });
  }

  it("LIVE's page shows a loss of today's trips, not the mark of what it holds (counterfactual: the loss stop's figure is caught)", () => {
    const t = todays(view(liveFixture.live, {}));
    expect(t.scoreboard).toBeCloseTo(-0.06, 2);
    // The loss stop's figure, today's realised and B's and E's marks (+£0.227106), as TODAY was until 2026-10-30.
    const stop = { ...liveFixture.live, todayGbp: 0.227106, todayUsd: 0.227106 * 1.32 };
    expect(agree(todays((cleanup(), view(stop, {}))))).toBe(false);
  });
});
