# leaf, the app — design (the pivot)

_Status: **delivery 1 (the window) shipped Oct 28, 2026** on branch `foundation`; acceptance checklist in `.superpowers/plans/2026-10-27-leaf-app-window-acceptance.md`. Deviations: `leaf open --browser` keeps the browser path; files over the inline cap have no byte path in the window yet. Originally: draft for Rob's review, Oct 27, 2026. This is the product's second design document. It supersedes `2026-10-27-leaf-rust-core-design.md` (a port, now retired as a framing) and amends `2026-10-24-leaf-design.md`: the rendering engine, the protocol, the themes, and the Stage from that document stand; the backend, the CLI, and the delivery change, and that document's embedding requirement (§5.3a, §7's "React library for GitHub Pages") is withdrawn._

## 1. What leaf is now

leaf is a native app with a command line, for reading markdown beautifully and showing it to other people.

- `leaf open docs` puts a window on your dock: the folder's tree, outline and search, the reader, live as files change. Agents and editors write files; the window follows. No server to start, no port, no tabs. _(author)_
- In a window, every diagram and code block zooms into the Stage: pan, pinch, draw, pin the ink. That is how you explain something on a screenshare. _(author)_
- `leaf share docs` opens that same window to other people through the relay. A coworker with leaf clicks the link and their app joins: same document, your cursor and theirs on the diagram, your pencil strokes as you draw them, follow-me if they want it. A coworker without leaf opens the same link in any browser and gets the viewer. Your machine keeps the files; the relay carries messages. _(author)_

One binary, Rust, with the React UI inside it. The browser is a door for coworkers and tools, not the way you use leaf. The app's display name is **leaf reader**; the command stays `leaf`. _(author, Oct 27: "leaf reader"; my call that the binary keeps the short name.)_

## 2. Goals, non-goals, anti-goals

**Goals**

1. The three stories above, in that order of delivery (§9).
2. One small, fast binary per platform: macOS arm64 and Linux x86_64 first. _(my call on platforms, per the earlier thread; Windows reserved.)_
3. The UI is React and stays a web app with one job: it runs in the app's webview and, as the share viewer, in Firefox and Chrome. Nothing in it knows which. **Embedding in other sites (GitHub Pages, a static export) is dropped from scope**: it bloated the design for a use nobody asked for. React stays so that door can reopen later. _(author, Oct 27: "skip the leaf-ui as embeddable in github pages... we keep react, maybe in the future, but for now what i want is a world class markdown/file viewer that can be shared and collaborated with")_
4. The relay is ours. leaf is its own ecosystem: it hosts its own relay, in Rust, with a leaf-specific protocol between host, relay, and guests. The relay never sees the disk. `~/code/relay` is not a dependency. _(author, Oct 27: "we may need to host our own relay and specific protocol here... forget ~/code/relay for now. i think we want leaf to become its own ecosystem")_
5. **Agents are participants, through ACP.** Humans use the Tauri window or a browser, both speaking leaf's protocol. Agents join a session through the Agent Client Protocol (ACP, JSON-RPC): leaf is the client side, the agent is the agent side, so any ACP-speaking agent can be pointed at a shared document and collaborate without knowing leaf's wire format. In the spirit of A2A but specific to documents. _(author, Oct 27: "agents can join via ACP protocol. humans can use the tauri UI or a browser")_

**Non-goals (first release)**

- Editing from leaf. Comments, suggestions, resolve/accept are the fourth story (§10): shaped here, not shipped in the first three.
- Windows. `leaf export` and any static-site mode (`StaticSource`), dropped with embedding. Reproducing the Node server feature-for-feature where a feature only existed because of the browser-server shape (for example the port-fallback dance).

**Anti-goals**

- Two products. Browser mode and app mode must be the same core with a different front, or the pivot has failed.
- Sharing that depends on the viewer's install. The `https://` link must work with nothing but a browser.
- A relay that holds the files. The relay may understand sessions, participants, and the viewer page; it must never need a copy of the folder to do its job.

## 3. Constraints and carry-overs

- Rust stable (1.99 on Rob's machine), edition 2024, Tauri 2. The React UI from `packages/ui` unchanged in substance; new source adapters and the presence layer are additions.
- The protocol stays at version 1 for everything that exists; sharing adds message types (§6) and bumps nothing else. The JSON Schema export (`packages/protocol/schema`) remains the contract; Rust types are tested against it.
- Same monorepo: `crates/` beside `packages/`, one Cargo workspace. `bin/*` stay the binstubs.
- 12-factor where it applies: config from flags > env > `.env` > defaults; logs to stdout in serve mode, to a file under the config dir for the app; `warn` default; `-l info|debug`.
- Security carries over whole: loopback-only socket in serve mode, Origin/Host checks, path confinement, symlink rules, size caps, `/raw` headers, the relay session token (§6).
- Preferences (`~/.config/leaf/preferences.json`), the instance registry, and the idle rules carry over in spirit: the app is the instance, so the registry becomes "is the app running" (single instance), and idle becomes "last window closed" for the serve mode only.

## 4. Architecture

```
crates/
  leaf-protocol/   serde types for every message; schema conformance tests
  leaf-core/       no transport, no UI: config, disk source, watcher, gitignore, git info,
                   preferences, the Engine (sessions, subscriptions, change fan-out),
                   the relay client (§6)
  leaf-app/        the binary `leaf`: Tauri app + CLI in one. Window mode (default),
                   serve mode (HTTP + WebSocket on loopback), share (relay) on either
```

- **`Engine`** (`leaf-core`): `connect() -> SessionId`, `handle(session, ClientMessage) -> Vec<ServerMessage>`, a broadcast of `(SessionId, ServerMessage)` for pushes (`changed`, presence), `disconnect(session)`. Hello handshake, per-session subscriptions, the `subscribedTo` prefix rule, and the session model of §6 live here. A window, a socket, and a relay peer are all just sessions.
- **Window mode** (`leaf-app`): one Tauri process, single instance. Each window hosts the UI and a `TauriSource` (`packages/ui/src/source/TauriSource.ts`, ~40 lines) that implements `DocumentSource` over two Tauri commands: `leaf_send(ClientMessage)` and a per-window event stream of `ServerMessage`s. No socket, no origin. Assets come as `base64` in `file` (this week's work; `rawUrls` false).
- **The CLI is the app.** `leaf open <path>`: if the app is running, hand the path to it (single-instance IPC) and return; else start it with that window. `leaf share <path>`: same, plus start a session (§6) and print the link. `leaf serve <path>`: serve mode, foreground, for agents and tooling that want a socket: HTTP (`/healthz`, `/raw`, the embedded UI with SPA fallback) and `/ws`, as today, with `--open` to open a browser. `leaf --help/--version`. Flags and env names as today where they still apply.
- **One look, native.** The app has a single theme with light and dark following the system, not a picker: the window chrome is the platform's (on macOS a unified titlebar with the traffic lights inset into leaf's bar, system font, system accent for selection, native scrollbars, vibrancy on the sidebars), and the document is one considered typographic style tuned for a native window rather than a web page: the system font at a size that matches macOS text, generous measure, GitHub's conventions for what markdown looks like (heading rules, tables, code blocks) without GitHub's chrome. The share viewer in a browser uses the same look, so a shared document reads the same for everyone. The theme token machinery stays (it is cheap and it is how light and dark work), the four document themes from the Node version are folded into this one look, and the Appearance menu becomes light / dark / system. _(author, Oct 27: "tauri should have a single light/dark theme... maybe an osx-style theme since i use osx. but once we go UI... that changes how people view the native rendering." My call on the specifics; Linux gets the same look with its system font.)_
- **Native controls, webview rendering, composable.** The window's controls belong to the platform where the platform can own them; the document always renders in the webview. What makes that composable is one rule: **every control is a named command**. The UI keeps a command registry (`toggleTree`, `toggleOutline`, `toggleNumbering`, `setAppearance`, `openPalette`, `openFiles`, `textLarger`, `textSmaller`, `textReset`, `zoomIn`, `closeOverlays`, `scrollBy`, later `startShare`, `stopShare`), which is what the keyboard shortcuts already dispatch to. A native menu item invokes a command by name through an event; a button in the webview's bar invokes the same command; the CLI can too. Delivery 1 goes as far as Tauri 2 goes natively: the app menu bar (File: Open Folder…, Open Recent; View: Light / Dark / System, Files, Outline, Number Headings, Text Size; Window) and the title bar, with the webview's own bar shrinking to the document title and search. A native sidebar or toolbar (AppKit through a Tauri plugin) is a later step the registry makes cheap, not a rewrite. _(author, Oct 27: "title/controls can be native and the rendering window remains that webview... this is a composable app so we should have flexibility here." My call on the registry as the seam.)_
- **The UI in the webview is WebKit on macOS.** Two adapters are part of the first story, not polish: trackpad pinch arrives as `gesturestart/gesturechange` rather than ctrl+wheel, and clipboard image writes need the Safari path. The Playwright smoke suite gains `webkit` and `firefox` projects so the shared UI is proven on all three engines.
- **Distribution.** Until packaging lands (§9, delivery 4): `cargo install --path crates/leaf-app` and `bin/install` from a checkout. Packaging is its own delivery: a signed and notarized `.dmg` plus a Homebrew cask for macOS, an AppImage or `.deb` for Linux, built in CI. Its external prerequisite is an Apple Developer ID for signing (open question 3). The `leaf-md` npm package is retired with the Node server (§8). _(my call: npx made sense for a Node CLI; it does not for a native app. Say so if you want to keep an npm door.)_

## 5. What the first story needs from the core (the "parity" that still matters)

Not parity with the Node server; what a reader window needs. Each line is a test in the plan.

1. `hello` → `welcome` (root, config, capabilities, participant, preferences).
2. `list` lazy, dirs first, gitignore-aware, `maxEntries` cap; `read` with `utf8` / `base64` / `none` and git info; `search`; `subscribe`/`unsubscribe` with `''` for everything.
3. `changed` fan-out on disk changes with the watcher behavior people rely on: a save shows within ~100 ms, a rename arrives as one event with `from`, editor temp files do not flicker.
4. Preferences merge and persist. Config precedence. Logs.
5. Serve mode: loopback bind, Origin/Host checks, `/raw` confinement and headers, the embedded UI.

## 6. Sharing (the third story)

**Session.** `leaf share <path>` creates a session on the relay and prints two forms of one link: `https://<relay>/s/<id>` and `leaf://join/<id>`. The host keeps the files and runs the Engine; guests are sessions of that Engine reached through the relay.

**The relay** is a fourth crate, `leaf-relay`, a Rust service anyone can self-host and that leaf will host publicly later (a separate operations workstream, not part of story 3's definition of done; story 3 ships the crate, a self-host recipe, and tests against an in-process instance). Abuse limits are built in from the first version, not added later: a host token the relay is configured with (self-host: your own; public: issued per account later), per-session caps on participants and frame size, and rate limits on joins. It it accepts one host connection and any number of guest connections per session, forwards frames host↔guest, holds the roster, serves the viewer page (the built UI) at `/s/<id>`, and enforces the per-session secret carried in the link. It speaks a small relay protocol of its own around leaf's messages (join, leave, roster, forward) so the host's Engine never has to know it is behind a proxy. _(author: our own relay, a Rust proxy in the middle. My call on the crate boundary: the relay reuses `leaf-protocol` types and nothing from `leaf-core`.)_

**The link.** The `https://` page serves the browser viewer (the same UI, with a `WsSource` to the relay). It offers "Open in leaf," which fires the `leaf://` deep link; the app registers that scheme (Tauri deep-link plugin) and joins in a new window. `leaf share` prints both so either can be pasted. _(author: "maybe the share URL is just a leaf:// URI... but i like the idea of supporting viewer mode w/o having to install leaf")_

**Guests browse on their own, read-only.** A guest's `list`, `read`, `search`, and `subscribe` go through the relay to the host's Engine like any client's, so a guest (or an agent) can open a different file in the shared folder while you talk; follow-me is a choice, not the only mode. Frames over the relay are capped at `LEAF_MAX_INLINE_BYTES`, the same cap that already bounds `file` content. _(my call, forced by the agent goal: an agent that can only see what the host has open cannot review a folder. Cost if wrong: the viewer page carries the tree, search and palette, which it has anyway.)_

**What a share is.** A share is tied to one window and its root: that window is the host participant whose viewport follow-me tracks. The Engine is per root inside the single app process; a second window on the same folder is just another participant. Stop sharing from the window's title bar (a sharing indicator with a stop control) or `leaf share --stop <path>`. _(my call.)_

**Lifetimes.** Window mode: closing the last window quits the app, unless a share is active, in which case the app stays in the dock with the sharing indicator until it is stopped. Serve mode: runs until ctrl-c, or `--idle-timeout` after the last socket closes. The CLI hand-off (`leaf open` into a running app) returns immediately either way. _(my call; this is what "it behaves like a command" meant.)_

**Agents join through ACP.** leaf implements the client side of the Agent Client Protocol: for a session it starts (local, over stdio) or accepts (remote, ACP framed over the relay's WebSocket) an agent, and grants it a scoped view of the shared folder. The mapping, with ACP's own method names as the builder's reference: the agent's file reads are served from the host's Engine (read-only, confined to the shared root); the agent's file writes become **suggestions** in the session that the host accepts or rejects (fourth story), unless the host has marked that agent trusted, in which case they land on disk and flow out as `changed` like any edit; the agent's messages and plan updates appear in the session as that participant's comments; ACP permission requests surface to the host as prompts. The agent shows in the roster as kind `agent` with its ACP-declared name. leaf's own WebSocket protocol stays the UI protocol; it is not what agents are asked to speak. The protocol package and JSON Schema remain the contract for anyone building a UI or a tool, and `examples/agents/` will carry a minimal ACP agent that joins a session and leaves a comment, as the conformance demo. _(author's direction; my calls on leaf being the ACP client, reads-from-Engine, and suggest-by-default.)_

**New message types** (names fixed here; field shapes are the builder's, within the protocol package's conventions, and go through the schema export like everything else):

- `presence` (both directions): where a participant is: document path, the block under their cursor, cursor position in content coordinates when on a Stage, and viewport (scroll fraction) for follow-me. Sent on change, throttled; the Engine fans each participant's presence to the others and drops the sender's own.
- `ink` (both directions): a stroke as the Stage already models it (`docPath`, `blockHash`, points, color, width, sticky), plus `inkClear`. Live strokes stream as they are drawn; sticky ones persist for the session on the host.
- `participants` (host → all): the roster with id, name, color, and whether host, on every join/leave. `participant` in `welcome` already identifies the receiver.
- `follow` is client-local: a guest who follows applies the host's `presence.viewport`. No message needed.

**Relay client** (`leaf-core`): an outbound WebSocket to the relay that multiplexes guest sessions onto the Engine. One connection per shared session; reconnect with backoff; the session dies when the host closes it.

**Outward is the same path as inward.** The protocol is bidirectional and the UI already uses it that way: a preference change in the store becomes a `preferences` message through the source, and the same message type arriving from the server is applied without echo (`store/preferences.ts`). Ink and presence follow that loop exactly: a stroke enters the annotations store, leaves as `ink`, crosses the relay, enters the annotations store on the other side, and the same `Draw` renders it. The Stage never knows whether a stroke is local or remote. _(author: "annotations can be emitted from the UI layer back to that event protocol and shared across the internet to sync on another person's UI." The sharing plan reuses the preferences pattern; it does not add a second outbound path.)_

**UI additions** (`packages/ui`): a presence layer (cursors with names, on the Stage and as "N here" in the title bar), the roster, follow toggle, and ink from others rendered through the existing `annotations` store. All behind the protocol, so they work in the app and in the browser viewer alike.

## 7. Tests and the definition of done

- `leaf-protocol`: schema conformance for every message, including the new ones.
- `leaf-core`: unit tests per module with temp dirs; Engine tests with a fake source; relay client tests against an in-process fake hub.
- `leaf-app`: an integration test starting the binary in serve mode and driving `/ws` and `/raw`; a CLI test for `open`/`share` hand-off to a running instance.
- UI: existing suites plus the presence layer; Playwright on chromium, webkit, and firefox against serve mode.
- **Done** means the three stories work as written, each with an end-to-end test: open a folder in a window and watch a save land; zoom and draw; share from one app to another through a local fake relay and see the cursor and the stroke on the other side, and the same from a browser viewer.

## 8. Migration

1. The Rust core and app land beside the Node server; `bin/dev` and `bin/run` switch to them when the first story passes.
2. `packages/server` is deleted when packaging ships (delivery 4), since the README's install section has to point somewhere real first. `packages/protocol` and `packages/ui` stay: they are the contract and the product's face. `leaf-md` on npm is unpublished (it never shipped).
3. The README's install section changes to the app downloads and Homebrew; `examples/` stays the living demo.

## 9. Delivery order

1. **The window.** `leaf-protocol`, `leaf-core` (§5), `leaf-app` window mode with `TauriSource`, `leaf open`, WebKit adapters, Playwright on three engines. Serve mode comes with it because the core's tests are easiest to drive over a socket.
2. **The Stage on WebKit, polished.** Pinch, clipboard, screenshare-sized windows. Small, but it is the second story.
3. **Sharing.** The session model, `leaf-relay`, the relay client, presence and ink messages, the viewer page on the relay, the deep link, and a minimal ACP agent in `examples/agents/` that joins and is seen in the roster.

4. **Packaging.** Signed builds, Homebrew, Linux packages, release CI; then the Node server is deleted and the README's install section changes.

Each is its own implementation plan.

## 10. The fourth story, reserved but shaped: review-style collaboration

_(author, Oct 27: "pull-request style collaboration. shared docs can receive comments, or suggestions... a very collaborative way to edit and view documents in realtime")_

Not in the first three deliveries, but the session model must not block it, so its shape is fixed here:

- **Anchors.** A comment or suggestion attaches to a **source range** (line/column plus the quoted text, as the main spec §5.4a fixed) with the block's content hash as a secondary key, so it survives edits elsewhere in the file and is flagged, not lost, when its block changes (the same stale rule as sticky ink). Presence and ink keep carrying block hashes only, as the Stage already models them; comments add the source range. _(my call: the two models coexist because they answer different questions, "where on this picture" versus "which words".)_
- **Comments** are threads on an anchor: `comment` / `resolve` messages from any participant, fanned to all, rendered in a margin. **Suggestions** are proposed replacements for an anchor's text: `suggest` from a guest, `accept` / `reject` by the host; accepting writes the file on the host's disk, so the normal `changed` flow shows everyone the result. These are the event types the main spec reserved (§7.6).
- **Durability.** Comments and suggestions outlive the session: the host stores them beside the folder (`.leaf/review.json`, gitignored by default) so a shared doc reopened tomorrow still carries its threads. The relay keeps nothing after the session ends. _(my call; the alternative, relay-side storage, makes the relay a database.)_
- **Identity.** Participants need a stable name and color across sessions for threads to make sense; the preferences file is where that lives for people, and the `hello` announcement for agents. Comments and suggestions from an agent are shown as the agent's, so a thread reads like a review.

Each of these is a message type through the schema export and a UI surface in `packages/ui`, behind the protocol, so it works in the app and the browser viewer alike.

## 11. Later, unshaped

Editing the file body from leaf; Windows; themes on Tailwind (`2026-10-24` §10 note); an npm door if wanted; embedding the UI elsewhere, if a real need appears.

## Open questions for Rob

1. **npm.** Retire `leaf-md` with the Node server, or keep an npm package that downloads the native binary (the esbuild pattern) so `npx leaf-md` still works? Draft retires it.
2. **Hosting.** `leaf-relay` is a crate here; who runs the public instance, and does a share link default to it or to a relay you configure (`LEAF_RELAY_URL`)? Draft: configurable, with a leaf-run default once one exists.
3. **Signing.** Do you have, or want to get, an Apple Developer ID for notarized builds? Without it the macOS build is "right-click, Open" and Homebrew cask is off the table; it gates delivery 4, not the first three.
