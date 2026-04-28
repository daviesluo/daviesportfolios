// Vite entry. Side-effect-imports each legacy module in load order so the
// `window.X = X` pattern they all use ends up wired correctly. Once the
// modules are converted to proper imports/exports this file becomes the
// single ReactDOM-render call site and nothing else.

// 1. setup.js bridges npm React/ReactDOM onto window.* so the legacy
//    `React.useState(…)` calls keep working without per-file imports.
import './setup.js';

// 2. CSS — Vite extracts and includes via a <link> tag at build time.
import './styles.css';

// 3. Plain JS modules (no JSX inside).
import './utils.js';   // window.Utils
import './data.js';    // window.INITIAL_PORTFOLIO, window.INITIAL_LOTS

// 4. JSX modules — order matters because some attach to window before App
//    references them.
import './header_sidebar.jsx';   // Header, Sidebar, MarketConditions, etc.
import './pitch.jsx';            // Pitch
import './heatmap.jsx';          // Heatmap
import './modals.jsx';           // *Modal components
import './app.jsx';              // App (must be last — depends on the rest)

const root = window.ReactDOM.createRoot(document.getElementById('root'));
root.render(<window.App />);
