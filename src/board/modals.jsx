// Modals: the frame every modal draws in (`Modal`) and the themed confirm (`useConfirm`), which the board itself uses.
// What a click opens draws in this frame from chunks of its own: a position's drill-in (position_drill.jsx), the
// editors (edit_modals.jsx), the lists, the ticker chart and the Agents page.
import React from 'react';
import { createPortal } from 'react-dom';

// Ref-counted body scroll lock. PositionDrill can stack on top of the
// chart/edit/add modal, so two Modal instances can be mounted at once.
// If each captured/restored body.overflow independently, the second one
// to mount would capture 'hidden' from the first and restore that on
// unmount, leaving the page locked after every modal closes. Count
// active modals and only flip body styles at the 0↔1 boundary.
//
// On iOS Safari, `overflow: hidden` on <body> alone does NOT stop the
// page underneath from scrolling — the user's screenshot showed two
// scrollbars (the modal-body's *and* the home page's) and dragging the
// modal area still scrolled the home page in the background. On a wide
// window the lock is `position: fixed` on <body> with the saved scroll
// offset pinned via `top`, restored on release.
//
// On a phone that lock is the bug (Davies, 2026-09-25, iPhone 16 Pro).
// iOS 26 clips a position:fixed layer above the floating toolbar, so the
// page shows through underneath, and a fixed layer taller than the screen
// shoves the title off the top. The homepage fills that strip because it
// is ordinary flow at `100vh`. A phone modal does the same: scroll to the
// top, cover that screen with an absolute page, and don't fix the body.
let bodyLockCount = 0;
let savedScrollY = 0;
let phoneLock = false;
let savedBodyStyles = { position: '', top: '', left: '', right: '', width: '', overflow: '' };

function phoneModal() {
  return typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 760px)').matches;
}

/** How tall the page has to be to reach the physical bottom, and how much of
 *  that the toolbar covers. The probe is not a child of `body`: the top
 *  modal is `body`'s last child, and a probe there would steal that. */
function measureModalUnder() {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;left:0;top:0;height:100vh;width:0;visibility:hidden;pointer-events:none';
  document.documentElement.appendChild(probe);
  const vh = probe.getBoundingClientRect().height;
  probe.style.height = '100lvh';
  const lvh = probe.getBoundingClientRect().height;
  probe.remove();
  const vv = window.visualViewport;
  const visibleBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
  const layout = Math.max(vh, lvh, window.innerHeight, visibleBottom);
  // `screen.height` is the device in CSS pixels on iOS. Some browsers
  // report it in device pixels, about three times the page, which would
  // make this page three screens tall. Only trust it when it is close
  // to the layout viewport.
  const screenH = window.screen?.height || 0;
  const full = screenH > layout && screenH < layout * 1.4 ? screenH : layout;
  const under = Math.max(0, Math.round(full - visibleBottom));
  document.documentElement.style.setProperty('--modal-under', `${under}px`);
  document.documentElement.style.setProperty('--modal-h', `${Math.round(full)}px`);
}

function onModalViewport() {
  if (phoneLock && bodyLockCount > 0) measureModalUnder();
}

/** A drag that isn't on the modal's own scroller must not move the board. */
function blockBackgroundScroll(e) {
  const el = e.target instanceof Element ? e.target : null;
  if (el?.closest('.modal-body')) return;
  if (e.cancelable) e.preventDefault();
}

function holdPhoneScroll() {
  const a = document.activeElement;
  const typing = a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT');
  if (!typing && window.scrollY !== 0) window.scrollTo(0, 0);
}

function acquireBodyLock() {
  if (bodyLockCount === 0) {
    savedScrollY = window.scrollY || window.pageYOffset || 0;
    phoneLock = phoneModal();
    document.body.classList.add('modal-open');
    if (phoneLock) {
      // Don't set overflow:hidden. On iOS that clips the page to the layout
      // viewport, which is the blank band under the toolbar.
      window.scrollTo(0, 0);
      document.documentElement.classList.add('modal-open');
      measureModalUnder();
      document.addEventListener('touchmove', blockBackgroundScroll, { passive: false });
      window.addEventListener('scroll', holdPhoneScroll);
      window.visualViewport?.addEventListener('resize', onModalViewport);
      window.visualViewport?.addEventListener('scroll', onModalViewport);
    } else {
      const s = document.body.style;
      savedBodyStyles = {
        position: s.position, top: s.top, left: s.left, right: s.right,
        width: s.width, overflow: s.overflow,
      };
      s.position = 'fixed';
      s.top = `-${savedScrollY}px`;
      s.left = '0';
      s.right = '0';
      s.width = '100%';
      s.overflow = 'hidden';
    }
  }
  bodyLockCount += 1;
}
function releaseBodyLock() {
  bodyLockCount -= 1;
  if (bodyLockCount > 0) return;
  bodyLockCount = 0;
  if (phoneLock) {
    document.documentElement.classList.remove('modal-open');
    document.documentElement.style.removeProperty('--modal-under');
    document.documentElement.style.removeProperty('--modal-h');
    document.removeEventListener('touchmove', blockBackgroundScroll);
    window.removeEventListener('scroll', holdPhoneScroll);
    window.visualViewport?.removeEventListener('resize', onModalViewport);
    window.visualViewport?.removeEventListener('scroll', onModalViewport);
    phoneLock = false;
  } else {
    const s = document.body.style;
    s.position = savedBodyStyles.position;
    s.top = savedBodyStyles.top;
    s.left = savedBodyStyles.left;
    s.right = savedBodyStyles.right;
    s.width = savedBodyStyles.width;
    s.overflow = savedBodyStyles.overflow;
  }
  document.body.classList.remove('modal-open');
  window.scrollTo(0, savedScrollY);
}

function Modal({ children, onClose, size = "md" }) {
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Lock body scroll while any modal is mounted so iOS Safari's bouncy
  // overscroll can't drag the underlying page. See acquireBodyLock.
  // Layout, not passive: on a phone this hides the board before paint,
  // so the subpage is not one frame of the homepage with the modal
  // below it.
  React.useLayoutEffect(() => {
    acquireBodyLock();
    return releaseBodyLock;
  }, []);

  const downOnBackdrop = React.useRef(false);
  const backdropRef = React.useRef(/** @type {HTMLDivElement | null} */ (null));

  // The top modal is ordinary flow (it has to be, on iOS 26). Ones under
  // it stay absolutely placed in the same rectangle so a ticker page can
  // sit on the holding list without lengthening the document.
  React.useLayoutEffect(() => {
    const mark = () => {
      const all = [...document.querySelectorAll('.modal-backdrop')];
      const top = all[all.length - 1];
      for (const node of all) node.classList.toggle('is-top', node === top);
    };
    mark();
    return () => {
      const node = backdropRef.current;
      if (node) node.classList.remove('is-top');
      queueMicrotask(mark);
    };
  }, []);

  return createPortal(
    <div className="modal-backdrop" ref={backdropRef}
      onMouseDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={() => { if (downOnBackdrop.current) onClose(); }}
    >
      <div className={`modal size-${size}`} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/**
 * Themed confirm dialog — the in-app replacement for window.confirm
 * (whose bare system chrome sat outside the dark theme and looked like an
 * OS error in the iOS PWA). Portaled to <body> so it stacks above any
 * modal it's invoked from: the other modals sit under a backdrop-filtered
 * `.modal-backdrop`, which establishes a containing block that would
 * otherwise trap a nested fixed dialog. Reached via useConfirm(), never
 * rendered directly. `danger` tints the action button red for
 * destructive confirms (delete / discard / reset).
 * @param {{ title?: string, message: string, detail?: string,
 *   confirmLabel?: string, cancelLabel?: string, altLabel?: string,
 *   danger?: boolean, onConfirm: () => void, onAlt?: () => void,
 *   onCancel: () => void }} props
 */
// `altLabel` turns this into a three-outcome dialog: confirm / alt /
// cancel. Needed when BOTH named actions write something and cancel has
// to mean "do nothing" — a binary confirm would have to map Esc, the
// backdrop and Cancel onto one of the two writes, which is how "Cancel"
// ended up silently performing the more destructive branch.
function ConfirmModal({ title, message, detail, confirmLabel, cancelLabel, altLabel, danger, onConfirm, onAlt, onCancel }) {
  return createPortal(
    <Modal onClose={onCancel} size="sm">
      <header className="modal-head">
        <div>
          <div className="modal-eyebrow mono">{title || 'CONFIRM'}</div>
          <h2 className="modal-title">{message}</h2>
        </div>
      </header>
      {detail && (
        <div className="modal-body">
          <p className="confirm-detail">{detail}</p>
        </div>
      )}
      <footer className="modal-foot">
        <button className="btn-ghost" onClick={onCancel}>{cancelLabel || 'Cancel'}</button>
        <span className="spacer" />
        {altLabel && (
          <button className="btn-ghost" onClick={onAlt}>{altLabel}</button>
        )}
        <button className={danger ? 'btn-danger' : 'btn-primary'} onClick={onConfirm}>
          {confirmLabel || 'Confirm'}
        </button>
      </footer>
    </Modal>,
    document.body,
  );
}

/**
 * Themed window.confirm. Returns `{ confirm, element }`: `await confirm(opts)`
 * resolves to true (confirmed) / false (cancelled or backdrop / Esc), and
 * `element` must be rendered somewhere in the component so the dialog can
 * mount (it portals to <body>, so where doesn't matter). `opts` is a
 * message string or `{ title, message, detail, confirmLabel, cancelLabel,
 * danger }`. An object (not a tuple) so the destructured types survive the
 * import into app.jsx. Self-contained per component — no provider to wire.
 * `cancel()` closes an open dialog as its Cancel does (resolving false); the
 * app's boundary around the dialog calls it when the dialog itself fails.
 */
export function useConfirm() {
  const [state, setState] = React.useState(/** @type {any} */ (null));
  const confirm = React.useCallback((/** @type {string | object} */ opts) => {
    const o = typeof opts === 'string' ? { message: opts } : opts;
    return new Promise((resolve) => setState({ ...o, resolve }));
  }, []);
  // A promise resolves once, so an updater run twice resolves it once.
  const cancel = React.useCallback(() => {
    setState((/** @type {any} */ s) => { s?.resolve(false); return null; });
  }, []);
  const element = state ? (
    <ConfirmModal
      title={state.title}
      message={state.message}
      detail={state.detail}
      confirmLabel={state.confirmLabel}
      cancelLabel={state.cancelLabel}
      altLabel={state.altLabel}
      danger={state.danger}
      onConfirm={() => { state.resolve(true); setState(null); }}
      onAlt={() => { state.resolve('alt'); setState(null); }}
      onCancel={() => { state.resolve(false); setState(null); }}
    />
  ) : null;
  return { confirm, cancel, element };
}

export { Modal };
