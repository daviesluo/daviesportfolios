// Tactics-board slot coordinates on a 100×100 pitch (home team attacks
// UP; GK at the bottom). Pure data — consumed by Pitch + Heatmap for
// chip placement and by app.jsx for the formation layout. Lived in the
// old `utils.js` god-module barrel; moved here when that barrel was
// retired in favour of direct per-module imports.
export const POSITION_COORDS = {
  GK:  { x: 50, y: 91 },
  CB1: { x: 38, y: 76 },
  CB2: { x: 62, y: 76 },
  LB:  { x: 15, y: 70 },
  RB:  { x: 85, y: 70 },
  CDM: { x: 50, y: 58 },
  CM:  { x: 30, y: 44 },
  CAM: { x: 70, y: 44 },
  LW:  { x: 15, y: 22 },
  ST:  { x: 50, y: 15 },
  RW:  { x: 85, y: 22 },
};
