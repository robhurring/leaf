// The app: one Reader bound to the leaf core, through Tauri in the app's window
// or a WebSocket in a browser.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/leaf.css';
import { Reader } from './components/Reader.js';
import { WsSource } from './source/WsSource.js';
import { TauriSource, inTauri, openExternalLinks, tauriWindowLabel } from './source/TauriSource.js';

export function wsUrl(loc: Location = location): string {
  const override = new URLSearchParams(loc.search).get('ws');
  if (override) return override;
  return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}/ws`;
}

if (inTauri()) openExternalLinks();
// The app sets the window's label before the UI runs.
const source = inTauri() ? new TauriSource(tauriWindowLabel()) : new WsSource(wsUrl());
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Reader source={source} />
  </StrictMode>,
);

// Load the highlighter while the first document is still on its way.
void import('./render/highlight.js').then((h) => h.warmHighlighter());
