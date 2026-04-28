// Bridge between the npm-installed React/ReactDOM and the legacy globals
// pattern the existing files still rely on. Imported first by main.jsx so
// `window.React.useState(…)` etc. is wired up before any other module runs.
//
// Once the codebase is fully converted to ES modules with explicit React
// imports, this file can go away.
import React from 'react';
import * as ReactDOMClient from 'react-dom/client';

window.React = React;
window.ReactDOM = ReactDOMClient;
