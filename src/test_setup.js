// Vitest setup. Imported once via vite.config.js `test.setupFiles`.
// Brings in jest-dom's custom matchers (toBeInTheDocument,
// toHaveTextContent, etc.) so component tests can assert on the
// rendered DOM with the standard RTL idioms instead of hand-rolling
// `expect(el.textContent).toMatch(...)`.
import '@testing-library/jest-dom/vitest';
