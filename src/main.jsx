// Vite entry — imports App and mounts it. All cross-module wiring is now
// done via standard ES imports inside each module; the legacy `window.X`
// bridge (setup.js, side-effect imports) is gone.
import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import App from './app.jsx';

createRoot(document.getElementById('root')).render(<App />);
