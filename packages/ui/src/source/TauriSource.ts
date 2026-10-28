// DocumentSource inside the leaf app's window: messages go to the Rust core
// through a Tauri command and come back as events on this window's channel.
// No socket, no origin; the protocol is the same.
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  PROTOCOL_VERSION,
  parseServerMessage,
  type ClientMessage,
  type ServerMessage,
} from '@leaf/protocol';
import { Listeners, type DocumentSource, type SourceStatus } from './DocumentSource.js';

export class TauriSource implements DocumentSource {
  private messages = new Listeners<ServerMessage>();
  private statuses = new Listeners<SourceStatus>();
  private backlog: ServerMessage[] = [];
  private unlisten: UnlistenFn | null = null;
  private closed = false;
  status: SourceStatus = 'connecting';

  constructor(private readonly window: string = 'main') {
    void listen<unknown>(`leaf://message/${window}`, (e) => this.receive(e.payload)).then((off) => {
      if (this.closed) return off();
      this.unlisten = off;
      this.send({ type: 'hello', protocol: PROTOCOL_VERSION });
      this.setStatus('open');
    });
  }

  private receive(payload: unknown) {
    let msg: ServerMessage;
    try {
      msg = parseServerMessage(payload);
    } catch (e) {
      console.warn('leaf: dropped unreadable message', e);
      return;
    }
    if (this.messages.size === 0) this.backlog.push(msg);
    else this.messages.emit(msg);
  }

  private setStatus(s: SourceStatus) {
    this.status = s;
    this.statuses.emit(s);
  }

  send(msg: ClientMessage): void {
    void invoke('leaf_send', { window: this.window, msg }).catch((e) =>
      console.warn('leaf: send failed', e),
    );
  }

  onMessage(handler: (msg: ServerMessage) => void): () => void {
    const off = this.messages.add(handler);
    for (const m of this.backlog.splice(0)) this.messages.emit(m);
    return off;
  }

  onStatus(handler: (status: SourceStatus) => void): () => void {
    const off = this.statuses.add(handler);
    if (this.status !== 'connecting') handler(this.status);
    return off;
  }

  close(): void {
    this.closed = true;
    this.unlisten?.();
    this.unlisten = null;
    this.setStatus('closed');
  }
}

/** True inside the leaf app's webview. */
export function inTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** This window's label, set by the app before the UI runs. */
export function tauriWindowLabel(): string {
  return (window as unknown as { __LEAF_WINDOW__?: string }).__LEAF_WINDOW__ ?? 'main';
}

let shown = false;
/** Tells the app this window has painted, so it shows it (windows open hidden). Once per window. */
export function windowReady(): void {
  if (shown || !inTauri()) return;
  shown = true;
  void invoke('leaf_ready').catch(() => {});
}

/**
 * The app window cannot follow a link off the app: web and mail links open in the
 * system's browser or mail client instead. Returns a function that stops it.
 */
export function openExternalLinks(root: Document = document): () => void {
  const onClick = (e: MouseEvent) => {
    const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!a) return;
    const href = a.getAttribute('href') ?? '';
    if (!/^(https?:|mailto:)/i.test(href)) return;
    e.preventDefault();
    void invoke('leaf_open_url', { url: href }).catch(() => {});
  };
  root.addEventListener('click', onClick);
  return () => root.removeEventListener('click', onClick);
}
