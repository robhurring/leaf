// The app window's chrome page: its own small entry, over the window's tab webviews.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/leaf.css';
import { Chrome } from './Chrome.js';
import { tauriBridge } from './bridge.js';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Chrome bridge={tauriBridge} />
  </StrictMode>,
);
