// The app: one Reader bound to the leaf core, through Tauri in the app's window
// or a WebSocket in a browser.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/leaf.css';
import { Reader } from './components/Reader.js';
import { WsSource } from './source/WsSource.js';
import { useNotice } from './store/notice.js';
import { savedShareName, shareBase, wsUrl } from './share/path.js';
import { TauriSource, inTauri, openExternalLinks, tauriWindowLabel } from './source/TauriSource.js';

// A link of a kind not allowed in Settings says so at the foot of the window.
if (inTauri()) openExternalLinks(document, (scheme) => useNotice.getState().linkRefused(scheme));
// The app sets the window's label before the UI runs.
// A share's page (/s/<id>/…) reads through the relay, under the share's path.
const source = inTauri()
  ? new TauriSource(tauriWindowLabel())
  : new WsSource(wsUrl(location), { name: savedShareName() });
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Reader source={source} base={inTauri() ? '' : shareBase(location.pathname)} />
  </StrictMode>,
);

// Load the highlighter while the first document is still on its way.
void import('./render/highlight.js').then((h) => h.warmHighlighter());
