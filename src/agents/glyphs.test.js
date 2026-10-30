// @vitest-environment jsdom
// "↔" in a strategy's name is drawn (2026-10-30: "Stablecoin quotes RX↔Coinbase hedge" read "RX=Coinbase" in the table, the site's
// fonts having no U+2194): the character stays in the text, so the name reads, copies and matches as it is; an arrow is drawn on it.
import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup } from '@testing-library/react';
import { Glyphs } from './agents.jsx';

afterEach(cleanup);

describe('a name with "↔"', () => {
  it('keeps the character in its text and draws an arrow over it, one per "↔"', () => {
    const root = render(React.createElement('span', null, React.createElement(Glyphs, { text: 'Stablecoin quotes RX↔Coinbase hedge - 1' }))).container;
    expect(root.textContent).toBe('Stablecoin quotes RX↔Coinbase hedge - 1');
    expect(root.querySelectorAll('.ag-lr').length).toBe(1);
    expect(root.querySelectorAll('.ag-lr svg[aria-hidden="true"] path').length).toBe(1);
  });

  it('leaves any other name as it is', () => {
    const root = render(React.createElement('span', null, React.createElement(Glyphs, { text: 'Stablecoin quotes USDT/GBP' }))).container;
    expect(root.innerHTML).toBe('<span>Stablecoin quotes USDT/GBP</span>');
  });
});
