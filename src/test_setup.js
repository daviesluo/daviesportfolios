// Vitest setup. Imported once via vite.config.js `test.setupFiles`.
// Brings in jest-dom's custom matchers (toBeInTheDocument,
// toHaveTextContent, etc.) so component tests can assert on the
// rendered DOM with the standard RTL idioms instead of hand-rolling
// `expect(el.textContent).toMatch(...)`.
import '@testing-library/jest-dom/vitest';

// RTL unmounts what a test rendered only when vitest's globals are on, and they are off, so
// every component and hook a test mounted stayed mounted for the rest of its file: a hook's
// poll from one test counted in the next (charts/use_ticker_chart_data.test.jsx pins it).
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
afterEach(() => { cleanup(); });
