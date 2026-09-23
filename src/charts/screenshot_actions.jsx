// The chart modal's "copy image / save image" header buttons. Mirrors the
// Holding list's copy/download pair, but here the payload is a PNG
// screenshot of the modal window rather than a data table: copy puts the
// image on the clipboard, save downloads it (or, on mobile, opens the
// share sheet so it can go to Photos / 相册).
//
// The buttons find their own modal panel via `closest('.modal')`, so no
// ref has to be threaded down through <Modal>. The whole action group is
// tagged `screenshot-skip` so html2canvas omits the chrome buttons from
// the shot (a clean capture of just the content).
import React from 'react';
import { IconCopy, IconDownload, IconCheck, IconX } from '../app/icons.jsx';
import { copyNodeImage, saveNodeImage } from './screenshot.js';

/** @param {Element} el */
const skip = (el) => !!(el.classList && el.classList.contains('screenshot-skip'));

/**
 * @param {{ filenameBase: string }} props  filenameBase → `<base>-YYYY-MM-DD.png`
 */
export function ScreenshotActions({ filenameBase }) {
  // 'idle' | 'busy' | 'done' | 'err' — copy shows transient ✓ / ✕ feedback.
  const [copyState, setCopyState] = React.useState(/** @type {'idle'|'busy'|'done'|'err'} */ ('idle'));
  const [saveBusy, setSaveBusy] = React.useState(false);
  const ref = React.useRef(/** @type {HTMLButtonElement | null} */ (null));

  const panel = () => /** @type {HTMLElement | null} */ (ref.current?.closest('.modal') ?? null);
  const filename = () => `${filenameBase}-${new Date().toISOString().slice(0, 10)}.png`;

  const onCopy = async () => {
    const node = panel();
    if (!node || copyState === 'busy') return;
    setCopyState('busy');
    try {
      await copyNodeImage(node, skip);
      setCopyState('done');
      setTimeout(() => setCopyState('idle'), 1500);
    } catch (e) {
      // The ✕ tells the user it failed; the console says WHY (clipboard
      // permission vs capture throw) — otherwise undiagnosable from a
      // user report alone.
      console.error('screenshot copy failed:', e);
      setCopyState('err');
      setTimeout(() => setCopyState('idle'), 2000);
    }
  };

  const onSave = async () => {
    const node = panel();
    if (!node || saveBusy) return;
    setSaveBusy(true);
    try {
      await saveNodeImage(node, filename(), skip);
    } catch (e) {
      // A user-cancelled share never reaches here (saveNodeImage eats
      // AbortError), so this is a real capture/save failure — log it;
      // the button re-enabling is the only user-visible signal.
      console.error('screenshot save failed:', e);
    }
    setSaveBusy(false);
  };

  const copyIcon = copyState === 'done' ? <IconCheck /> : copyState === 'err' ? <IconX /> : <IconCopy />;
  const copyTitle = copyState === 'done' ? 'Copied' : copyState === 'err' ? 'Copy failed' : 'Copy screenshot to clipboard';

  return (
    <>
      <button ref={ref} className="btn-ghost icon" onClick={onCopy} disabled={copyState === 'busy'}
        aria-label="Copy screenshot to clipboard" title={copyTitle}>
        {copyIcon}
      </button>
      <button className="btn-ghost icon" onClick={onSave} disabled={saveBusy}
        aria-label="Save screenshot" title="Save screenshot (mobile: share to album)">
        <IconDownload />
      </button>
    </>
  );
}
