# leaf — Design

Status: draft for author review · 2026-10-24

Markers: _(author)_ = decided by the author in conversation. _(my call)_ = decided by the designer; reviewable. Unmarked = follows directly from the above.

---

## 1. Intent

`leaf` is a first-class markdown reader in the browser. You run `leaf open README.md` or `leaf open docs/`, a local server starts, the browser opens, and the document renders at GitHub quality: highlighted code, mermaid, plantuml, excalidraw, tables, task lists, math, alerts, footnotes. As you edit the file on disk the page updates in real time over a WebSocket.

### Why

The author uses a tool like this at work ("focal": `focal open <doc|folder>`), hence `leaf open`, and wants their own, open version to take home. _(author)_

### The one architectural rule _(author)_

The WebSocket is the lifeline to the UI. When run as `leaf`, the frontend has exactly one dependency: a WebSocket speaking the document protocol in §5. It does not know or care whether the server behind that socket reads from the author's disk or forwards from a remote server that speaks the same protocol. Where data comes from is a backend concern, hidden behind one interface (§6.2).

The same discipline on the frontend: the UI talks to a `DocumentSource` interface (§7.1), of which the WebSocket client is one implementation. A static HTTP implementation lets the whole UI run on a static host with no server at all. _(author: embeddable)_

Rendering lives entirely in the frontend. The backend never parses markdown.

---

### Three parts, one protocol _(author, Oct 27)_

leaf is three parts that only meet at the protocol:

1. **The front-end**: React components, a zustand store, and a `DocumentSource` that is literally the message protocol (`send(ClientMessage)`, `onMessage(ServerMessage)`). It does not know where messages come from.
2. **A backend**, pluggable: the Node server speaks the protocol over a WebSocket (local disk today, relay later). A **Tauri** shell is the next backend to explore: the same React UI in a native window, fed by a `DocumentSource` whose transport is Tauri events/IPC instead of a socket (a Rust core, or the Node server as a sidecar). The WebSocket transport stays for browsers, agents, and the relay.
3. **No backend**: a static site (GitHub Pages) uses a `StaticSource` over pre-rendered JSON, with fewer guarantees and no realtime.

Themes follow the same split: the chrome (bar, sidebars, controls) is fixed and only has light and dark; a theme defines how the document reads (`--leaf-doc-*` tokens). Four ship: `github` (default; github.com's markdown-body look, so a README reads the same here as there), `glass`, `card`, `paper`.

## 2. Goals, non-goals, anti-goals

**Goals**

- Everything GitHub renders in a `.md` file renders here, at least as well. _(author)_
- Real-time updates as the file changes on disk. _(author)_
- Single file or folder of files. _(author)_
- Images and relative links resolve correctly. _(author)_
- Non-markdown files still display: text files as a read-only IDE-style code view; images and other binaries natively. _(author)_
- Diagram zoom-in and annotations. _(author)_
- Custom inline highlighting such as `#topic` and `@user`. _(author)_
- Toggleable outline, header anchors, toggleable outline numbering (`1, 1.1, 1.1.1`). _(author)_
- Text size control in the title bar (`−  100%  +`). _(author)_
- Interactive tables: resizable columns, sortable headers, and an opt-in filter bar via `<!-- table:filter -->`. _(author)_
- Copy any diagram to the clipboard as an image. _(author)_
- A very clean UI with custom SVG icons. _(author)_
- Clean separation: UI (React + zustand) from backend (server + WebSocket + events). _(author)_
- Backend is clean, modular, 12-factor. _(author)_
- Pluggable: fenced-block renderers (` ```custom `), inline regex matchers (`@user → fn(user) → url`), markdown parser extensions, new protocol event types. _(author)_
- **Widespread format support.** Not just markdown: open a `.mmd`, `.puml`, `.excalidraw`, `.ipynb`, `.geojson`, `.csv`, `.svg`, `.stl`… file on its own and get a rich view; embed the same content in markdown and get an inline view with a "zoom-in" to that rich view. _(author)_
- **Embedded ⇄ standalone parity.** Every viewer works both as a whole-file view and as a fenced block, and the zoom-in from a block opens the whole-file experience in a pop-up panel. _(author; §7.7)_
- A command palette to search headings and jump to them (and switch files when there is a tree). _(author)_
- **Embeddable.** The UI controls and rendering engine work without a WebSocket, so a static site (e.g. GitHub Pages) can use `leaf` as its markdown engine. _(author)_
- **Themeable.** Light and dark built in; an embedding site can supply its own theme without forking. _(author)_

**Non-goals (v1)**

- Editing. This is a reader.
- Sharing / multi-user / remote sources. The design leaves the seam; the implementation is disk only. _(author: "starting small — just do a file off disk")_
- Runtime-loaded plugins from `~/.config`. Plugins are source files in this repo registered at build time. _(my call; the registry shape allows runtime loading later)_
- Sharing annotations with other viewers. Local only in v1; the event shapes are ready for it. _(my call; see §8.6)_

**Anti-goals**

- The backend learning anything about markdown, diagrams, or rendering.
- The frontend learning anything about the filesystem, paths on disk, or where bytes come from.
- A monolithic server file. Transport, source, watcher, events, and config are separate modules with one responsibility each.

---

## 3. Constraints and stack

- **Language:** TypeScript everywhere, running on **Node 22 LTS**. _(author: TypeScript on Node, not Bun or Deno.)_ The protocol is one package both sides import, so a new message type is declared once and both sides type-check against it. The server is published as an npm package whose build includes the compiled UI as static assets, so `npm i -g @leaf/cli` (final npm name to be chosen; `leaf` itself is taken) (or `npx`) gives a `leaf` command with nothing else to install. Node's single-executable build is an optional later step, not v1.
- **Tooling:** npm workspaces (no extra package manager; matches the author's other projects); `tsx` for dev; `tsup` (esbuild) to bundle the server; `ws` for WebSockets; `chokidar` for watching; `dotenv` for all configuration. _(my call; dotenv is author's)_
- **Binstubs:** `bin/setup`, `bin/dev`, `bin/test`, `bin/build`, `bin/lint`, `bin/run` (= `leaf open` from source), matching the author's other projects: bash, `set -euo pipefail`, `cd` to the repo root, a `usage()`, `.env.example` copied to `.env` on first run. _(author: consistent with others)_
- **Frontend:** React 19, zustand, Vite. _(author: React + zustand + WebSocket)_
- **Markdown pipeline:** unified / remark / rehype. _(my call)_ It is the only ecosystem with GFM parity, is plugin-based by construction, and lets inline matchers and parser extensions be ordinary plugins.
- **Highlighting:** shiki with the GitHub light/dark themes, same grammars as GitHub. _(my call)_
- **Code files:** CodeMirror 6, read-only. _(author)_
- **Diagrams:** `mermaid` in the browser; `@excalidraw/excalidraw` export-to-SVG in the browser; PlantUML only when `PLANTUML_URL` is set, otherwise the source is shown. _(author)_
- **Styling:** Tailwind CSS (v4) for layout and chrome, with every color, radius, and font coming from CSS custom properties so themes override tokens, not classes. _(author: "tailwind is fine, I use it a lot")_ Rendered markdown is styled by `leaf.css` (plain CSS against the token set) rather than utility classes, since the HTML comes from the pipeline. Light and dark themes follow the OS with a manual override.
- **Icons:** hand-drawn SVG React components in `ui/src/icons/`. No icon library. _(author: custom SVG icons)_
- **Repo:** npm workspaces monorepo.

```
leaf/   (currently ~/code/read)
  bin/          binstubs (§3)
  examples/     living demo corpus; `leaf open examples` (§9)
  packages/
    protocol/     @leaf/protocol — zod schemas + TS types + JSON Schema export     (no deps on either side)
    server/       leaf-md (npm name; bin `leaf`) — Node server: cli, config, source, watcher, events, transport
    ui/           @leaf/ui — React library + app shell
  .superpowers/specs/
```

---

## 4. Core principle _(author)_

> **Rendering engine at the heart. Theme wraps it. WebSocket pushes state from a backend: our server, or a relay to a remote one.**

Concentric layers, each unaware of the one outside it:

1. **Engine** (`render/`): markdown string + registries → React elements. Pure. No store, no network, no theme knowledge beyond CSS class names.
2. **Theme** (`leaf.css` + tokens): wraps the engine and the controls in CSS custom properties. Swappable without touching 1.
3. **Controls** (`components/`, `viewers/`, `stage/`, `store/`): title bar, sidebars, palette, Stage. Read from the store only.
4. **Source** (`source/`): fills the store. `WsSource` from a socket; `StaticSource` from plain HTTP.
5. **Backend** (`packages/server`): on the other end of the socket. `DiskSource` today; a relay/`RemoteSource` to another server later. Moves bytes and events, never renders.

| Backend (mechanism)                             | Protocol (contract)       | Frontend (meaning)                       |
| ----------------------------------------------- | ------------------------- | ---------------------------------------- |
| Walk a directory, read files, watch for changes | `tree`, `file`, `changed` | Parse markdown, highlight, draw diagrams |
| Serve raw bytes over HTTP for `<img>`           | `/raw/<path>`             | Resolve relative links and images        |
| Accept WebSocket clients, fan out events        | typed messages            | zustand store, React views               |
| Config from env + flags                         | `welcome.config`          | plugin registries, UI preferences        |

---

## 5. The document protocol (`packages/protocol`)

JSON messages over one WebSocket at `/ws`. Every message is `{ "type": string, ...payload }`. Paths are always **relative to the served root, POSIX-separated, no leading slash**, so the frontend never sees a disk path. Version negotiation in `hello`/`welcome`; v1 = `1`.

### 5.1 Client → server

| type          | payload                         | meaning                                                                                                                                                                                            |
| ------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hello`       | `{ protocol: 1 }`               | first message; server replies `welcome`                                                                                                                                                            |
| `list`        | `{ path?: string }`             | request one directory level (`path` omitted = root). The client expands folders by listing them; the server never walks a whole repo on connect. _(author: `leaf open .` on a full repo is valid)_ |
| `read`        | `{ path: string }`              | request a file's content                                                                                                                                                                           |
| `subscribe`   | `{ path: string }`              | receive `changed` for this path (and, for a directory, its children)                                                                                                                               |
| `unsubscribe` | `{ path: string }`              | stop                                                                                                                                                                                               |
| `search`      | `{ q: string, limit?: number }` | fuzzy file-path search under the root honoring ignores; reply `matches { q, entries: Entry[] }` _(my call; needed because the tree is lazy)_                                                       |

### 5.2 Server → client

| type      | payload                                                                                                                                               | meaning                                                                                                                                                                                       |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `welcome` | `{ protocol: 1, root: { kind: "file" \| "dir", name: string }, config: Config }`                                                                      | `config` carries frontend-relevant settings (§7.3)                                                                                                                                            |
| `tree`    | `{ path: string, entries: Entry[] }`                                                                                                                  | one level of `path`. `Entry = { path, name, kind: "file" \| "dir", size?, mtime?, hasChildren?: boolean }`. Sorted dirs-first, case-insensitive.                                              |
| `file`    | `{ path, kind: FileKind /* viewer id, §7.7 */, lang?: string, encoding: "utf8" \| "none", content?: string, url: string, mime: string, size, mtime }` | `kind ∈ markdown \| text \| image \| media \| pdf \| binary`; `mime` lets the UI pick a native element for `media`. Text-like kinds carry `content`; every kind carries `url` (`/raw/<path>`) |
| `changed` | `{ path, change: "created" \| "modified" \| "deleted" \| "renamed", from?: string }`                                                                  | watch event; client decides whether to re-`read`                                                                                                                                              |
| `error`   | `{ code: string, message: string, path?: string, inReplyTo?: string }`                                                                                | `code ∈ not_found \| outside_root \| unsupported \| bad_request \| internal`                                                                                                                  |

Every message may carry an optional `id`; a reply echoes it as `inReplyTo`. _(my call; cheap and makes request/response in the client trivial.)_

### 5.3 Raw assets over HTTP

`GET /raw/<path>` serves the bytes of any file in the tree with the right `Content-Type`. This is how `<img src="./diagram.png">` works without going through the WebSocket, and how PDFs and other binaries display. Paths are confined to the root; `..` and symlinks escaping the root return 403.

### 5.3a Static hosting profile _(author: embeddable)_

A static site provides the same shapes without a socket: `tree.json` holding a `tree` message's `entries`, and each file served at its path. `StaticSource` (§7.1) reads these. A small `leaf export <dir>` command can generate `tree.json` plus a copy of the files so a GitHub Pages deploy is one step; it is a backend module that reuses `DiskSource`. _(my call; cheap and makes "embeddable" real on day one.)_

### 5.4 Extensibility _(author: "ability to extend down the road to new event types")_

- Every message type is a zod schema in `packages/protocol/src/messages/<type>.ts` and is registered in a discriminated union `ClientMessage` / `ServerMessage`.
- `preferences` (client → server): a patch of reader settings (theme, appearance, treeOpen, outlineOpen, numbering, textPct). The server merges it into `preferences.json` under the config dir and sends the stored set back in `welcome.preferences`; a welcome that carries it tells the client the server keeps preferences, so the client applies them over localStorage and mirrors later changes. Without it (static sites), localStorage alone. _(author: settings must be sticky; my call to keep them server-side so they survive ports and folders)_
- **Assets over the socket** _(author, Oct 27)_: a `file` reply for a binary at or under `LEAF_MAX_INLINE_BYTES` carries `encoding: "base64"` and the bytes in `content`, so a client with no HTTP path to the server (a relay, a Tauri shell) can show images, audio, video and PDFs. `capabilities.rawUrls` says the server also serves `/raw/<path>` over HTTP; the UI then uses those URLs for documents' images and skips the socket. Without it, each referenced asset is read over the socket once and shown from an object URL; a 1x1 placeholder stands in while the bytes travel.
- Adding a type: add the schema file, add it to the union, implement the handler on the side(s) that consume it. The transport layer dispatches on `type` through a handler map and does not need editing.
- Unknown message types are ignored with a logged warning, not a disconnect, so older clients and newer servers coexist.
- `npm run schema -w packages/protocol` writes `packages/protocol/schema/*.json` (JSON Schema) so a server in another language can implement the protocol. _(my call)_

### 5.4a Future collaborative events _(author: "not for day-1, but composable enough")_

Later versions will carry events like: a remote viewer's presence and text highlight, `comment` on a range, `suggestion` (a proposed patch, GitHub-PR style), and client actions `resolve` (a comment) and `accept` / `reject` (a suggestion). Nothing in v1 implements them. V1 must not make them hard, so these decisions are made now:

- **Messages are bidirectional and symmetric.** Client → server messages are not only requests; they can be _actions_ (`accept`, `resolve`). Server → client messages are not only replies; they can be _events_ from other participants. The dispatch maps on both sides are the same shape, so an action is one schema file plus one handler on each side.
- **Capabilities in `welcome`.** `welcome.capabilities: { watch: boolean, write: boolean, collaborate: boolean }`. The UI shows controls only for what the backend can do. `DiskSource` v1 reports `{ watch: true, write: false, collaborate: false }`. Accepting a suggestion later needs `write`, so the `Source` interface declares `write(path, content)` as optional from day one.
- **Anchors are source ranges, not DOM nodes.** Every future collaborative payload refers to a document location as `{ path, range: { start: { line, column, offset }, end: {…} }, quote?: string }` in the _markdown source_, with an optional text quote for re-anchoring after edits. To make that possible the renderer keeps source positions in the output (§7.6).
- **Participants are first-class.** A `Participant = { id, name, color? }` type exists in the protocol now, with the local user as the only member in v1, so presence and attribution later do not change existing shapes.

### 5.5 Remote servers _(author)_

A remote server that speaks §5.1–5.3 is a drop-in for the local one. The frontend is given the WebSocket URL at boot (default: same origin `/ws`; overridable by `LEAF_WS_URL` passed through to the UI at build or via a query parameter `?ws=`). The backend may later gain a `RemoteSource` (§6.2) that dials another server's `/ws` and re-exposes it locally; that is a backend module, not a frontend change.

---

## 6. Backend (`packages/server`)

### 6.1 12-factor _(author)_

- **Config:** `.env` loaded with dotenv (repo root in dev; the current directory when running the installed CLI), overridden by real environment variables, overridden by CLI flags. _(author: "use dotenv for everything")_ Defaults are sensible for `leaf open README.md`.
- **Processes:** one stateless process. Nothing written to disk. Restart-safe.
- **Port binding:** self-contained HTTP server; no external web server.
- **Logs:** event streams to stdout, never to files; the process is the log. See §6.1a.
- **Disposability:** fast start, clean shutdown on SIGINT/SIGTERM (closes watchers and sockets).
- **Dev/prod parity:** in prod the server serves the built UI; in dev the Vite dev server fronts the page and proxies `/ws` and `/raw` to the leaf server, so the server code path is identical and only the static handler is bypassed. _(my call)_

Variable names: conventional names where a convention exists (`PORT`, `HOST`, `LOG_LEVEL`, `PLANTUML_URL`), `LEAF_` prefix for leaf-only knobs. _(my call)_

| env                                   | flag                         | default                       | meaning                                                                                                                                                                             |
| ------------------------------------- | ---------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HOST`                                | `--host`                     | `127.0.0.1`                   | bind address                                                                                                                                                                        |
| `PORT`                                | `--port`                     | `4321`                        | bind port. A stable default keeps the browser's sticky settings (localStorage is per origin); when the default is busy the server falls back to a free port, an explicit port fails |
| `LOG_LEVEL`                           | `-l`, `--log-level`          | `warn`                        | `debug \| info \| warn \| error`. Quiet by default since leaf is a CLI first; `-l info` for routine traffic _(author)_                                                              |
| `LOG_FORMAT`                          | `--log-format`               | `text`                        | `text` (human) or `json` (one object per line)                                                                                                                                      |
| `PLANTUML_URL`                        | `--plantuml-url`             | unset                         | PlantUML server base. **Unset = plantuml blocks and `.puml` files show their source in a code view with a hint; set = rendered.** _(author)_ Passed to the UI via `welcome.config`. |
| `LEAF_OPEN`                           | `--open/--no-open`           | `true`                        | open the browser on start                                                                                                                                                           |
| `LEAF_IGNORE`                         | `--ignore`                   | `.git,node_modules,.DS_Store` | gitignore-style patterns always skipped, in addition to `.gitignore`                                                                                                                |
| `LEAF_GITIGNORE`                      | `--gitignore/--no-gitignore` | `true`                        | honor `.gitignore` files under the root (nested ones too)                                                                                                                           |
| `LEAF_MAX_ENTRIES`                    | —                            | `5000`                        | cap for expand-all and search results                                                                                                                                               |
| `LEAF_MAX_INLINE_BYTES`               | —                            | `2 MiB`                       | larger text files are not sent over the socket                                                                                                                                      |
| `LEAF_ANNOTATION_TTL`                 | —                            | `24h`                         | how long sticky drawings last (§8.6)                                                                                                                                                |
| `LEAF_MENTION_URL` / `LEAF_TOPIC_URL` | —                            | unset                         | templates for `@user` / `#topic` links, e.g. `https://x.com/{username}`                                                                                                             |

CLI: `leaf open [path]` (default `.`). _(author: `leaf open <…>` is the primary form.)_ A bare `leaf [path]` is a shorthand for `open`. _(my call.)_ **`leaf` is a command, not a server** _(author, Oct 27)_: `leaf open` starts a detached server (or reuses one already serving that folder, found through `<config-dir>/instances/<pid>.json` plus a liveness check), prints the URL, opens the browser, and returns to the shell. The detached server logs to `<config-dir>/logs/leaf.log` and stops itself: 2 minutes with no client ever, or `LEAF_IDLE_TIMEOUT` (default `10s`) after the last tab disconnects, so closing the tab ends the process while a reload survives. `leaf serve [path]` is the foreground form (logs on stdout, runs until ctrl-c, never idles out unless `--idle-timeout` is set); an explicit `-l` on the command line also keeps the foreground, since the point of raising the level is to watch. _(my call on the mechanics.)_ Other subcommands: `leaf export <dir>` (§5.3a) now; `leaf share <path>` reserved for later. `cli.ts` is a small subcommand table so adding one is one file.

**Directory argument.** The folder is the root. `tree` lists it, the file sidebar shows when it holds more than one file, and `README.md` / `index.md` / the first markdown file opens by default. _(my call on the default-open rule)_

**File argument** (`leaf README.md`). _(my call, resolving an ambiguity the builder check found.)_ The file's parent directory is the root for _path resolution_: `/raw/<path>` and `read { path }` accept any path under it, so sibling images and relative links work. But `tree` returns only the one opened file, `welcome.root.kind = "file"`, and the file sidebar is hidden. Following a relative link to a sibling `.md` opens it in-app (the title bar breadcrumb shows where you are; the browser back button returns). This means `leaf ~/Downloads/notes.md` makes all of `~/Downloads` readable over the loopback server to whoever asks it by exact path; it is not listed. Acceptable for a local tool bound to 127.0.0.1, and stated here so nobody is surprised. A remote server implementing the protocol makes its own choice; the protocol only requires that `tree` and `/raw` agree with each other about the root.

### 6.1a Logging _(author: 12factor.net, especially logs)_

The server writes one event per line to stdout and treats it as a stream; it never manages log files, rotation, or destinations. `leaf open` runs in the foreground, so the terminal that launched it _is_ the tail: `leaf open -l debug examples` streams everything to the terminal you're sitting at. _(author)_ Readable text lines by default (`LOG_FORMAT=text`, colored when stdout is a TTY); `LOG_FORMAT=json` (or `--log-format json`) gives one JSON object per line for `jq` and process managers. _(author: default to text)_

Levels:

- **`error`** — something failed that the user should know about (bind failure, unreadable root, handler crash).
- **`warn`** — recoverable oddities (unknown message type, symlink escape rejected, file over the inline cap).
- **`info`** (default) — routine server events, one line each: listening on host:port, root resolved, client connected / disconnected, document opened (`read`), change detected (`changed`), `/raw` served, shutdown. Short fields: path, client id, duration. _(author: "routine server logs")_
- **`debug`** — everything above plus **full payloads**: every WebSocket message in and out, complete and unredacted (JSON as sent, including `content`), every watcher raw event before debounce, every config value at startup with its source (default / .env / env / flag), and HTTP request/response lines for `/raw` and static assets. Meant for inspection; nothing is truncated. _(author: "should show full payloads to be inspected")_

Each line carries `time`, `level`, `msg`, and a `client` id when a socket is involved, so a session's traffic can be grepped out of the stream. `LOG_LEVEL` in `.env` sets the default (`warn`, so a plain `leaf <doc>` prints only the URL, which is the command's output rather than a log line); `-l info` or `-l debug` on the command line overrides it for one run.

### 6.2 Modules (one responsibility each)

```
server/src/
  cli.ts            parse argv → partial Config; print help; exit codes
  config.ts         env + flags → validated Config (zod)
  log.ts            structured logger
  source/
    Source.ts       interface: root(), list(), read(path), watch(path, cb) → unsubscribe
    DiskSource.ts   walks a directory, reads files, classifies kind, uses the watcher
    RemoteSource.ts (future) dials another server's /ws and re-exposes it; not built in v1
    classify.ts     path → FileKind + lang (by extension; text sniffed when unknown)
  watch/
    Watcher.ts      chokidar with debounce + rename detection → typed events
  events/
    Bus.ts          typed pub/sub keyed by event name; the only way modules talk to each other
  transport/
    http.ts         static UI, /raw/<path>, /healthz; nothing else
    ws.ts           one Session per socket: hello handshake, dispatch map type → handler, forwards Bus events to subscribers
    handlers/       one file per client message type (list.ts, read.ts, subscribe.ts, …)
  main.ts           wires config → source → bus → transports; starts; opens browser; handles signals
```

Rules:

- `transport/` imports `Source` and `Bus`, never `DiskSource` or `fs`.
- `source/` never imports `transport/`.
- Handlers are pure functions of `(session, message, deps)`; adding a message type is one file plus one line in the dispatch map.
- The `Bus` event set is typed; adding an event type is adding to that type, and the WebSocket session forwards any bus event that has a protocol message mapping.

### 6.3 Large folders _(author: `leaf open .` on a working repo is a real use)_

- `list` is one directory level at a time; the UI expands folders on click (and "expand all" expands lazily, breadth-first, stopping at `LEAF_MAX_ENTRIES`, default 5000, with a hint in the tree). _(my call on the cap)_
- `.gitignore` is honored by default, with `--no-gitignore` to bypass. _(author)_ Semantics follow the `ignore` npm package, nested files included. `LEAF_IGNORE` (default `.git,node_modules,.DS_Store`) applies regardless of the gitignore flag, so `.git` and `node_modules` are never walked unless the user empties that list on purpose. Ignored entries are neither listed nor watched nor served by `/raw` unless they are the file that was explicitly opened.
- The watcher watches the root with the same ignore set as chokidar `ignored` globs, so `node_modules` and build output never register handlers. Watch events for unlisted (not-yet-expanded) folders are dropped.
- The command palette's file search queries the server (`search { q }` message, _my call_, added to §5.1) rather than needing the whole tree client-side; the server walks lazily with the same ignore rules and caps results.

### 6.4 Security

Local tool, bound to loopback by default. Still: path confinement under the root (`/raw` and `read` both), symlink escape rejected, no directory listing outside the tree the protocol exposes, file size cap for `content` over the socket (`LEAF_MAX_INLINE_BYTES`, default 2 MiB; larger text files are offered via `url` with `kind: "binary"`-style handling in the UI). _(my call)_

---

## 7. Frontend (`packages/ui`)

### 7.1 Layers and packaging _(author)_

`packages/ui` is a **React library**, and the `leaf` CLI's page is its smallest consumer. The library is the primary deliverable for embedding; a host app (a GitHub Pages site, a docs portal) renders it with no leaf backend and no WebSocket and gets the same reader, the same tree and outline toggles, the same palette and Stage. _(author)_

**The source is the protocol.** The library does not know about transports. It takes a `DocumentSource`, which is nothing more than the two halves of §5:

```ts
interface DocumentSource {
  send(msg: ClientMessage): void; // hello, list, read, subscribe, unsubscribe, search, …
  onMessage(handler: (msg: ServerMessage) => void): () => void; // welcome, tree, file, changed, matches, error, …
  close(): void;
}
```

Whatever answers those messages is a source: `WsSource` forwards them over a socket; `StaticSource` answers `list` from a `tree.json` and `read` from `fetch`; a host app can write one in a few lines that answers from memory or from its own API, and can push a `changed` or `file` message whenever it likes to update the view. New event types (§5.4a) flow through the same two methods untouched, so embedding never lags the protocol. _(author: "exposes the events the websocket will hit")_

**Controls are controllable.** `<Reader>` owns its UI state by default (sticky in localStorage) but every piece can be driven by the host: `treeOpen`, `outlineOpen`, `numbering`, `theme`, `path` as optional controlled props with matching `onXChange` callbacks, plus a `useLeaf()` hook exposing the same store for custom chrome. A host can hide leaf's title bar and render its own buttons that call the same actions. _(author: same effects as "toggle file tree", "toggle outline")_

Exports:

- `<Reader source={…} />` — the full UI bound to any `DocumentSource`.
- `<Markdown source={string} … />` — just the engine for one document, with registries, for pages that embed rendered markdown in their own layout.
- `WsSource`, `StaticSource`, `createSource(handlers)` (a helper for hand-rolled sources), the registries, `useLeaf()`, and the extension API (§7.6).
- `leaf.css` — the stylesheet, themeable through CSS custom properties (§8.6a).

Build: Vite library mode, ESM, React as a peer dependency, with mermaid / excalidraw / shiki / KaTeX / CodeMirror languages as lazy chunks so a host pays only for what a document uses. The CLI's page (`main.tsx`) is `<Reader source={new WsSource(url)} />` and is bundled separately as the server's static asset. `leaf export` (§5.3a) copies that same page plus `tree.json` and the files, which is the no-React-app path and is nearly free once the library exists. _(my call to keep export; it is the cheapest "static site" on day one.)_

```
ui/src/
  source/
    DocumentSource.ts   interface the store talks to: connect(), list(), read(), subscribe(), on(event)
    WsSource.ts         wraps the WebSocket; reconnects with backoff; the `leaf` CLI uses this
    StaticSource.ts     fetches a JSON manifest (the protocol's `tree` shape) and files over plain HTTP; `subscribe` is a no-op; for static hosting *(author: embeddable)*
  store/
    documents.ts        zustand: tree, open path, file cache, per-path loading/error
    ui.ts               zustand: panels open, outline numbering, theme, zoom state; persisted to localStorage
    annotations.ts      zustand: sticky strokes per {docPath, blockHash}; persisted to localStorage (§8.6)
  render/
    pipeline.ts         unified: remark-parse → gfm → math → frontmatter → alerts → footnotes → [parser plugins] → rehype → [inline matchers] → sanitize → react
    registries/
      blocks.ts         fenced-block dispatch: lang → viewer (thin view over viewers/registry.ts)
      inline.ts         inline matchers: Array<{ name, pattern, render }>
      parsers.ts        extra remark/rehype plugins
    inline/             mention.tsx (@user), topic.tsx (#topic)
    slug.ts             GitHub-compatible header slugs
  viewers/              one folder per viewer (§7.7): index.ts registers { matches, Inline, Rich, stage, actions }
    markdown/ code/ mermaid/ plantuml/ excalidraw/ image/ notebook/ geojson/ csv/ stl/ media/ binary/
    registry.ts         byExt / byLang / byMime lookups; the §7.3 block registry is a view of this
  stage/
    Stage.tsx           pop-up panel hosting a viewer's Rich component; pan/zoom; tool strip
    Draw.tsx            canvas layer + tools (hand, pencil, arrow, rect, ellipse, text); fade + sticky
  components/
    Layout.tsx, TopBar.tsx, Tree.tsx (with filter), Outline.tsx, Palette.tsx, ConnectionDot.tsx
  icons/                hand-drawn SVG React components
  router.ts             URL ↔ open path (§7.4)
  main.tsx
```

Rules:

- Nothing outside `source/` touches the network. Nothing outside `store/` is a source of truth.
- Nothing in `components/`, `viewers/`, `stage/`, or `render/` imports from `source/`; they would not know a WebSocket exists.
- The library must build and run with `StaticSource` or a hand-rolled source only, with no WebSocket code loaded, so an embedding site pays nothing for the live path.
- `render/` is pure: given a string and the registries, produce React elements. No store access inside renderers, so it is testable without the app.
- Views receive data from the store and never fetch.

### 7.6 Composability for future events _(author)_

- **Source positions survive rendering.** The pipeline carries each node's `position` (from remark) into the DOM as `data-pos="line:col-line:col"` on block and inline elements. A future overlay can map a source range to elements, and a selection in the DOM back to a source range. This costs nothing visible and is on from day one.
- **Overlay layer.** `MarkdownView` renders the document inside an `OverlayHost` that positions children relative to source ranges (via the `data-pos` map). V1 uses it for nothing except the in-view heading highlight; comments, highlights, and suggestion diffs plug in as overlay components later.
- **Extensions.** An extension is `{ name, messages?: zod schemas, store?: slice, overlays?: Overlay[], commands?: PaletteCommand[], toolbar?: Action[] }` registered in one place. Registering an extension wires its handlers into `DocumentSource.on(type)`, its slice into the store, its overlays into `OverlayHost`, and its commands into the palette. The three v1 registries (blocks, inline, parsers) are extensions in this sense; the diagram annotations feature (§8.6) is written as one so it is the worked example.
- **Side rail.** Layout reserves a right-hand rail region (shared with the outline) where comment threads and suggestion cards can stack beside the paragraphs they anchor to, GitHub-style. Empty in v1.

### 7.2 Rendering parity with GitHub

In scope, all on by default: headings, paragraphs, emphasis, lists, task lists, tables, blockquotes, GitHub alerts (`> [!NOTE]` etc.), fenced code with language + highlighting, inline code, links, autolinks, images, strikethrough, footnotes, horizontal rules, HTML passthrough (sanitized like GitHub), emoji shortcodes, math (`$…$`, `$$…$$`) via KaTeX, YAML frontmatter shown as a table at the top, mermaid, plantuml, excalidraw. Relative links to other files in the tree navigate within the app, whatever the file kind (every kind has a viewer); absolute URLs open a new tab. _(changed from "non-markdown opens /raw" after the foundation review)_

### 7.3 Plugin registries _(author)_

**Fenced blocks.** ` ```<lang> ` dispatches on `<lang>`. Registry entry: `{ lang: string | RegExp, render: (code: string, meta: string, ctx) => ReactNode, zoomable?: boolean }`. Built-ins: `mermaid`, `plantuml`, `excalidraw`. Fallback: shiki code block. `ctx` carries `config` from `welcome` (so `plantuml` reads `config.plantumlUrl`) and the document path.

**Inline matchers.** Registry entry: `{ name: string, pattern: RegExp, render: (match: RegExpMatchArray) => ReactNode | { href: string; label?: string } }`. Implemented as one rehype plugin that walks text nodes outside `code`, `pre`, `a` and splits them. Built-ins: `mention` (`@[\w-]+` → styled span, link target from `config.mentionUrl` template if set, e.g. `https://x.com/{username}`), `topic` (`#[\w-]+` → styled span; excludes markdown headings, which are already parsed before this runs). Templates with `{username}` / `{topic}` placeholders come from config so the behavior is the author's example exactly. _(my call on the template mechanism)_

**Parsers.** An ordered array of extra remark/rehype plugins appended to the pipeline. Adding new markdown syntax is adding a plugin file and one line.

**Host callbacks.** _(author: behavior differs between the leaf server and, say, GitHub Pages)_ The registries are defaults. `<Reader>` and `<Markdown>` accept a `handlers` prop that overrides behavior per instance without touching the registries:

```ts
interface Handlers {
  resolveLink?(
    href: string,
    ctx: { docPath: string },
  ): string | { navigate: string } | { external: string };
  onMention?(username: string): { href?: string; label?: string } | ReactNode;
  onTopic?(topic: string): { href?: string; label?: string } | ReactNode;
  renderBlock?(lang: string, code: string, meta: string): ReactNode | undefined; // undefined = fall through to registry
  onUnknownBlock?(lang: string, code: string): ReactNode | undefined; // last resort before the plain code view
}
```

Relative links go through `resolveLink` so a static site can map `./guide.md` to its own routes; the default implementation navigates within the tree for files that exist in it and opens `/raw/` otherwise.

**Config from the server.** `welcome.config` is `{ plantumlUrl, mentionUrl?, topicUrl? }` in v1, shaped by a zod schema in the protocol package so adding a config key is one place.

### 7.4 Routing _(author: real URLs, never query parameters)_

The URL is the document path: `/docs/readme.md#anchor`. `/` is the default document. The hash is the heading slug. Back/forward work. No `?folder=…&file=…` form exists anywhere. `<Reader>` and `StaticSource` take a `base` so a site under `user.github.io/repo/` routes under that prefix.

- **Under the leaf server:** the static handler serves `index.html` for any path that is not `/raw/*`, `/ws`, or a built asset.
- **On a static host** (GitHub Pages has no SPA fallback): `leaf export` keeps document paths free by placing the files under `raw/` and emits `404.html` as a copy of the app, so `/docs/readme.md` falls through to the app, which reads the path from `location`. The response status is 404 but the page is the reader; this is the standard GitHub Pages SPA technique. Hosts with a real fallback (Netlify, Cloudflare Pages) get a `_redirects` file too. _(my call on mechanism)_

`leaf export` therefore writes `index.html`, `404.html`, the files under `raw/`, and `tree.json`, so `StaticSource` resolves every `url` the same way `WsSource` does and nothing in the views changes.

### 7.5 Live updates

On `changed` for the open path the store re-`read`s and re-renders. Scroll position is preserved. Diagram blocks are keyed by a content hash so an unchanged mermaid block does not re-render (mermaid rendering is slow and flickers). On `changed` for a tree path, the tree is refreshed. On `deleted` for the open path the view shows a quiet "file removed" state and recovers when it reappears. On socket loss the connection dot turns amber, the last render stays, and the client reconnects with backoff; on reconnect it re-subscribes and re-reads.

---

### 7.7 Viewers: one renderer, two sizes _(author)_

The same content can be a whole file (`diagram.mmd`) or a fenced block (` ```mermaid `). Both must behave the same, and the block must have a "zoom-in" that opens the whole-file experience in a pop-up panel. _(author)_ So rendering is organized around **viewers**, not around markdown:

```ts
interface Viewer {
  id: string; // "mermaid", "code", "notebook", "geojson", …
  matches: { ext?: string[]; lang?: string[]; mime?: string[] };
  Inline: React.FC<ViewerProps>; // compact, inside a document flow
  Rich: React.FC<ViewerProps>; // full experience: fills the Stage
  stage?: { pan?: boolean; zoom?: boolean; draw?: boolean; tools?: Tool[] }; // what the Stage enables around Rich
  actions?: Action[]; // hover toolbar: copy source, download SVG, …
}
```

- A **file** of kind `x` renders `Rich` directly in the document column, with the Stage's controls (pan, zoom, draw) available in place.
- A **fenced block** renders `Inline`, with a hover toolbar whose first action is **zoom-in**; zoom-in opens the **Stage** (the generalized lightbox) hosting `Rich` for that block's content, with pan/zoom/draw as the viewer declares. Esc closes.
- The "block" registry of §7.3 is the `lang` index of the viewer registry; the file-kind classification of §6.2 is its `ext`/`mime` index. One registration serves both.

Built-in viewers in v1 and what each pair looks like:

| viewer       | ext / lang                          | Inline                                      | Rich (and Stage)                                                                                                         |
| ------------ | ----------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `markdown`   | `.md`, `.markdown`                  | — (documents are the page)                  | the page itself                                                                                                          |
| `code`       | any text ext / any unknown lang     | shiki-highlighted block                     | CodeMirror 6 read-only, line numbers, search, wrap; Stage: none                                                          |
| `mermaid`    | `.mmd`, `.mermaid` / `mermaid`      | rendered SVG                                | SVG; Stage: pan, zoom, draw                                                                                              |
| `plantuml`   | `.puml`, `.plantuml` / `plantuml`   | rendered SVG if `PLANTUML_URL`, else source | same; Stage: pan, zoom, draw                                                                                             |
| `excalidraw` | `.excalidraw` / `excalidraw`        | static SVG export                           | static SVG; Stage: pan, zoom, draw _(my call: not the full Excalidraw editor in v1)_                                     |
| `image`      | raster + `.svg`                     | fit-to-width                                | native size; Stage: pan, zoom, draw                                                                                      |
| `notebook`   | `.ipynb`                            | —                                           | cells rendered: markdown cells through the engine, code cells through `code`, outputs (text, HTML, images, errors) shown |
| `geojson`    | `.geojson`, `.topojson` / `geojson` | map (MapLibre, OSM tiles)                   | map; Stage: map's own controls                                                                                           |
| `csv`        | `.csv`, `.tsv` / `csv`              | table, first N rows                         | sortable table                                                                                                           |
| `stl`        | `.stl`                              | —                                           | three.js viewer; Stage: orbit                                                                                            |
| `media`      | pdf/audio/video mime                | native element                              | native element                                                                                                           |
| `binary`     | everything else                     | —                                           | icon + metadata card                                                                                                     |

Adding a format is adding one viewer file and registering it. The list is the author's "widespread support" goal; the builder may stage the exotic ones (`stl`, `topojson`) after the rest. _(my call)_

## 8. UI behavior

### 8.1 Layout _(author)_

The focus is the rendered markdown; everything else stays out of its way.

- **Title bar.** Left: a toggle for the file tree, then the app's own SVG leaf mark and the document title (first H1, falling back to the file name) with the path beneath. Center: the search / palette field. Right-aligned: text size (`−  100%  +`, click the value to reset) _(author)_, numbering toggle, outline toggle, light/dark toggle, and the live-connection dot.
- **Left sidebar: files.** Shown only when the root contains more than one file; a single opened file never shows it. _(author)_ A folder tree with "expand all" and "collapse all" icons and a **filter box** in its header. _(author)_ Typing in the filter narrows the tree to matching paths: already-loaded entries filter instantly, and the server's `search` fills in matches from folders not yet expanded. The open file is highlighted; folders remember their open state.
- **Center: the document** at a comfortable reading width.
- **Right sidebar: outline.** Shown when toggled on. _(author)_ Same "expand all" / "collapse all" icons for nested headings.
- **Sticky state.** Sidebar visibility, tree open-folders, outline numbering, and theme persist in localStorage. _(author)_
- On narrow viewports the sidebars overlay the document instead of squeezing it. _(my call)_

### 8.1a UX tone _(author: "facebook'y")_

Friendly and obvious. Every control is an icon with a tooltip and a sensible default; nothing needs explaining. Good use of icons over text labels. Hover reveals secondary actions (anchor links, diagram toolbars) rather than showing them always. Common-sense behaviors: clicking the title scrolls to top, clicking a tree file opens it, Esc closes any overlay.

### 8.1b Command palette _(author: "search for header and jump to it")_

_(Revised after the foundation: two palettes.)_ `⌘K` lists the headings of the open document only; `⌘O` lists files when there is a tree. `Ctrl+N` / `Ctrl+P` move like the arrow keys. _(author)_

Cmd/Ctrl+K (and a search icon in the title bar) opens a palette over the document. It fuzzy-matches the open document's headings, showing their depth and number; Enter scrolls to the heading and sets the hash. When there is a tree, the same palette also matches file paths, listed below headings, and Enter opens the file. Arrow keys move, Esc closes. _(my call that one palette does both.)_

### 8.2 Outline

Built from the rendered headings. Click scrolls to the heading and sets the hash. The heading currently in view is highlighted (IntersectionObserver). The numbering toggle prefixes outline entries **and the headings in the document** with `1`, `1.1`, `1.1.1`… computed from heading depth; numbering restarts correctly when depth jumps. _(my call that numbering shows in both places; the author's example implies outline, and matching the document reads cleaner.)_

### 8.3 Anchors

Every heading gets an id from the GitHub slug algorithm (lowercase, strip punctuation, spaces to hyphens, dedupe with `-1`, `-2`). Hovering a heading reveals a small link icon to its left; clicking it sets the hash and copies the URL. In-document `[link](#slug)` works.

### 8.3a Properties panel _(author)_

Every opened file starts with a collapsed **Properties** section: path, size, type, modified time, the last git commit touching the file (the server runs `git log -1` when the root is inside a repository; `file.git` in the protocol), and every frontmatter key as a key/value row. Click to expand.

### 8.3b Keyboard _(author)_

`j`/`k` scroll a line, `Ctrl+D`/`Ctrl+U` half a page (vim), `[`/`]` toggle sidebars, `n` numbering, `t` appearance, `⌘K` headings, `⌘O` files, `Esc` closes overlays.

### 8.4 Non-markdown files

Opening a non-markdown file renders its viewer's `Rich` component in the document column (§7.7): CodeMirror for text _(author)_, native elements for what the browser can display _(author)_, a single icon + metadata card for binaries with nothing to render _(author)_, and the rich views for notebooks, maps, tables, and diagrams. The outline sidebar is empty for these except `notebook` (markdown cell headings) and `code` (symbols, if the language mode provides them; _my call, optional_).

### 8.5 The Stage (zoom-in) _(author)_

Every `Inline` view gets a hover toolbar whose first action is zoom-in. Zoom-in opens the Stage: a pop-up panel over the document hosting the viewer's `Rich` component at full size. A **floating toolbox** (bottom center) carries, per the viewer's declaration: **hand** (drag to pan), **zoom in / zoom out / fit / 100%** controls, and the drawing tools of §8.6; a trackpad **pinch** or a mouse wheel zooms around the cursor and two-finger scrolling pans (classified from the wheel event: ctrl+wheel is a pinch, line-mode or 120-multiple deltas are a mouse); double-click resets; `Esc` or the title bar's close button closes. The Stage is a white panel floating over the dimmed reader, inset 5% on every side (90% of the window), with a small title bar naming the block and its document; viewers render their light appearance on it. Keys while it is open: `1` hand, `2` pencil, and holding `space` borrows the hand (release returns the previous tool). Toolbar actions in the hover toolbar confirm with a green check or a red x, never text. _(author, revised)_ A diagram or image file opened on its own renders the same `Rich` view in the document column with the same hover toolbar; the Stage is always the pop-up. _(my call: one Stage, no in-place mode)_ The Stage is one component; viewers never implement zoom or drawing themselves.

### 8.5a Block toolbar actions _(author)_

Every inline block's hover toolbar has, left to right: **copy as image** for anything visual (diagrams, images) which writes a PNG to the clipboard so it pastes straight into Slack or a doc _(author)_; **copy source**; **download** (SVG for diagrams); and **zoom in**. Code blocks have copy and zoom-in only. Actions are declared per viewer (§7.7 `actions`).

### 8.6 Annotations: drawing on the Stage _(author)_

Like annotating a shared screen in a video call. On any Stage that declares `draw`, the toolbox offers a **pencil** with a **brush size** (small / medium / large) and **three colors: red, green, blue**. _(author, revised)_ Strokes are drawn in the content's coordinate space so they pan and zoom with it.

- **Invisible ink** (default): a stroke fades out starting ~4 s after it is finished and is gone by ~8 s. _(author)_
- **Sticky**: toggle on the toolbox; sticky strokes stay **for the session** (in memory, keyed by document path and block content hash, so they survive navigating away and back and live re-renders of unchanged blocks) and are gone on reload. _(author, revised: no cross-session persistence)_ Sticky strokes are dimmed with a "diagram changed" hint when the block's source changes.
- **Clear** removes every stroke on the current Stage.
- **Future sharing.** Each stroke is protocol-shaped `{ id, docPath, blockHash, tool, points, color, width, sticky, createdAt, by }`; when a backend reports `collaborate`, strokes become `annotation` events. _(my call)_

### 8.6a Theming _(author)_

Every color, radius, font, and spacing value in the UI and in rendered markdown (including code and diagram chrome) is a CSS custom property on the root. Two independent axes, both sticky in localStorage _(author)_:

- **Appearance:** `light`, `dark`, or `auto` (follows the OS).
- **Theme:** three built-in looks chosen during the style phase, each with its own light and dark palettes. _(author: "all 3 as sticky themes the user can pick, with different names")_ Names _(my call, author accepted)_: **Card** (cards on a gray page, round buttons, blue accent), **Paper** (flat app bar, hairlines instead of shadows, pill rows, Roboto), **Glass** (one material framing the document, system font, tight display headings; the default). See §10 for the approved mockup. The theme picker lives behind the appearance button in the title bar.

A theme is a token file (`themes/paper.css` etc.) and nothing else; components never branch on the theme name. An embedding site themes by overriding the properties or by passing `theme={…}` to `<Reader>`/`<Markdown>` with a typed theme object that is applied as properties. Shiki themes are part of the theme object so code colors switch with the rest. No component hardcodes a color.

### 8.7 Visual direction

Clean, light-handed, with the document as the hero. _(author)_ Typography does the work: system UI font for chrome, a good reading face for the document, a monospace with ligatures off for code. Minimal borders, generous whitespace, no shadows except the Stage and tooltips. Light and dark themes _(author)_, following the OS until the user picks one, with the shiki theme switched to match. Custom SVG icons at a single stroke width, including the app mark in the title bar. _(author)_ Animations limited to sidebar open/close, the Stage, ink fade, and tooltip fade.

---

## 9. The `examples/` corpus _(author)_

`examples/` at the repo root is the living demonstration and the primary human test: `leaf open examples` must show every rendering capability leaf has. _(author)_

- `examples/README.md` is the index: one section per capability, each linking to the file that exercises it.
- One markdown file per feature area (`gfm.md`, `code.md`, `diagrams.md`, `math.md`, `inline-matchers.md`, `links-and-images.md`, `alerts.md`, `frontmatter.md`, `outline-and-numbering.md`, …), each containing the feature in every form it can take, including the awkward cases (nested lists in tables, a heading inside a blockquote, duplicate heading names for slug dedupe, a broken relative link, a code block with no language).
- One standalone file per viewer (`flow.mmd`, `sequence.puml`, `sketch.excalidraw`, `analysis.ipynb`, `trail.geojson`, `data.csv`, `part.stl`, `logo.svg`, `photo.jpg`, `clip.mp4`, `paper.pdf`, `blob.bin`, `script.py`, `config.toml`, …) so the file-mode and block-mode of each viewer can be compared side by side.
- A nested folder tree with enough depth and a `.gitignore`d subfolder to exercise the tree, the filter, lazy loading, and ignores.

**Rule for every change:** a feature is not done until `examples/` demonstrates it and the Playwright smoke test opens `examples/` and passes. _(author: "keep it updated as we build")_ The plan's tasks each name the example file they add or extend.

## 10. Style phase: outcome _(author approved 2026-10-25)_

Three throwaway mockups were iterated with the author in a browser and approved as the starting point. The final mockup is kept at `.superpowers/specs/mockups/2026-10-25-leaf-themes.html`; it is the **token reference** for the three built-in themes and the builder lifts `leaf.css` tokens from it rather than inventing new ones. It is a static page, not code to reuse.

Decisions that came out of the style phase:

- **Three sticky themes**, selectable by the user: **Card**, **Paper**, **Glass** (§8.6a). **Glass is the default.** _(my call; it received the most iteration and the author's strongest reaction)_
- **Glass**: one light-gray material for the title bar and both sidebars so they frame the white document; hairline under the bar and on the sidebars' inner edges; sidebars run the full window height; recessed search and filter fields; system font with tight display headings; macOS-style segmented control for text size; frosted hover toolbars on blocks. Code and diagram blocks have **no fill**, only a hairline border, so white PlantUML renders sit cleanly; tables have a full border, cell rules, and a faintly tinted header.
- **Card**: white cards on a gray page, round icon buttons, blue accent, pill search.
- **Paper**: flat app bar with a hairline, Gmail-style pill rows, Roboto, light-weight headings, document as a bordered sheet.
- **All controls stay on the title bar.** _(author)_ Left: sidebar toggle, leaf mark, title with path. Center: search. Right: text size, numbering, outline, appearance, connection dot. Sidebars keep their own small header (Files / Outline) with expand-all, collapse-all, and (for files) a filter field.
- **The document fills the center column**; it is not capped at a reading width. _(author)_
- **File icons are monotone** stroke icons, never emoji or colored glyphs. _(author)_
- Hover toolbar on blocks: copy as image (visual blocks), copy source, zoom in. Heading anchors appear on hover to the left.

## 11. Testing _(my call)_

- `protocol`: schema round-trip tests; JSON Schema generation is checked in and diffed in CI.
- `server`: unit tests per module (classify, path confinement, watcher debounce, handler map) with an in-memory `Source` fake; one integration test that starts the server on a temp dir, connects a WebSocket, edits a file, and asserts `changed` → `file`.
- `ui`: vitest + testing-library for store and pipeline (render a fixture markdown and assert on the HTML: slugs, numbering, inline matchers, block dispatch). A Playwright smoke test opens `examples/` and checks the tree, outline, each example page rendering without console errors, and a live update. GitHub-parity fixtures for unit tests live in `packages/ui/fixtures/*.md` and are kept in sync with `examples/` (the examples are the human-readable superset).

---

## 12. Left to the builder

- Exact choice of remark/rehype plugins for each GFM feature, and the sanitize schema.
- Watcher debounce interval and rename heuristics.
- The precise look: spacing, type scale, icon set. Follow §8.7.
- How the built UI is copied into the server package for publishing.
- Which excalidraw export API to use for static rendering.
- Staging order for the exotic viewers (`stl`, `topojson`), and the exact map tile source for `geojson`.
- Stroke smoothing and fade curve for drawings.
- Keyboard shortcuts (suggested: `[` tree, `]` outline, `n` numbering, `t` theme, `/` not used).
