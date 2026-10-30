// @vitest-environment jsdom
// "Stablecoin quotes RX↔Coinbase hedge" and "… - 1" name both venues wherever a venue badge stands for them (Davies, 2026-10-30:
// "在venue列两个币所都加上"): the TESTING table's venue cell, its phone card and its venue card all draw `VenueBadge` with the rows'
// `venueId`, "revx-coinbase", which is Revolut X's badge and Coinbase's side by side; one venue's id is still one badge.
import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup } from '@testing-library/react';
import { VenueBadge } from './agents.jsx';

afterEach(cleanup);

describe('the venue badge of a row on two venues', () => {
  it("is Revolut X's badge and Coinbase's, side by side in one wrapping group", () => {
    const { container } = render(React.createElement(VenueBadge, { id: 'revx-coinbase' }));
    const pair = container.querySelector('.ag-venue-pair');
    expect(pair).not.toBeNull();
    expect([...(pair?.querySelectorAll('.ag-venue') ?? [])].map((b) => [b.className, b.textContent])).toEqual([
      ['ag-venue ag-venue-revx', 'Revolut X'], ['ag-venue ag-venue-coinbase', 'Coinbase'],
    ]);
  });

  it('is one badge for one venue', () => {
    const { container } = render(React.createElement(VenueBadge, { id: 'coinbase' }));
    expect(container.querySelector('.ag-venue-pair')).toBeNull();
    expect([...container.querySelectorAll('.ag-venue')].map((b) => b.textContent)).toEqual(['Coinbase']);
  });
});
