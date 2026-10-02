// One error boundary per surface of the page (improvement plan item 20, 2026-10-02). Until then the app had one boundary,
// at its root, besides one per lazily loaded page for its code: a throw anywhere else replaced the whole board with
// RENDER ERROR. Now the header, the performance panel, the heat map and the tactics board, the sidebar and its panels,
// the market cards, upcoming earnings, the Agents page and every modal sit inside a boundary of their own. A throw there
// turns that surface into a short message in its own place, with a Retry, and is reported to the errors box; everything
// else on the page keeps working. The root boundary in app.jsx stays, for a throw in the board's own frame.
//
// A boundary catches what its children throw while they render, a lazily loaded page whose code did not arrive among
// them (chunk_recovery.js heals that once and reloads; a second failure inside its window is thrown and lands here). It
// does not catch a throw in an event handler or a promise: those never reach React's tree.
import React from 'react';
import { isChunkLoadError } from './chunk_recovery.js';
import { reportError } from './ops_error.js';

/**
 * Whether the browser sweep (src/e2e/app-sweep.mjs) has asked the surface `name` to fail. The sweep names surfaces in
 * `window.__dpSweepFail` from an init script before the page loads, or on the page once it has; nothing in the app sets
 * it, so a person's session never has it, and a surface asked to fail fails the way any throw would, inside its own
 * boundary.
 * @param {string} name
 */
export function sweepAsksToFail(name) {
  const asked = /** @type {any} */ (globalThis).__dpSweepFail;
  return Array.isArray(asked) && asked.includes(name);
}

/** @param {{ name: string, children?: React.ReactNode }} props */
function SweepTrip({ name, children }) {
  if (sweepAsksToFail(name)) throw new Error(`${name}: made to fail by the browser sweep`);
  return children;
}

/**
 * What a failed surface shows in its own place: its title, the words, and a Retry that draws it again. The classes it
 * is given are the surface's own placement classes (`perf-in-left`, `earnings-panel-mobile`, …), so it sits, and is
 * shown or hidden, exactly where the surface would have been.
 * @param {{ name: string, title?: string, className?: string, what?: string, onRetry: () => void }} props
 */
export function FailedPanel({ name, title, className = '', what = 'panel', onRetry }) {
  return (
    <section className={`panel surface-failed ${className}`.trim()} role="alert" data-surface={name}>
      {title ? <h3 className="panel-title">{title}</h3> : null}
      <div className="surface-failed-msg mono">This {what} failed to load.</div>
      <button type="button" className="btn-ghost surface-failed-retry" onClick={onRetry}>Retry</button>
    </section>
  );
}

/**
 * @typedef {{ retry: () => void, chunk: boolean }} FailedArgs
 * @typedef {{
 *   name: string,
 *   title?: string,
 *   className?: string,
 *   what?: string,
 *   resetKey?: unknown,
 *   silent?: boolean,
 *   fallback?: (args: FailedArgs) => React.ReactNode,
 *   children?: React.ReactNode,
 * }} SurfaceBoundaryProps
 */

/**
 * The boundary around one surface. `name` identifies it in the report (its `symbol`, so the errors box lists each
 * surface on its own line and one surface's repeats are folded without hiding another's) and to the sweep. A failed
 * surface draws `fallback` when given (a modal draws its own frame), nothing when `silent`, and `FailedPanel` otherwise.
 * `resetKey` draws a failed surface again whenever it changes: the board passes the refresh button's count, so Refresh
 * retries every failed panel with the prices.
 * @extends {React.Component<SurfaceBoundaryProps, { err: unknown }>}
 */
export class SurfaceBoundary extends React.Component {
  /** @param {SurfaceBoundaryProps} props */
  constructor(props) {
    super(props);
    this.state = { err: null };
    this.retry = () => this.setState({ err: null });
  }

  /** @param {unknown} err */
  static getDerivedStateFromError(err) { return { err }; }

  /** @param {any} error @param {any} info */
  componentDidCatch(error, info) {
    const chunk = isChunkLoadError(error);
    // The stacks are cut so the whole context stays inside the ops-error function's 2 KB, past which it keeps none.
    reportError(chunk ? 'chunk.load' : 'render.crash', {
      symbol: this.props.name,
      message: String(error?.message || error),
      context: {
        surface: this.props.name, healed: false,
        stack: String(error?.stack || '').slice(0, 900),
        componentStack: String(info?.componentStack || '').slice(0, 500),
      },
    });
  }

  /** @param {SurfaceBoundaryProps} prev */
  componentDidUpdate(prev) {
    if (this.state.err && !Object.is(prev.resetKey, this.props.resetKey)) this.setState({ err: null });
  }

  render() {
    const { err } = this.state;
    const { name, children } = this.props;
    if (!err) return <SweepTrip name={name}>{children}</SweepTrip>;
    if (this.props.fallback) return this.props.fallback({ retry: this.retry, chunk: isChunkLoadError(err) });
    if (this.props.silent) return null;
    return <FailedPanel name={name} title={this.props.title} className={this.props.className} what={this.props.what} onRetry={this.retry} />;
  }
}
