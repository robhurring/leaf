# leaf app, delivery 1: the window — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `leaf open docs` opens a native window showing the folder with live updates, driven by a Rust core that also runs a loopback serve mode for browsers and agents; the Node server is no longer needed for the first story.

**Architecture:** A Cargo workspace in `crates/`: `leaf-protocol` (serde types tested against the JSON Schema export), `leaf-core` (config, disk source, watcher, gitignore, git, preferences, and a transport-free `Engine`), `leaf-app` (the `leaf` binary: Tauri 2 window mode and an axum serve mode over the same Engine, the built UI embedded). The React UI gains a `TauriSource` and two WebKit adapters; nothing else in it changes.

**Tech Stack:** Rust 1.99 / edition 2024; tokio, axum (ws feature), serde, serde_json, jsonschema (tests), clap, dotenvy, notify, ignore, tracing + tracing-subscriber, rust-embed, base64, tempfile; Tauri 2 with the single-instance plugin; `@tauri-apps/api` in the UI; Playwright with chromium, webkit, firefox.

**Spec:** `.superpowers/specs/2026-10-27-leaf-app-design.md` (binding), with `2026-10-24-leaf-design.md` for the UI and protocol and `2026-10-27-leaf-rust-core-design.md` for crate-level notes.

## Global Constraints

- Rust stable 1.99, edition 2024, no nightly. `cargo fmt --check` and `cargo clippy --all-targets -D warnings` clean on every commit.
- Crate names fixed: `leaf-protocol`, `leaf-core`, `leaf-app` (binary `leaf`). Workspace `Cargo.toml` at the repo root; crates under `crates/`.
- Protocol version 1, unchanged. `packages/protocol/schema/*.json` is the contract; regenerate with `npm run schema -w @leaf/protocol` (already part of `bin/build`). Rust serializes `camelCase` field names and `type`-tagged enums exactly as the schema says.
- Platforms: macOS arm64 and Linux x86_64. No Windows code paths.
- Security carried over, each with a test: bind loopback only in serve mode; reject non-loopback `Origin`/`Host`; path confinement (`..`, absolute, symlink escape → `outside_root`); `/raw` sends `X-Content-Type-Options: nosniff` and `Content-Security-Policy: sandbox` for `text/html` and `image/svg+xml`; inline size cap `LEAF_MAX_INLINE_BYTES` default `2097152`.
- Config names and defaults as in the main spec §6 and README: `HOST=127.0.0.1`, `PORT=4321` (serve mode; fallback to a free port only when the default was not explicit), `LOG_LEVEL=warn`, `LOG_FORMAT=text`, `LEAF_OPEN=true`, `LEAF_IGNORE=.git,node_modules,.DS_Store`, `LEAF_GITIGNORE=true`, `LEAF_MAX_ENTRIES=5000`, `LEAF_MAX_INLINE_BYTES=2097152`, `LEAF_IDLE_TIMEOUT=0`, `LEAF_CONFIG_DIR=$XDG_CONFIG_HOME/leaf` else `~/.config/leaf`, `PLANTUML_URL`, `LEAF_MENTION_URL`, `LEAF_TOPIC_URL`. Precedence flags > env > `.env` in cwd > defaults.
- Watcher timing copied from the Node watcher: 60 ms debounce, 200 ms rename window, 500 ms maximum hold, 50 ms write settle.
- The UI package changes only by addition: `packages/ui/src/source/TauriSource.ts`, the WebKit adapters in the Stage and `stage/image.ts`, and the entry choosing a source. The layering test in `packages/ui/test/layering.test.ts` must stay green.
- Log line format in text mode: `[HH:MM:SS] LEVEL: message {json fields}` single line; JSON mode one object per line with `time`, `level`, `msg`, and the fields. The URL in serve mode prints to stdout regardless of level.
- Commit after every task with a conventional-commit message. No `packages/server` deletion in this plan (that is delivery 4).

## Review Focus

1. A folder with a symlink pointing outside the root: listing must show the link as unavailable or skip it, reading must answer `outside_root`, never the target's bytes. Pinned in Task 5.
2. A file saved by an editor that writes a temp file and renames (vim, VS Code "safe write"): the window must receive one `modified` for the real path, no `deleted` flicker. Pinned in Task 6.
3. A `read` arriving before `hello` on a serve-mode socket: `error bad_request` and the socket closes; the Engine must not have registered subscriptions. Pinned in Task 8 and Task 9.
4. A browser tab on `http://localhost:4321` (not `127.0.0.1`) when `HOST=127.0.0.1`: must be accepted (both are loopback); `http://evil.test` as Origin must be rejected. Pinned in Task 9.
5. A trackpad pinch in the Tauri window on macOS arrives as `gesturechange`, not ctrl+wheel; zoom must track the gesture and the page must not zoom. Pinned in Task 13.

---

### Task 1: Workspace and `leaf-protocol` with schema conformance

**Files:**

- Create: `Cargo.toml` (workspace), `crates/leaf-protocol/Cargo.toml`, `crates/leaf-protocol/src/lib.rs`, `crates/leaf-protocol/src/client.rs`, `crates/leaf-protocol/src/server.rs`, `crates/leaf-protocol/src/common.rs`
- Test: `crates/leaf-protocol/tests/schema.rs`, fixtures `crates/leaf-protocol/tests/fixtures/<type>.json` (one valid example per message type, 15 files)
- Modify: `.gitignore` (add `target/`), `bin/lint` (add `cargo fmt --check && cargo clippy --all-targets -- -D warnings`), `bin/test` (add `cargo test --workspace` before the UI unit tests)

**Interfaces:**

- Produces: `leaf_protocol::{ClientMessage, ServerMessage, Entry, EntryKind, RootInfo, Config, Capabilities, Participant, GitInfo, Preferences, Theme, Appearance, FileKindStr, Encoding, Change, ErrorCode, PROTOCOL_VERSION: u8 = 1}`. `ClientMessage` and `ServerMessage` are `#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)] #[serde(tag = "type", rename_all = "camelCase")]` enums whose variants carry `#[serde(rename_all = "camelCase")]` structs with `id: Option<String>` / `in_reply_to: Option<String>` where the TypeScript envelope has them; `Entry { path, name, kind, size: Option<u64>, mtime: Option<f64>, has_children: Option<bool> }`; `Encoding::{Utf8, Base64, None}` serialized `utf8|base64|none`.
- Produces: `leaf_protocol::parse_client(&str) -> Result<ClientMessage, ParseError>` where `ParseError::{InvalidJson, UnknownType(String), Invalid(String)}`; `is_known_client_type(&str) -> bool`.

- [ ] **Step 1: Write the failing conformance test**

```rust
// crates/leaf-protocol/tests/schema.rs
use jsonschema::JSONSchema;
use leaf_protocol::*;

fn schema(name: &str) -> JSONSchema {
    let text = std::fs::read_to_string(format!("../../packages/protocol/schema/{name}.json")).unwrap();
    JSONSchema::compile(&serde_json::from_str(&text).unwrap()).unwrap()
}
fn fixture(name: &str) -> serde_json::Value {
    serde_json::from_str(&std::fs::read_to_string(format!("tests/fixtures/{name}.json")).unwrap()).unwrap()
}

#[test]
fn every_client_fixture_round_trips_and_validates() {
    for name in ["hello", "list", "read", "subscribe", "unsubscribe", "search", "preferences"] {
        let v = fixture(name);
        assert!(schema(name).is_valid(&v), "fixture {name} must satisfy its own schema");
        let msg: ClientMessage = serde_json::from_value(v.clone()).unwrap();
        let back = serde_json::to_value(&msg).unwrap();
        assert!(schema("client").is_valid(&back), "{name}: Rust output must satisfy the client union schema");
        assert_eq!(back, v, "{name}: round trip must be exact");
    }
}
#[test]
fn every_server_fixture_round_trips_and_validates() {
    for name in ["welcome", "tree", "file", "changed", "matches", "error"] {
        let v = fixture(name);
        let msg: ServerMessage = serde_json::from_value(v.clone()).unwrap();
        let back = serde_json::to_value(&msg).unwrap();
        assert!(schema("server").is_valid(&back));
        assert_eq!(back, v);
    }
}
#[test]
fn unknown_type_and_bad_shape() {
    assert!(matches!(parse_client(r#"{"type":"dance"}"#), Err(ParseError::UnknownType(t)) if t == "dance"));
    assert!(matches!(parse_client(r#"{"type":"read"}"#), Err(ParseError::Invalid(_))));
    assert!(matches!(parse_client("nope"), Err(ParseError::InvalidJson)));
    assert!(is_known_client_type("hello") && !is_known_client_type("dance"));
}
```

Fixtures: copy each example from `packages/protocol/test/messages.test.ts` and the UI's scripted source (`packages/ui/test/helpers/scripted.ts`), e.g. `welcome.json` includes `preferences: {}` and `capabilities: {watch:true,write:false,collaborate:false,rawUrls:true}`; `file.json` uses `encoding: "base64"` with `git`.

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo test -p leaf-protocol`
Expected: FAIL to compile (crate and types missing).

- [ ] **Step 3: Create the workspace and the types**

`Cargo.toml` workspace with `members = ["crates/*"]`, `resolver = "2"`, shared `[workspace.dependencies]` for serde, serde_json, tokio, tracing. `leaf-protocol` depends on serde, serde_json; dev-dep jsonschema. Types per the Interfaces block; `#[serde(skip_serializing_if = "Option::is_none")]` on every `Option` so round trips are exact.

- [ ] **Step 4: Run tests, fmt, clippy**

Run: `cargo test -p leaf-protocol && cargo fmt --check && cargo clippy -p leaf-protocol --all-targets -- -D warnings`
Expected: 3 tests pass, no warnings.

- [ ] **Step 5: Commit**

```bash
git add Cargo.toml Cargo.lock crates/leaf-protocol .gitignore bin/lint bin/test
git commit -m "feat(rust): leaf-protocol types with JSON Schema conformance tests"
```

---

### Task 2: `leaf-core` config

**Files:**

- Create: `crates/leaf-core/Cargo.toml`, `crates/leaf-core/src/lib.rs`, `crates/leaf-core/src/config.rs`
- Test: `crates/leaf-core/tests/config.rs`

**Interfaces:**

- Produces: `leaf_core::config::{Config, Source as ConfigSource, Sources, load(argv: &[String], env: &HashMap<String,String>, cwd: &Path) -> Result<(Config, Sources), ConfigError>, parse_duration(&str) -> Result<u64, ConfigError>, default_config_dir(env) -> PathBuf}`. `Config` fields: `command: Command::{Open, Serve, Share, Help, Version}`, `target: PathBuf` (absolute), `host: String`, `port: u16`, `log_level: LogLevel`, `log_format: LogFormat`, `plantuml_url: Option<String>`, `open: bool`, `ignore: Vec<String>`, `gitignore: bool`, `max_entries: usize`, `max_inline_bytes: u64`, `mention_url: Option<String>`, `topic_url: Option<String>`, `config_dir: PathBuf`, `idle_timeout_ms: u64`. `Sources` maps each field name to `Default|Dotenv|Env|Flag`.
- Flags (clap): `[open|serve|share] [path]`, `--host`, `--port`, `-l/--log-level`, `--log-format`, `--plantuml-url`, `--open/--no-open`, `--ignore`, `--gitignore/--no-gitignore`, `--config-dir`, `--idle-timeout`, `-h`, `-V`.

- [ ] **Step 1: Write failing tests** covering: precedence (flag > env > dotenv > default) for `PORT` and `LOG_LEVEL`; defaults (`port 4321`, `log_level Warn`, `idle_timeout_ms 0`, `config_dir` from `XDG_CONFIG_HOME` then `~/.config/leaf`, `LEAF_CONFIG_DIR` override); `parse_duration("24h")==86_400_000`, `"90s"`, `"5m"`, `"250"`; bad `PORT=abc` → `ConfigError` whose message contains `PORT`; missing target → error containing `no such file or directory`; `serve docs` → `Command::Serve`, bare `README.md` → `Open`; `--idle-timeout 2m` → `120_000`.
- [ ] **Step 2: Run** `cargo test -p leaf-core config` → FAIL (module missing).
- [ ] **Step 3: Implement** with clap (derive) for parsing only, then the merge in `load` (dotenvy reads `cwd/.env` if present; never mutates the process env).
- [ ] **Step 4: Run** → PASS; fmt + clippy clean.
- [ ] **Step 5: Commit** `feat(rust): leaf-core config with 12-factor precedence`

---

### Task 3: classify and text sniffing

**Files:**

- Create: `crates/leaf-core/src/classify.rs`
- Test: `crates/leaf-core/tests/classify.rs`

**Interfaces:**

- Produces: `classify(path: &Path) -> Classified { kind: &'static str, lang: Option<&'static str>, mime: &'static str }` with the same table as `packages/server/src/source/classify.ts` (markdown, text with languages for the extensions listed there, image, media, pdf, binary; `.mmd/.mermaid → text/mermaid`, `.puml → text/plantuml`, `.excalidraw → text/json`, `.csv/.tsv → text`); `looks_like_text(head: &[u8]) -> bool` (no NUL in the first 8 KiB and ≥ 90 % printable/whitespace UTF-8).

- [ ] **Step 1: Write failing tests**: port every case from `packages/server/test/classify.test.ts` plus `looks_like_text` on a Gemfile-like buffer (true) and random bytes with a NUL (false).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS. **Step 5: Commit** `feat(rust): classify and text sniffing`

---

### Task 4: ignore rules and path confinement

**Files:**

- Create: `crates/leaf-core/src/ignore.rs`, `crates/leaf-core/src/paths.rs`
- Test: `crates/leaf-core/tests/ignore.rs`, `crates/leaf-core/tests/paths.rs`

**Interfaces:**

- Produces: `Ignorer::new(root: &Path, always: &[String], use_gitignore: bool)`, `Ignorer::ignores(&self, rel: &str, is_dir: bool) -> bool` (always-patterns via `ignore::gitignore::GitignoreBuilder`; per-directory `.gitignore` files read lazily and scoped to their directory; `..`, `../x`, and absolute paths return `true`, never panic).
- Produces: `paths::resolve_inside(root: &Path, rel: &str) -> Result<PathBuf, Confinement>` where `Confinement::{Outside, Invalid}`: rejects `..` segments, absolute, empty segments, NUL; resolves symlinks and requires the canonical result to start with the canonical root; `paths::parent_of(&str) -> &str`.

- [ ] **Step 1: Write failing tests** ported from `packages/server/test/ignore.test.ts` and `paths.test.ts` (always patterns, root gitignore, nested gitignore scoped, children of an ignored dir, gitignore off, outside-root never errors; `resolve_inside` on `..`, a symlink to `/etc`, a symlink inside the root).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS. **Step 5: Commit** `feat(rust): ignore rules and path confinement`

---

### Task 5: `DiskSource`

**Files:**

- Create: `crates/leaf-core/src/source.rs` (trait + errors), `crates/leaf-core/src/disk.rs`, `crates/leaf-core/src/git.rs`
- Test: `crates/leaf-core/tests/disk.rs`, `crates/leaf-core/tests/git.rs`

**Interfaces:**

- Produces: `#[async_trait] trait Source: Send + Sync { fn root(&self) -> RootInfo; fn capabilities(&self) -> Capabilities; async fn list(&self, path: &str) -> Result<Vec<Entry>, SourceError>; async fn read(&self, path: &str) -> Result<FileData, SourceError>; async fn search(&self, q: &str, limit: usize) -> Result<Vec<Entry>, SourceError>; }` with `SourceError { code: ErrorCode, message: String, path: Option<String> }` and `FileData { path, kind, lang, mime, encoding: Encoding, content: Option<String>, size: u64, mtime: f64, git: Option<GitInfo> }`.
- Produces: `DiskSource::new(DiskOptions { target: PathBuf, ignore: Vec<String>, gitignore: bool, max_entries: usize, max_inline_bytes: u64 }) -> Result<DiskSource, SourceError>`; `DiskSource::root_dir(&self) -> &Path`; single-file target behaves as the Node one (root kind `file`, `list("")` returns that one entry).
- Produces: `git::last_commit(file: &Path) -> Option<GitInfo>` by `git log -1 --format=%H%n%an%n%at%n%s -- <file>` with `repo_url` from `git remote get-url origin` through `remote_to_web_url(&str) -> Option<String>` (ports `git.ts`: `git@host:org/repo.git` and `https://host/org/repo.git` → `https://host/org/repo`); cached per (path, mtime).

- [ ] **Step 1: Write failing tests** ported from `DiskSource.test.ts` and `git.test.ts` with `tempfile`: list root (dirs first, then files, name order), subfolder, `hasChildren`, gitignored and always-ignored entries hidden, `maxEntries` cap, read markdown `utf8`, small png `base64` (decodes to the `89 50 4E 47` header), large file `none`, unknown extension sniffed, not found, outside root, symlink inside root followed, symlink outside root → `outside_root` (Review Focus 1), single-file target, search by substring with limit, `remote_to_web_url` cases, `last_commit` in a temp repo with one commit and `None` outside a repo.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (tokio fs; `base64` crate). **Step 4: Run** → PASS. **Step 5: Commit** `feat(rust): DiskSource with git info`

---

### Task 6: Watcher

**Files:**

- Create: `crates/leaf-core/src/watch.rs`
- Test: `crates/leaf-core/tests/watch.rs`

**Interfaces:**

- Produces: `ChangeEvent { path: String, change: Change, from: Option<String> }`; `Watcher::start(root: PathBuf, ignorer: Arc<Ignorer>, tx: tokio::sync::broadcast::Sender<ChangeEvent>) -> Result<Watcher, WatchError>`; `Watcher::stop(self)`. Timing constants `DEBOUNCE_MS=60`, `RENAME_WINDOW_MS=200`, `MAX_HOLD_MS=500`, `SETTLE_MS=50`; rename pairing: a delete and a create within the window with the same basename, or in the same directory, become one `Renamed { path: new, from: old }`.

- [ ] **Step 1: Write failing tests** (tokio, real temp dirs, generous timeouts): create → `created`; append → one `modified` for a burst of three writes within 60 ms; `mv a.md b.md` → one `renamed` with `from`; temp-file-then-rename save (write `.a.md.tmp`, rename over `a.md`) → one `modified` for `a.md`, no `deleted` (Review Focus 2); a change under `node_modules/` → nothing; `stop` ends the stream.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** with `notify` (recommended watcher; FSEvents on macOS, inotify on Linux) feeding a debouncer task. **Step 4: Run on macOS** → PASS; note in the ledger that Linux CI must run the same file. **Step 5: Commit** `feat(rust): watcher with debounce and rename pairing`

---

### Task 7: Preferences store

**Files:**

- Create: `crates/leaf-core/src/prefs.rs`
- Test: `crates/leaf-core/tests/prefs.rs`

**Interfaces:**

- Produces: `PreferencesStore::new(file: PathBuf)`, `async fn load(&self) -> Preferences`, `async fn save(&self, patch: Preferences) -> Preferences` (merge, per-field validation drops unknown/invalid, atomic write via temp + rename, creates the directory, corrupt file reads as empty). Serialized `Preferences` must omit `None` fields.

- [ ] **Step 1: Write failing tests** ported from `PreferencesStore.test.ts`. **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS. **Step 5: Commit** `feat(rust): preferences store`

---

### Task 8: The Engine

**Files:**

- Create: `crates/leaf-core/src/engine.rs`
- Test: `crates/leaf-core/tests/engine.rs` with a `FakeSource` in `crates/leaf-core/src/testing.rs` (behind `#[cfg(any(test, feature = "testing"))]`)

**Interfaces:**

- Produces: `Engine::new(source: Arc<dyn Source>, prefs: Arc<PreferencesStore>, config: EngineConfig { plantuml_url, mention_url, topic_url, max_entries }) -> Arc<Engine>`; `SessionId(u64)`; `engine.connect() -> SessionId`; `async fn handle(&self, session: SessionId, msg: ClientMessage) -> Vec<ServerMessage>`; `fn disconnect(&self, session: SessionId)`; `fn client_count(&self) -> usize`; `fn pushes(&self) -> broadcast::Receiver<(SessionId, ServerMessage)>`; `fn feed_change(&self, ev: ChangeEvent)` (the Watcher's stream is fed by the app, so the Engine stays transport- and runtime-agnostic).
- Rules: first message must be `hello` (else one `error bad_request` and the session is marked closed; `handle` on a closed session returns nothing); `welcome` carries root, config, capabilities, `participant {id:"local", name:"You"}`, stored preferences; `subscribe ""` means everything; `subscribed_to(path)` is exact, `""`, or prefix with `/`; `changed` events fan out to sessions subscribed to `path` or `from`; `preferences` saves the patch; `search` uses the source with `max_entries` as the default limit; errors from the source become `error` replies with `inReplyTo`.

- [ ] **Step 1: Write failing tests** ported from `handlers.test.ts` and `ws.test`-style cases: hello → welcome (with preferences from a store seeded `{appearance: light}`); read before hello → `bad_request` and closed (Review Focus 3); list/tree, read/file, not found → error with `inReplyTo`, subscribe + feed_change → push only to subscribed sessions, rename pushes to subscribers of either path, unsubscribe stops pushes, preferences save, client_count tracks connect/disconnect.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (`DashMap` or `Mutex<HashMap>` for sessions; one `broadcast` channel). **Step 4: Run** → PASS. **Step 5: Commit** `feat(rust): the Engine, transport-free`

---

### Task 9: `leaf-app` serve mode (HTTP + WebSocket)

**Files:**

- Create: `crates/leaf-app/Cargo.toml`, `crates/leaf-app/build.rs` (fails with `build the ui first (bin/build)` when `../../packages/ui/dist/app/index.html` is missing), `crates/leaf-app/src/main.rs` (stub calling `serve`), `crates/leaf-app/src/http.rs`, `crates/leaf-app/src/ws.rs`, `crates/leaf-app/src/serve.rs`, `crates/leaf-app/src/log.rs`
- Test: `crates/leaf-app/tests/serve.rs`

**Interfaces:**

- Produces: `serve::start(config: &Config, engine: Arc<Engine>, source: Arc<DiskSource>) -> Result<Started { url: String, port: u16, shutdown: oneshot::Sender<()> }, ServeError>`; routes `/healthz` (200 `ok`), `/raw/<path>` (bytes via `source.read`-equivalent raw read confined by `paths::resolve_inside`, `Content-Type` from classify, `nosniff`, CSP sandbox for html/svg, 404 for missing/ignored/outside), `/ws` (upgrade only when `Origin` absent or loopback and `Host` loopback or `config.host`; one Engine session per socket; a forwarding task for pushes; `client_count` feeds the idle guard), everything else from the embedded UI with `index.html` fallback. Port fallback to 0 when `Sources.port == Default` and bind fails with `AddrInUse`.
- Produces: `log::init(level, format)` with the text and JSON formats from Global Constraints.

- [ ] **Step 1: Write failing integration tests**: start on port 0 with a temp folder; `GET /healthz` → `ok`; `/raw/README.md` → bytes with `text/markdown`; `/raw/../etc/passwd` → 404; `/raw/x.svg` → `Content-Security-Policy: sandbox`; `/` → html containing `<div id="root">`; `/docs/guide.md` → same html; WebSocket round trip hello → welcome → list → tree → subscribe → read → file; write the file on disk → `changed` within 1 s; `read` before `hello` → error then close; `Origin: http://evil.test` → upgrade refused (403); `Origin: http://localhost:<port>` accepted (Review Focus 4); shutdown closes sockets.
- [ ] **Step 2: Run** `cargo test -p leaf-app` → FAIL. **Step 3: Implement** (axum 0.7 with `ws`, `tower-http` not required; `rust-embed` for `../../packages/ui/dist/app`). **Step 4: Run** → PASS. **Step 5: Commit** `feat(rust): serve mode: http, websocket, embedded ui`

---

### Task 10: CLI, logging, idle, instance hand-off groundwork

**Files:**

- Create: `crates/leaf-app/src/cli.rs`, `crates/leaf-app/src/idle.rs`, `crates/leaf-app/src/instances.rs`
- Modify: `crates/leaf-app/src/main.rs`
- Test: `crates/leaf-app/tests/cli.rs`, `crates/leaf-app/tests/idle.rs`

**Interfaces:**

- Produces: `leaf serve [path]` runs serve mode in the foreground, prints the URL to stdout, opens a browser when `--open` is given (serve defaults to not opening), exits on ctrl-c with `shutting down` at info, or after `--idle-timeout` with no client. `leaf --help` prints the help text from the spec's CLI section (the Node `HELP_TEXT` adapted: `open`, `serve`, `share` listed, `share` marked "not yet available"), `leaf --version` prints the crate version. `leaf open [path]` in this task: until Task 14 lands, `open` behaves as `serve --open` with the Node `open` semantics of returning after launching a detached `serve` (ported `launch.rs`: spawn self detached with `serve <abs> --no-open --idle-timeout 10s`, wait for the URL on a pipe, print it, open the browser, return; registry under `<config_dir>/instances/<pid>.json`; reuse a live instance whose root contains the target). Task 14 replaces the `open` arm with the window.
- Produces: `idle::IdleGuard::new(startup_ms, idle_ms, on_idle)` with `.clients(n)` and `.stop()` (semantics as the Node guard).

- [ ] **Step 1: Write failing tests**: `--help` contains `leaf serve`; `--version`; idle guard timing with `tokio::time::pause`; CLI end-to-end ported from `daemon.test.ts` (open returns, registry has one, second open of a file inside prints `<url>/README.md`, a client that connects then leaves ends the server after `LEAF_IDLE_TIMEOUT=1s`, registry empty).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS. **Step 5: Commit** `feat(rust): cli, logging, idle, detached open`

---

### Task 11: The shared UI suite on three engines, binstubs

**Files:**

- Modify: `packages/ui/playwright.config.ts` (projects `chromium`, `webkit`, `firefox`; `webServer.command` uses `LEAF_BIN` when set: `${LEAF_BIN} serve ../../examples --port 4599 --host 127.0.0.1`, else the Node command), `packages/ui/e2e/smoke.spec.ts` (replace the clipboard-dependent assertions with engine-neutral ones; keep the Stage ink test), `bin/setup` (check `cargo`, print the rustup line), `bin/build` (`cargo build --release -p leaf-app` after the UI), `bin/test` (`LEAF_BIN=target/release/leaf` for the e2e; keep the Node e2e run until Task 15 removes it), `bin/run` (`cargo run -p leaf-app --`), `bin/dev` (Rust serve mode behind Vite), `bin/install` (symlink `target/release/leaf`)

- [ ] **Step 1: Run the suite against the Rust binary** `cd packages/ui && LEAF_BIN=../../target/release/leaf npx playwright test` → expect failures that are real differences (the Review Focus items are the suspects); fix in the Rust side, never by weakening the test, except clipboard checks which become `webkit`-skipped with a comment.
- [ ] **Step 2: Add webkit and firefox projects** (`npx playwright install webkit firefox`), run all three → PASS.
- [ ] **Step 3: Update the binstubs**, run `bin/test` end to end → PASS.
- [ ] **Step 4: Commit** `test: shared browser suite on chromium, webkit, firefox against the Rust serve mode; binstubs`

---

### Task 12: `TauriSource` in the UI

**Files:**

- Create: `packages/ui/src/source/TauriSource.ts`
- Modify: `packages/ui/src/index.ts` (export), `packages/ui/src/main.tsx` (pick `TauriSource` when `'__TAURI_INTERNALS__' in window`, else `WsSource`), `packages/ui/package.json` (`@tauri-apps/api` ^2 as a dependency)
- Test: `packages/ui/test/TauriSource.test.ts` (mock `@tauri-apps/api/core` `invoke` and `@tauri-apps/api/event` `listen`)

**Interfaces:**

- Produces: `class TauriSource implements DocumentSource { constructor(window: string = 'main'); send(msg: ClientMessage): void /* invoke('leaf_send', { window, msg }) */; onMessage(fn): () => void /* listen(`leaf://message/${window}`, e => fn(e.payload)) */; onStatus(fn): () => void /* 'open' after the first listen resolves */; close(): void }`.

- [ ] **Step 1: Write failing tests**: `send` calls `invoke('leaf_send', {window:'main', msg})`; a listened event with a `welcome` payload reaches `onMessage`; status goes `open`; `close` unlistens. **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS (and `layering.test.ts` still green). **Step 5: Commit** `feat(ui): TauriSource`

---

### Task 13: WebKit adapters in the Stage

**Files:**

- Modify: `packages/ui/src/stage/Stage.tsx` (gesture events), `packages/ui/src/stage/wheel.ts` (export `gestureFactor(scale, prev)`), `packages/ui/src/stage/image.ts` (`copyImage` uses `new ClipboardItem({'image/png': blobPromise})` with a Promise so Safari keeps the user gesture)
- Test: `packages/ui/test/wheel.test.ts`, `packages/ui/test/Stage.test.tsx`

**Interfaces:**

- Produces: on `gesturestart` record `scale=1`; on `gesturechange` call `viewport.zoomAt(cursor, e.scale / prevScale)` and `preventDefault` (so the page does not zoom); `gestureend` resets. Both `wheel` (ctrl) and `gesture*` paths zoom around the cursor.

- [ ] **Step 1: Write failing tests**: a synthetic `gesturechange` event with `scale: 1.5` on the viewport changes the layer transform by 1.5× and is default-prevented (Review Focus 5); `copyImage` passes a Promise to `ClipboardItem` (mock). **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS. **Step 5: Commit** `feat(ui): Stage pinch and clipboard on WebKit`

---

### Task 14: Window mode (Tauri)

**Files:**

- Create: `packages/ui/src/commands.ts`, `crates/leaf-app/tauri.conf.json`, `crates/leaf-app/capabilities/default.json`, `crates/leaf-app/icons/` (generated from `packages/ui/src/icons/Leaf.tsx` rendered to png via the UI build; a placeholder set is acceptable in this task), `crates/leaf-app/src/window.rs` (commands `leaf_send(window, msg)` → `engine.handle` then emit replies as `leaf://message/<window>`; a per-window Engine session; pushes forwarded by a task), `crates/leaf-app/src/app.rs` (Tauri builder: single-instance plugin whose callback receives argv from a second `leaf open` and opens a window for that path; one Engine per root in a `HashMap<PathBuf, Arc<Engine>>`; window close → session disconnect; last window closed → exit)
- Modify: `crates/leaf-app/src/main.rs` (`open` arm: if the app is running, hand off argv through the single-instance channel and return; else run the Tauri app with the first window), `crates/leaf-app/Cargo.toml` (tauri 2, tauri-plugin-single-instance, tauri-build)
- Test: `packages/ui/test/commands.test.ts` (every shortcut routes through `runCommand`; a `leaf://command` event with `toggleOutline` under a mocked Tauri global toggles the outline, `setAppearance` with `dark` sets it); `packages/ui/test/nativeLook.test.tsx` (under a mocked Tauri global the Appearance menu offers only light, dark, system, the bar has the traffic-light inset class, and `data-theme` is `native`); `crates/leaf-app/tests/window.rs` (the command layer without a webview: `leaf_send` with `hello` yields a `welcome` event payload; a disk change yields a `changed` event for a subscribed window); manual acceptance checklist in `.superpowers/plans/2026-10-27-leaf-app-window-acceptance.md` for what needs a real display (window opens, second `leaf open` adds a window, pinch, ink, quit on last close)

**Interfaces:**

- Consumes: `TauriSource` event names and the `leaf_send` command from Task 12.
- Produces: `leaf open <path>` opens a window on the folder; `leaf open <file>` opens the window at that file (`path` passed to the UI through the window's initial URL hash, which the router already reads).
- Produces (commands): `packages/ui/src/commands.ts` exports `COMMANDS` (the names in the spec's list that exist in delivery 1) and `runCommand(name, arg?)`, built from the actions `installShortcuts` already takes; `shortcuts.ts` dispatches through it. Under Tauri the UI listens for `leaf://command` events `{ name, arg? }` and calls `runCommand`. On the Rust side `app.rs` builds the native menu (File: Open Folder…; View: Light, Dark, System, Files, Outline, Number Headings, Larger Text, Smaller Text, Actual Text Size; Window: standard) whose items emit `leaf://command` to the focused window; Open Folder… uses the dialog plugin and then the same path as `leaf open`.
- Produces (look): `tauri.conf.json` window with `titleBarStyle: "Overlay"`, `hiddenTitle: true`, and transparent background so the traffic lights sit inside leaf's bar; the UI, when running under Tauri, adds left padding to the bar for them, hides the theme picker (Appearance menu becomes light / dark / system, default system), and uses the `native` document look: one token set derived from the current `glass` chrome and the `github` document conventions, `-apple-system` at 15px, native scrollbars (`::-webkit-scrollbar` left alone). The four browser-era themes are not removed from the code in this task; they are simply not offered in the app (a later cleanup deletes them).

- [ ] **Step 1: Write the failing command-layer test**. **Step 2: Run** → FAIL. **Step 3: Implement** (`cargo tauri` not required; plain `tauri` crate with `tauri-build`; the UI's `dist/app` is the `frontendDist`). **Step 4: Run** the test → PASS; run `cargo run -p leaf-app -- open examples` by hand and walk the acceptance checklist; record results in the ledger. **Step 5: Commit** `feat(app): window mode with single instance`

---

### Task 15: Docs, bin/dev, and the Node server stepped aside

**Files:**

- Modify: `README.md` (install: `cargo install --path crates/leaf-app` / `bin/install`; use: `leaf open docs` opens a window, `leaf serve` for a socket; remove the npx line and the 10-second idle paragraph for `open`), `.superpowers/specs/2026-10-27-leaf-app-design.md` (status: delivery 1 shipped; note deviations), `bin/dev` and `bin/run` on the Rust binary, `bin/test` drops the Node e2e run (Node unit tests stay until delivery 4), `packages/server/README.md` or a note at the top of `packages/server/src/main.ts`: "retired by the Rust app; deleted in delivery 4"

- [ ] **Step 1: Make the edits.** **Step 2: Run** `bin/test` and `bin/lint` → PASS. **Step 3: Commit** `docs: delivery 1 shipped; node server stepped aside`

---

## Self-review notes

- Spec coverage: §1 story 1 (Tasks 2–10, 14), §3 constraints (Global Constraints, Tasks 4, 9), §4 architecture (Tasks 1, 8, 9, 12, 14), §5 all five lines (Tasks 5, 6, 7, 8, 9, 10), WebKit adapters and three engines (Tasks 11, 13), §8 step 1 (Task 15). Sharing, relay, agents, packaging: later plans by design.
- Type consistency: `Engine::handle` returns `Vec<ServerMessage>` in Tasks 8, 9, 14; `ChangeEvent` from Task 6 is what Task 8's `feed_change` takes; `TauriSource` event names match Task 14's emit.
- Review Focus 1–5 each pinned to a task.
- Proportion: this plan is shorter than the Node server it replaces; code bodies appear only where the signature leaves a choice.
