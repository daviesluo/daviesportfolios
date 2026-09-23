// Shared monochrome inline icons (currentColor) for header icon buttons —
// SVG rather than Unicode glyphs so they never render as tofu and pick up
// the chalk theme's stroke colour + hover/disabled states. Feather-style
// 24×24 paths. Used by the Holding list export buttons and the chart
// modal's screenshot buttons.
import React from 'react';

const ICON_SVG = {
  width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 2, strokeLinecap: /** @type {const} */ ('round'), strokeLinejoin: /** @type {const} */ ('round'),
  'aria-hidden': true,
};

export const IconCopy = () => (
  <svg {...ICON_SVG}><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
);
export const IconDownload = () => (
  <svg {...ICON_SVG}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
);
export const IconCheck = () => (
  <svg {...ICON_SVG}><polyline points="20 6 9 17 4 12" /></svg>
);
export const IconX = () => (
  <svg {...ICON_SVG}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
);
