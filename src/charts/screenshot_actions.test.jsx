// Wiring test for the chart-modal screenshot buttons: each button finds
// its own `.modal` panel via closest(), copy/save get the panel node + a
// `screenshot-skip` ignore predicate, save's filename is date-stamped, and
// copy flips to its ✓ state on success. The capture/clipboard/share logic
// itself lives in (and is pinned by) screenshot.js — mocked here.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('./screenshot.js', () => ({
  copyNodeImage: vi.fn(async () => {}),
  saveNodeImage: vi.fn(async () => {}),
}));

import { ScreenshotActions } from './screenshot_actions.jsx';
import { copyNodeImage, saveNodeImage } from './screenshot.js';

/** Render the buttons inside a `.modal` panel so closest('.modal') resolves. */
function renderInModal(base = 'NVDA') {
  return render(
    <div className="modal">
      <header className="modal-head">
        <div className="modal-head-actions screenshot-skip">
          <ScreenshotActions filenameBase={base} />
        </div>
      </header>
    </div>,
  );
}

describe('ScreenshotActions', () => {
  beforeEach(() => { cleanup(); vi.clearAllMocks(); });

  it('copy passes the modal panel + skip predicate, then shows the ✓ state', async () => {
    const user = userEvent.setup();
    renderInModal();
    await user.click(screen.getByLabelText('Copy screenshot to clipboard'));
    expect(copyNodeImage).toHaveBeenCalledTimes(1);
    const [node, ignore] = /** @type {any} */ (copyNodeImage).mock.calls[0];
    expect(node).toHaveClass('modal');
    // The ignore predicate hides the chrome buttons from the shot.
    const skipEl = document.createElement('div'); skipEl.className = 'screenshot-skip';
    expect(ignore(skipEl)).toBe(true);
    expect(ignore(document.createElement('div'))).toBe(false);
    await waitFor(() => expect(screen.getByLabelText('Copy screenshot to clipboard').title).toBe('Copied'));
  });

  it('save passes the panel + a date-stamped <base>.png filename', async () => {
    const user = userEvent.setup();
    renderInModal('GBPUSD=X');
    await user.click(screen.getByLabelText('Save screenshot'));
    expect(saveNodeImage).toHaveBeenCalledTimes(1);
    const [node, filename] = /** @type {any} */ (saveNodeImage).mock.calls[0];
    expect(node).toHaveClass('modal');
    expect(filename).toMatch(/^GBPUSD=X-\d{4}-\d{2}-\d{2}\.png$/);
  });

  it('copy shows the ✕ state when the capture / clipboard fails', async () => {
    /** @type {any} */ (copyNodeImage).mockRejectedValueOnce(new Error('nope'));
    const user = userEvent.setup();
    renderInModal();
    await user.click(screen.getByLabelText('Copy screenshot to clipboard'));
    await waitFor(() => expect(screen.getByLabelText('Copy screenshot to clipboard').title).toBe('Copy failed'));
  });
});
