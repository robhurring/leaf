# leaf Rust core — design

_Status: **superseded** the same day by `2026-10-27-leaf-app-design.md`, which reframes this as a product pivot (the app is the product, the Node server is retired, not matched). Kept for the crate layout and the parity notes it worked out. Originally: draft for Rob's review, Oct 27, 2026. Companion to the main design (`2026-10-24-leaf-design.md`), which this does not replace: the protocol, the UI, and the product stay as specified there._

## 1. Intent

Replace the Node backend with a Rust one that speaks the same protocol, so that:

- `leaf` is one small native binary with the UI inside it, no Node on the machine;
- the same core drives a **browser** (WebSocket + HTTP, as today) and a **Tauri** desktop app (in-process, events instead of a socket) without two implementations;
- the relay and agents keep talking WebSocket to it unchanged.

The renderer and the backend share nothing but message shapes. That is what makes this cheap: the UI package does not change, and the protocol package's JSON Schema export becomes the contract the Rust side is tested against. _(author: "rust as the backend is relatively cheap right? the rendering and backend don't share too much code")_

## 2. Goals, non-goals, anti-goals

**Goals**

- Behavioral parity with the Node server for everything `examples/` and the Playwright smoke suite exercise (the list in §6 is the checklist).
- One binary, `leaf`, that serves the built UI from inside itself; `cargo install` and a Homebrew formula are the native install paths; `npx leaf-md` keeps working (§8).
- A transport-agnostic core: the engine takes `ClientMessage`s and emits `ServerMessage`s per session, and does not know whether a socket or Tauri delivers them.
- 12-factor as before: config from flags > env > `.env` > defaults, logs to stdout, `warn` default, `-l info`/`debug`, `LOG_FORMAT=text|json`.

**Non-goals (this spec)**

- The Tauri app itself. This spec makes it possible (§5.4) and stops there; the desktop app gets its own spec.
- `leaf export`, the relay, collaboration events, write/accept/resolve. The protocol slots stay reserved.
- Changing the protocol. Version stays 1. Anything the Rust port needs that the schema lacks is a bug in the schema export, fixed on the TypeScript side first.

**Anti-goals** (would make this a failure even if it works)

- Two backends drifting apart. The Node server is the reference until parity and is then deleted, not kept "just in case" (§9).
- Rust types hand-copied from TypeScript with no check. Conformance tests against the exported schema are not optional.
- A core that only works behind a socket. If Tauri would need a second engine, the core is wrong.

## 3. Constraints

- Rust stable, current toolchain (1.99 on Rob's machine); edition 2024. No nightly.
- Same monorepo. Rust lives in `crates/` beside `packages/`; one Cargo workspace at the root. _(my call: the protocol schema, the UI build, and the e2e suite are all here, and the port is tested against them.)_
- The UI build (`packages/ui/dist/app`) is embedded at compile time (`rust-embed`). `bin/build` builds the UI first, then the binary.
- Loopback-only, Origin/Host checks, path confinement, symlink rules, size caps: every security property of the Node server carries over, each with a test.
- No new product behavior in the port. Parity first; improvements go through the main spec. **Where this document and the Node code disagree on a detail, the Node code is the reference** and this document gets corrected, not the port.

## 4. The protocol contract on the Rust side

- `packages/protocol` already exports JSON Schema (`npm run schema -w @leaf/protocol` → `packages/protocol/schema/*.json`). That export is **stale today** (no `preferences`, no `base64`, no `rawUrls`): regenerating it on `bin/build` and committing the result is the first task of the plan.
- `crates/leaf-protocol` holds hand-written `serde` types: `ClientMessage` and `ServerMessage` as `#[serde(tag = "type", rename_all = "camelCase")]` enums, plus `Entry`, `Config`, `Capabilities`, `Participant`, `GitInfo`, `Preferences`. Hand-written rather than generated: the shapes are small and stable, and generated code for `discriminatedUnion` is ugly to read. _(my call.)_
- **Conformance tests** (crate `leaf-protocol`, `tests/schema.rs`): using the `jsonschema` crate, every Rust-constructed sample of every message validates against the exported schema, and every schema-valid example in `tests/fixtures/*.json` (one per message, copied from the TypeScript tests) round-trips through the Rust types. A new message type on either side fails this test until both sides agree.
- Unknown `type` on the wire: ignored with a warning, as today. Unknown fields: ignored (serde default), so additive protocol changes do not break older binaries.

## 5. Architecture

```
crates/
  leaf-protocol/   message types + schema conformance tests
  leaf-core/       everything with no transport: config, source, watcher, git, ignore,
                   preferences, instances, idle guard, the engine
  leaf-cli/        the `leaf` binary: CLI, HTTP + WebSocket transport, embedded UI,
                   detached launch and reuse
```

Crate names are fixed here: `leaf-protocol`, `leaf-core`, `leaf-cli` (binary `leaf`). _(my call.)_

### 5.1 `leaf-core`

- `Source` trait (async): `root()`, `capabilities()`, `list(path)`, `read(path)`, `search(q, limit)`, `watch(...)`, mirroring `packages/server/src/source/Source.ts`. `DiskSource` implements it: lazy listing, `.gitignore`-aware via the `ignore` crate (same semantics as the `ignore` npm package: always-patterns plus per-directory gitignore), symlinks followed only inside the root, text sniffing for unknown extensions (first 8 KiB), `LEAF_MAX_INLINE_BYTES` cap, `utf8` for text kinds, `base64` for small binaries, `none` above the cap. `classify` ports `classify.ts` and its table.
- `Watcher`: `notify` crate with the Node watcher's exact timing: 60 ms debounce, a 200 ms window when a rename is possible, 500 ms maximum wait, and a 50 ms write-settle. Rename pairing by basename or same directory. Events for ignored paths are dropped; the whole root is watched and sessions filter by subscription, as the Node server does today (the main spec's line about dropping events for unlisted folders describes an optimization neither implementation has; it is not part of parity). Emits `ChangeEvent { path, change, from }`.
- `GitInfo`: shell out to `git log -1 --format=...` and `git remote get-url origin`, cached per path+mtime, exactly as `git.ts`. _(my call: shelling keeps `remoteToWebUrl` and the "no git, no info" behavior identical and avoids a libgit2 build dependency; see open question 1.)_
- `Preferences`: `preferences.json` under the config dir, merge-on-save, per-field validation, atomic write.
- `instances/`: the registry files and `find_serving`; `IdleGuard` with the same two windows.
- `Config`: `clap` for flags; precedence flags > env > `.env` (`dotenvy`) > defaults; same names, same defaults, same validation messages where tests check them (`PORT` bad value, missing target).
- **`Engine`**: the transport-agnostic heart. `Engine::new(source, prefs, config)`; `engine.connect() -> SessionId`; `engine.handle(session, ClientMessage) -> Vec<ServerMessage>` (replies, in order); `engine.subscribe_changes() -> broadcast::Receiver<(SessionId, ServerMessage)>` for the `changed` fan-out to subscribed sessions; `engine.disconnect(session)`. The hello handshake rule ("first message must be hello"), per-session subscriptions, and the `subscribedTo` prefix rule live here. The WebSocket transport and a Tauri command are both ten-line adapters over this.
- Logging: `tracing` with two subscribers: a single-line text formatter (`[HH:MM:SS] LEVEL: msg {json}` as today) and JSON lines. Levels map 1:1.

### 5.2 `leaf-cli`

- `axum` + `tokio`. Routes: `/healthz`, `/raw/<path>` (bytes via the source, `nosniff`, CSP sandbox for html/svg as today), `/ws` (upgrade; Origin and Host must be loopback or the configured host), everything else the embedded UI with SPA fallback to `index.html`.
- One task per socket: reads frames, calls `engine.handle`, writes replies; a second task forwards that session's broadcast `changed`s. Client count feeds the idle guard.
- CLI (`main.rs` + `cli.rs`): `leaf [open] [path]`, `leaf serve [path]`, `leaf --help/--version`, the same flags and help text. `open` reuses a running instance or spawns `leaf serve` detached (`std::process::Command` with `setsid`-style detachment; readiness through a pipe or a temp file the child writes its URL to), prints the URL, opens the browser (`open` crate), returns. `-l` on the command line keeps the foreground. Port default 4321 with fallback to a free port when the default was not explicit.

### 5.3 Tests

- `leaf-protocol`: schema conformance (§4).
- `leaf-core`: unit tests ported one-to-one from the Node tests where they exist (`classify`, `ignore`, `paths`, `DiskSource`, `Watcher`, `git`, `config`, `PreferencesStore`, `registry`, `IdleGuard`, `handlers`) using `tempfile` dirs; `Engine` tests with a fake source.
- `leaf-cli`: an integration test that starts the binary on a temp folder and drives it with `tokio-tungstenite` (hello → welcome → list → subscribe → read → change) and HTTP (`/healthz`, `/raw`, Origin rejection); the detached-command test (open, return, reuse, idle stop) ported from `daemon.test.ts`.
- **The same Playwright smoke suite** runs against the Rust binary (`LEAF_BIN=target/release/leaf`), and `bin/test` runs it against both while both exist. Parity is defined by this plus §6.

### 5.4 The Tauri seam (so the next spec has nothing to undo)

- `leaf-core` has no `tokio::net`, no axum, no HTTP. A Tauri app depends on `leaf-core` only, holds one `Engine`, and exposes two commands: `leaf_send(ClientMessage)` and an event stream of `ServerMessage`s per window. The UI side is a `TauriSource` implementing `DocumentSource` with `invoke`/`listen`, about forty lines, in `packages/ui/src/source/`.
- Assets in Tauri come through the socketless path this week's work added: `base64` in `file` and `rawUrls: false`, so no custom URI scheme is needed for the first version.

## 6. Parity checklist (the definition of done)

Every line is covered by a test named in the plan.

1. `hello` → `welcome` with root, config (`plantumlUrl`, `mentionUrl`, `topicUrl`, `maxEntries`), capabilities (`watch`, `rawUrls: true`), participant, stored `preferences`.
2. Any message before `hello` → `error bad_request`, socket closed.
3. `list` lazy per directory, sorted dirs-first then name, gitignore and always-ignore applied, `hasChildren`, `maxEntries` cap.
4. `read`: markdown/text inline `utf8`; small binary `base64`; large → `none`; `git` info when in a repo; `not_found`, `outside_root`, `unsupported` errors.
5. `subscribe`/`unsubscribe`, `''` = everything; `changed` fan-out with `from` on renames; debounce; ignored paths silent.
6. `search` with limit; `preferences` merge; `/raw` confinement and headers; Origin/Host rejection; `/healthz`.
7. CLI: command mode (detach, reuse, URL on stdout, browser open), `serve`, idle stop after the last client, startup grace, `-l` foreground, port fallback, `.env` precedence, `--help` text, exit codes 1/2 as today.
8. Logs: single-line text by default, JSON lines on request, `warn` default, the URL printed regardless of level.

## 7. Dev workflow

- `bin/setup` also checks `cargo` and prints the rustup one-liner if missing. `bin/build`: UI, then `cargo build --release`. `bin/test`: `cargo test` joins the existing steps; the e2e runs against the Rust binary. `bin/lint`: `cargo fmt --check` and `cargo clippy -D warnings` join Prettier and tsc. `bin/run` runs the Rust CLI from source (`cargo run -p leaf-cli --`).
- `bin/install` symlinks the release binary instead of the Node shim once the Rust server is the default.

## 8. Distribution

- Native, this plan: `cargo install --path crates/leaf-cli` from a checkout with the UI built (`bin/build` does both; the crate's build script fails with a plain message when `packages/ui/dist/app` is missing). Publishing to crates.io is **out of scope** here: it would mean vendoring the built UI into the crate at release time, and is a release-pipeline task for later. A Homebrew tap, same. _(my call, after the builder check.)_
- npm: `leaf-md` stays the npx entry point. After parity it ships the native binary the way esbuild does: a tiny JS launcher plus one optional dependency per platform carrying the binary. Until then it ships the Node server. _(my call: npx stays because Rob called it out; see open question 2.)_

## 9. Migration and what gets deleted

1. Rust crates land beside the Node server; both pass the same e2e.
2. `bin/dev`, `bin/run`, and `bin/install` switch to the Rust binary; the Node server stays for one release as `packages/server` with a deprecation note.
3. When npm ships binaries (§8), `packages/server` is deleted. `packages/protocol` stays: it is the schema source of truth and the UI's types.

## 10. Later, not here

- **Themes on Tailwind.** Express the document tokens as Tailwind `@theme` variables and move component styling to utility classes so themes grow by adding token sets, keeping hand-written CSS to the document typography that utilities cannot express. Its own small spec. _(author, Oct 27: "use tailwind so themes are consistent... keep custom CSS to a minimum")_
- The Tauri app (§5.4 is the seam). The relay transport. Static export.

## Open questions for Rob

1. **Git info**: shell out to `git` (identical behavior, zero build deps, needs `git` on PATH, which the Node version already assumes) or `git2`/libgit2 (no PATH dependency, slower builds, different remote-URL parsing to re-verify)? Draft says shell.
2. **npm after parity**: ship native binaries through `leaf-md` (npx keeps working, more release machinery) or let npm go and point people at `cargo install`/Homebrew? Draft says keep npx.
3. **Platforms for the first release**: macOS arm64 only, or macOS + Linux x86_64 from the start? Windows affects path confinement and the detach code, so the draft leaves it out.
