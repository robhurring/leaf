// A DocumentSource backed by a plain function: for hand-rolled sources in host
// apps and for tests. `push` lets the host emit unsolicited server messages
// (for example `changed`) at any time.
import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from '@leaf/protocol';
import { Listeners, type DocumentSource, type SourceStatus } from './DocumentSource.js';

export type SourceImpl = {
  handle(msg: ClientMessage, emit: (m: ServerMessage) => void): void | Promise<void>;
};

export type FunctionSource = DocumentSource & { push(msg: ServerMessage): void };

export function createSource(impl: SourceImpl): FunctionSource {
  const messages = new Listeners<ServerMessage>();
  const statuses = new Listeners<SourceStatus>();
  let greeted = false;
  const emit = (m: ServerMessage) => messages.emit(m);
  const source: FunctionSource = {
    send(msg) {
      void impl.handle(msg, emit);
    },
    onMessage(handler) {
      const off = messages.add(handler);
      if (!greeted) {
        greeted = true;
        // Behave like a socket that just opened: the handshake runs once a listener exists.
        queueMicrotask(() => source.send({ type: 'hello', protocol: PROTOCOL_VERSION }));
      }
      return off;
    },
    onStatus(handler) {
      const off = statuses.add(handler);
      handler('open');
      return off;
    },
    close() {
      statuses.emit('closed');
    },
    push: emit,
  };
  return source;
}
