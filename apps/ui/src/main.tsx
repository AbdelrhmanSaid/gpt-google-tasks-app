// Load Tailwind and the shared theme before rendering the UI.
import './styles.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';

const root = document.getElementById('root');

if (!root) {
  throw new Error('The UI entrypoint requires a #root element.');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
