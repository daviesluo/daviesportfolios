// @vitest-environment jsdom
// The boundary around one surface of the page (improvement plan item 20): a throw inside it becomes that surface's own
// message with a Retry, reported under the surface's name, while everything outside it stays drawn. The browser sweep
// checks the same on the built bundle, surface by surface (src/e2e/app-sweep.mjs, part `surfaces`).
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('./ops_error.js', () => ({ reportError: vi.fn() }));

import { SurfaceBoundary, FailedPanel, sweepAsksToFail } from './surface_boundary.jsx';
import { reportError } from './ops_error.js';

/** A child that throws while `box.broken` is true. @param {{ box: { broken: boolean }, label: string }} props */
function Fragile({ box, label }) {
  if (box.broken) throw new TypeError("Cannot read properties of undefined (reading 'map')");
  return <div data-testid={label}>{label} drawn</div>;
}

describe('SurfaceBoundary', () => {
  /** @type {any} */
  let quiet;
  beforeEach(() => {
    vi.mocked(reportError).mockClear();
    // React writes every caught error to the console; the throws here are on purpose.
    quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    delete (/** @type {any} */ (globalThis)).__dpSweepFail;
  });
  afterEach(() => { quiet.mockRestore(); delete (/** @type {any} */ (globalThis)).__dpSweepFail; });

  it('draws its children when nothing throws, and reports nothing', () => {
    render(<SurfaceBoundary name="perf" title="PERFORMANCE"><Fragile box={{ broken: false }} label="chart" /></SurfaceBoundary>);
    expect(screen.getByTestId('chart')).toHaveTextContent('chart drawn');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(reportError).not.toHaveBeenCalled();
  });

  it('turns a throw into the surface\'s own message, keeps its neighbours, and reports it under the surface\'s name', () => {
    render(
      <main>
        <SurfaceBoundary name="perf" title="PERFORMANCE" className="perf-in-left"><Fragile box={{ broken: true }} label="chart" /></SurfaceBoundary>
        <SurfaceBoundary name="board"><Fragile box={{ broken: false }} label="heatmap" /></SurfaceBoundary>
        <div data-testid="scoreboard">$3,182.50</div>
      </main>,
    );
    const failed = screen.getByRole('alert');
    expect(failed).toHaveClass('panel', 'surface-failed', 'perf-in-left');
    expect(failed).toHaveAttribute('data-surface', 'perf');
    expect(failed).toHaveTextContent('PERFORMANCE');
    expect(failed).toHaveTextContent('This panel failed to load.');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByTestId('chart')).toBeNull();
    expect(screen.getByTestId('heatmap')).toHaveTextContent('heatmap drawn');
    expect(screen.getByTestId('scoreboard')).toHaveTextContent('$3,182.50');
    expect(reportError).toHaveBeenCalledTimes(1);
    const [kind, opts] = vi.mocked(reportError).mock.calls[0];
    expect(kind).toBe('render.crash');
    expect(opts?.symbol).toBe('perf');
    expect(opts?.message).toBe("Cannot read properties of undefined (reading 'map')");
    const ctx = /** @type {any} */ (opts)?.context ?? {};
    expect(ctx.surface).toBe('perf');
    // The ops-error function keeps no context past 2 KB serialised, so the stacks are cut well inside it.
    expect(JSON.stringify(ctx).length).toBeLessThan(1600);
  });

  it('draws the surface again on Retry, once the cause is gone', () => {
    const box = { broken: true };
    render(<SurfaceBoundary name="movers" title="TOP MOVERS"><Fragile box={box} label="movers" /></SurfaceBoundary>);
    expect(screen.getByRole('alert')).toHaveTextContent('This panel failed to load.');
    box.broken = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(screen.getByTestId('movers')).toHaveTextContent('movers drawn');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('draws a failed surface again when its reset key moves (the refresh button), and not before', () => {
    const box = { broken: true };
    const { rerender } = render(<SurfaceBoundary name="board" resetKey={0}><Fragile box={box} label="board" /></SurfaceBoundary>);
    box.broken = false;
    rerender(<SurfaceBoundary name="board" resetKey={0}><Fragile box={box} label="board" /></SurfaceBoundary>);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    rerender(<SurfaceBoundary name="board" resetKey={1}><Fragile box={box} label="board" /></SurfaceBoundary>);
    expect(screen.getByTestId('board')).toHaveTextContent('board drawn');
  });

  it('hands a page\'s own frame whether its code did not load (a chunk) or it threw while drawing', () => {
    const chunkErr = new TypeError('Failed to fetch dynamically imported module: https://daviesluo.com/assets/agents-12d5c754.js');
    /** @returns {React.ReactNode} */
    function NoCode() { throw chunkErr; }
    const seen = [];
    render(
      <>
        <SurfaceBoundary name="agents" fallback={({ chunk }) => { seen.push(chunk); return <p>frame {chunk ? 'chunk' : 'render'}</p>; }}><NoCode /></SurfaceBoundary>
        <SurfaceBoundary name="cash" fallback={({ chunk }) => <p>frame {chunk ? 'chunk' : 'render'}</p>}><Fragile box={{ broken: true }} label="cash" /></SurfaceBoundary>
      </>,
    );
    expect(screen.getByText('frame chunk')).toBeInTheDocument();
    expect(screen.getByText('frame render')).toBeInTheDocument();
    expect(seen.every(Boolean)).toBe(true);
    const kinds = vi.mocked(reportError).mock.calls.map(([k, o]) => `${k}|${o?.symbol}`).sort();
    expect(kinds).toEqual(['chunk.load|agents', 'render.crash|cash']);
  });

  it('a silent surface fails to nothing, and its neighbours stay', () => {
    render(
      <>
        <SurfaceBoundary name="ops-badge" silent><Fragile box={{ broken: true }} label="badge" /></SurfaceBoundary>
        <span data-testid="refresh">Refresh</span>
      </>,
    );
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByTestId('badge')).toBeNull();
    expect(screen.getByTestId('refresh')).toBeInTheDocument();
    expect(reportError).toHaveBeenCalledWith('render.crash', expect.objectContaining({ symbol: 'ops-badge' }));
  });

  it('fails the surfaces the browser sweep names, and only those', () => {
    expect(sweepAsksToFail('perf')).toBe(false);
    /** @type {any} */ (globalThis).__dpSweepFail = ['perf'];
    expect(sweepAsksToFail('perf')).toBe(true);
    expect(sweepAsksToFail('board')).toBe(false);
    render(
      <>
        <SurfaceBoundary name="perf" title="PERFORMANCE"><div data-testid="chart">chart</div></SurfaceBoundary>
        <SurfaceBoundary name="board"><div data-testid="board">board</div></SurfaceBoundary>
      </>,
    );
    expect(screen.getByRole('alert')).toHaveAttribute('data-surface', 'perf');
    expect(screen.queryByTestId('chart')).toBeNull();
    expect(screen.getByTestId('board')).toBeInTheDocument();
    expect(vi.mocked(reportError).mock.calls[0][1]?.message).toBe('perf: made to fail by the browser sweep');
    // A value of any other shape asks nothing.
    /** @type {any} */ (globalThis).__dpSweepFail = 'perf';
    expect(sweepAsksToFail('perf')).toBe(false);
  });

  it('FailedPanel says page or panel as it is told, in the surface\'s own place', () => {
    render(<FailedPanel name="agents-page" what="page" className="ag-failed" onRetry={() => {}} />);
    const el = screen.getByRole('alert');
    expect(el).toHaveClass('ag-failed');
    expect(el).toHaveTextContent('This page failed to load.');
    expect(el.querySelector('.panel-title')).toBeNull();
  });
});
