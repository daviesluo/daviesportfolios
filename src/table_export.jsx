// Shared "copy / download" header buttons for the data-table modals
// (Holding list, Transaction history) — guarantees both export the SAME
// way. Copy puts the table on the clipboard as TSV (pastes straight into
// Excel / Sheets); download emits a real .xlsx via the dependency-free
// OOXML writer in holdings_export.js. `getMatrix()` is called at click
// time and returns `[headerRow, ...dataRows]` of formatted strings (real
// values — the hide-values mask is a screen-only overlay, not data);
// `filenameBase` → `<base>-YYYY-MM-DD.xlsx`.
import React from 'react';
import { IconCopy, IconDownload, IconCheck, IconX } from './icons.jsx';
import { matrixToTsv, matrixToXlsx } from './holdings_export.js';

/**
 * @param {{ getMatrix: () => string[][], filenameBase: string, disabled?: boolean }} props
 */
export function TableExportButtons({ getMatrix, filenameBase, disabled }) {
  // 'idle' | 'done' | 'err' — transient ✓ / ✕ feedback. Before 'err' a
  // copy where BOTH clipboard paths failed gave the user no signal.
  const [copyState, setCopyState] = React.useState(/** @type {'idle'|'done'|'err'} */ ('idle'));

  const onCopy = async () => {
    if (disabled) return;
    const tsv = matrixToTsv(getMatrix());
    let ok = false;
    if (navigator.clipboard?.writeText) {
      try { await navigator.clipboard.writeText(tsv); ok = true; } catch { /* fall through to legacy path */ }
    }
    if (!ok) {
      try {
        const ta = document.createElement('textarea');
        ta.value = tsv; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        ok = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch { ok = false; }
    }
    setCopyState(ok ? 'done' : 'err');
    setTimeout(() => setCopyState('idle'), ok ? 1500 : 2000);
  };

  const onDownload = () => {
    if (disabled) return;
    const bytes = matrixToXlsx(getMatrix());
    const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filenameBase}-${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <>
      <button className="btn-ghost icon" onClick={onCopy} disabled={disabled}
        aria-label="Copy table including header"
        title={copyState === 'done' ? 'Copied' : copyState === 'err' ? 'Copy failed' : 'Copy table (incl. header)'}>
        {copyState === 'done' ? <IconCheck /> : copyState === 'err' ? <IconX /> : <IconCopy />}
      </button>
      <button className="btn-ghost icon" onClick={onDownload} disabled={disabled}
        aria-label="Download as Excel" title="Download as Excel (.xlsx)">
        <IconDownload />
      </button>
    </>
  );
}
