# leaf Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `leaf open examples` serves a folder of markdown over a local WebSocket server and renders it GitHub-quality in the browser with live updates, tree, outline, numbering, anchors, palette, three themes, and text size; non-markdown files get a code view, native media, or a metadata card.

**Architecture:** Three npm workspaces. `@leaf/protocol` holds zod schemas for every WebSocket message and is the only thing server and UI share. `@leaf/server` is a Node process: config from dotenv, a `DiskSource` behind a `Source` interface, a chokidar watcher, a typed bus, and a `ws` transport that dispatches on message type through a handler map; HTTP serves `/raw/*` and the built UI. `@leaf/ui` is a React library (`<Reader source>`), where the store talks only to a `DocumentSource` that is literally the protocol (`send(ClientMessage)` / `onMessage(ServerMessage)`), rendering is a pure unified pipeline, and every format is a `Viewer` with `Inline` and `Rich` components.

**Tech Stack:** Node ≥ 22, TypeScript, npm workspaces, tsx, tsup, vitest, zod, ws, chokidar, ignore, dotenv, pino + pino-pretty, open; React 19, Vite, zustand, Tailwind v4, unified/remark/rehype, shiki, KaTeX, CodeMirror 6, @testing-library/react, Playwright.

**Spec:** `.superpowers/specs/2026-10-24-leaf-design.md` (sections cited as §N). Theme tokens: `.superpowers/specs/mockups/2026-10-25-leaf-themes.html`.

**Out of scope for this plan** (separate plans follow): diagram viewers (mermaid, plantuml, excalidraw), notebook/geojson/csv/stl viewers, the Stage with pan/zoom/drawing annotations, interactive tables and `<!-- table:filter -->` directives, copy-as-image, `StaticSource` and `leaf export`, remote sources, collaborative events.

## Global Constraints

- Node ≥ 22; TypeScript strict; ESM everywhere (`"type": "module"`). _(§3)_
- Package names `@leaf/protocol`, `@leaf/server`, `@leaf/ui`; CLI bin name `leaf`; subcommand form `leaf open [path]`, bare `leaf [path]` = `open`. _(§3, §6.1)_
- Config precedence: CLI flags > process env > `.env` (dotenv) > defaults. Variables exactly: `HOST` (default `127.0.0.1`), `PORT` (`0`), `LOG_LEVEL` (`info`), `PLANTUML_URL` (unset), `LEAF_OPEN` (`true`), `LEAF_IGNORE` (`.git,node_modules,.DS_Store`), `LEAF_GITIGNORE` (`true`), `LEAF_MAX_ENTRIES` (`5000`), `LEAF_MAX_INLINE_BYTES` (`2097152`), `LEAF_ANNOTATION_TTL` (`24h`), `LEAF_MENTION_URL`, `LEAF_TOPIC_URL`. Flags: `--host`, `--port`, `-l`/`--log-level`, `--plantuml-url`, `--open/--no-open`, `--ignore`, `--gitignore/--no-gitignore`. _(§6.1)_
- Logs: one event per line to stdout only; pretty when stdout is a TTY, JSON otherwise; levels `error|warn|info|debug`; `debug` logs every WS message in and out complete and unredacted. _(§6.1a)_
- Protocol paths are relative to root, POSIX separators, no leading slash. Protocol version `1`. Every message may carry `id`; replies echo `inReplyTo`. Unknown message types are logged at `warn` and ignored, never a disconnect. _(§5)_
- Path confinement: `read`, `list`, `search`, and `/raw` never resolve outside the root; symlink escapes are `outside_root` / HTTP 403. _(§5.3, §6.4)_
- Nothing outside `ui/src/source/` touches the network; nothing in `components/`, `viewers/`, `stage/`, `render/` imports from `source/`; `render/` never reads the store. _(§7.1)_
- Every color/radius/font in the UI is a CSS custom property; components never branch on theme name. Themes: `glass` (default), `card`, `paper`; appearance: `light|dark|auto`. _(§8.6a, §10)_
- Icons are hand-written SVG React components in `ui/src/icons/`; no icon library, no emoji. _(§3, §10)_
- `examples/` must demonstrate every feature this plan ships; the Playwright smoke test opens it. _(§9)_
- Binstubs: bash, `#!/usr/bin/env bash`, `set -euo pipefail`, `cd "$(dirname "$0")/.."`, `usage()` with `-h|--help`, `.env.example` copied to `.env` on first run. _(§3)_
- Commit after every task with a conventional-commit message ending in the attribution line `Claude-Session: https://claude.ai/code/session_012FN6bb8ockWHy6tJQ9A3Lk`.

## Review Focus

1. **A file over `LEAF_MAX_INLINE_BYTES`** (a 5 MB log in the opened folder): `read` must reply `file` with `encoding: "none"`, no `content`, and the UI shows the binary card with a download link rather than hanging or crashing. Test pinned in Task 4.
2. **A `.gitignore`d file opened explicitly** (`leaf open build/notes.md` inside a repo that ignores `build/`): it must open. Only _other_ ignored entries are hidden. Test pinned in Task 4.
3. **Rapid saves** (an editor writing the same file 5 times in 100 ms): the UI receives one `changed` after the debounce window and re-reads once; scroll position is unchanged. Test pinned in Task 4 (watcher) and Task 10 (store).
4. **Duplicate heading text** (`## Setup` twice): slugs are `setup` and `setup-1`, outline links target the right one, and `#setup-1` in the URL scrolls to the second. Test pinned in Task 7.
5. **The WebSocket drops** (server restarted while the page is open): the connection dot turns amber, the last render stays, the client reconnects with backoff, re-sends `hello`, re-subscribes, and re-reads the open path. Test pinned in Task 10.

---

## File Structure

```
leaf/
  package.json                 npm workspaces: packages/*; root scripts test/build/lint
  tsconfig.base.json           strict, ESM, bundler resolution
  vitest.workspace.ts          runs each package's vitest config
  .env.example, .gitignore
  bin/ setup dev test build lint run
  examples/                    living corpus (§9)
  packages/
    protocol/
      src/index.ts             re-exports
      src/common.ts            Entry, Capabilities, Config, Participant, ErrorCode, PROTOCOL_VERSION
      src/client.ts            hello, list, read, subscribe, unsubscribe, search; ClientMessage union; parseClientMessage
      src/server.ts            welcome, tree, file, changed, matches, error; ServerMessage union; parseServerMessage
      scripts/schema.ts        writes schema/*.json
      test/messages.test.ts
    server/
      src/cli.ts               argv → ParsedArgs; help text
      src/config.ts            loadConfig(argv, env, cwd) → Config (+ sources for debug)
      src/log.ts               createLogger(level, pretty)
      src/source/Source.ts     interface Source, FileData, ChangeEvent
      src/source/classify.ts   classify(relPath) → { kind, lang?, mime }
      src/source/paths.ts      toPosix, resolveInside(rootAbs, rel) → abs | null
      src/source/ignore.ts     createIgnorer(rootAbs, patterns, useGitignore) → Ignorer
      src/source/DiskSource.ts
      src/watch/Watcher.ts     createWatcher(rootAbs, ignorer, onChange, opts)
      src/events/Bus.ts        Bus<Events>
      src/transport/http.ts    createHttpHandler({ source, staticDir, log })
      src/transport/ws.ts      attachWs(httpServer, deps); Session
      src/transport/handlers/{hello,list,read,subscribe,unsubscribe,search}.ts + index.ts (handler map)
      src/server.ts            startServer(config, deps?) → { url, port, close }
      src/main.ts              CLI entry: loadConfig → startServer → open browser → signals
      bin/leaf.js              #!/usr/bin/env node; imports dist/main.js
      test/...                 one test file per module + test/integration.test.ts
    ui/
      index.html, vite.config.ts (app), vite.lib.config.ts (library)
      src/main.tsx             app: <Reader source={new WsSource(url)} />
      src/index.ts             library exports
      src/source/DocumentSource.ts, WsSource.ts, createSource.ts
      src/store/documents.ts, ui.ts, index.ts (useLeaf)
      src/render/pipeline.ts, slug.ts, headings.ts
      src/render/registries/{blocks,inline,parsers}.ts
      src/render/inline/{mention,topic}.ts
      src/render/plugins/{rehypeInline,rehypePos,remarkAlerts}.ts
      src/viewers/registry.ts, types.ts
      src/viewers/{markdown,code,image,media,binary}/index.tsx
      src/components/{Reader,Markdown,Layout,TopBar,Tree,Outline,Palette,ConnectionDot,TextSize,ThemeMenu,IconButton}.tsx
      src/router.ts
      src/shortcuts.ts
      src/icons/*.tsx
      src/styles/leaf.css, themes/{glass,card,paper}.css
      fixtures/*.md
      test/... (vitest + testing-library), e2e/smoke.spec.ts (Playwright)
```

---

### Task 1: Repo scaffold, binstubs, and the protocol package

**Files:**

- Create: `package.json`, `tsconfig.base.json`, `vitest.workspace.ts`, `.env.example`, `.gitignore`, `.prettierrc`
- Create: `bin/setup`, `bin/dev`, `bin/test`, `bin/build`, `bin/lint`, `bin/run`
- Create: `packages/protocol/package.json`, `tsconfig.json`, `vitest.config.ts`, `src/index.ts`, `src/common.ts`, `src/client.ts`, `src/server.ts`, `scripts/schema.ts`
- Test: `packages/protocol/test/messages.test.ts`

**Interfaces:**

- Produces (from `@leaf/protocol`):
  - `PROTOCOL_VERSION = 1 as const`
  - `Entry = z.object({ path, name, kind: z.enum(['file','dir']), size?: number, mtime?: number, hasChildren?: boolean })`; type `Entry`
  - `Capabilities = z.object({ watch: boolean, write: boolean, collaborate: boolean })`
  - `Config = z.object({ plantumlUrl?: string, mentionUrl?: string, topicUrl?: string })`
  - `Participant = z.object({ id: string, name: string, color?: string })`
  - `ErrorCode = z.enum(['not_found','outside_root','unsupported','bad_request','internal'])`
  - `FileKind = z.string()` with exported constants `FILE_KINDS = ['markdown','text','image','media','pdf','binary'] as const`
  - Client messages (each `z.object({ type: z.literal(name), id?: string, ...payload })`): `hello { protocol: 1 }`, `list { path?: string }`, `read { path: string }`, `subscribe { path: string }`, `unsubscribe { path: string }`, `search { q: string, limit?: number }`
  - Server messages (each with `id?`, `inReplyTo?`): `welcome { protocol: 1, root: { kind: 'file'|'dir', name: string }, config: Config, capabilities: Capabilities, participant: Participant }`, `tree { path: string, entries: Entry[] }`, `file { path, kind: FileKind, lang?: string, mime: string, encoding: 'utf8'|'none', content?: string, url: string, size: number, mtime: number }`, `changed { path, change: 'created'|'modified'|'deleted'|'renamed', from?: string }`, `matches { q: string, entries: Entry[] }`, `error { code: ErrorCode, message: string, path?: string }`
  - `ClientMessage = z.discriminatedUnion('type', [...])`, `ServerMessage` likewise; types `ClientMessage`, `ServerMessage`, and per-message types `HelloMessage`, `FileMessage`, etc.
  - `parseClientMessage(input: unknown): ClientMessage` and `parseServerMessage(input: unknown): ServerMessage` (throw `ZodError`)
  - `isKnownClientType(type: string): boolean`, `isKnownServerType(type: string): boolean`

- [ ] **Step 1: Initialize the repo and workspaces**

`git init` in `/Users/rob/code/read`. Root `package.json`: `"private": true`, `"type": "module"`, `"workspaces": ["packages/*"]`, `"engines": { "node": ">=22" }`, scripts `test` (`vitest run`), `build` (`npm run build --workspaces --if-present`), `lint` (`tsc -b && prettier --check .`), devDependencies `typescript`, `vitest`, `prettier`, `tsx`. `tsconfig.base.json`: `strict`, `module: NodeNext`/`moduleResolution: NodeNext` for server/protocol (the UI overrides to `Bundler`), `target: ES2022`, `declaration`. `vitest.workspace.ts` lists `packages/*/vitest.config.ts`. `.gitignore`: `node_modules/`, `dist/`, `.env`, `.superpowers/`, `test-results/`, `playwright-report/`. `.env.example` lists every variable from Global Constraints with its default, commented.

- [ ] **Step 2: Write the binstubs**

Each per the Global Constraints style. `bin/setup`: `need node "install Node 22 or newer"`, `npm install`, copy `.env.example` → `.env`, `npx playwright install chromium`. `bin/test`: `npm test` then `npm run e2e -w @leaf/ui` (the e2e script exists from Task 11; until then `--if-present`). `bin/build`: `npm run build -w @leaf/protocol -w @leaf/ui -w @leaf/server` in that order. `bin/lint`: `npm run lint`. `bin/dev`: starts `npm run dev -w @leaf/server -- open "${1:-examples}"` with `PORT=${PORT:-4321}` and `LEAF_OPEN=false`, and `npm run dev -w @leaf/ui` (Vite on 5173, proxying `/ws` and `/raw` to 4321); opens `http://localhost:5173` when `-o` is passed; both processes stream logs with a prefix; `trap` kills both on exit. `bin/run`: `exec npx tsx packages/server/src/main.ts "$@"`. `chmod +x bin/*`.

- [ ] **Step 3: Write the failing protocol tests**

```ts
// packages/protocol/test/messages.test.ts
import { describe, it, expect } from 'vitest';
import {
  parseClientMessage,
  parseServerMessage,
  PROTOCOL_VERSION,
  isKnownClientType,
  FILE_KINDS,
} from '../src/index.js';

describe('protocol', () => {
  it('version is 1', () => expect(PROTOCOL_VERSION).toBe(1));
  it('parses hello', () =>
    expect(parseClientMessage({ type: 'hello', protocol: 1 })).toEqual({
      type: 'hello',
      protocol: 1,
    }));
  it('rejects hello with wrong version', () =>
    expect(() => parseClientMessage({ type: 'hello', protocol: 2 })).toThrow());
  it('parses read with id', () =>
    expect(parseClientMessage({ type: 'read', path: 'docs/a.md', id: 'r1' })).toMatchObject({
      path: 'docs/a.md',
      id: 'r1',
    }));
  it('rejects read without path', () =>
    expect(() => parseClientMessage({ type: 'read' })).toThrow());
  it('rejects unknown client type', () => {
    expect(isKnownClientType('nope')).toBe(false);
    expect(() => parseClientMessage({ type: 'nope' })).toThrow();
  });
  it('parses a file message with encoding none and no content', () => {
    const m = parseServerMessage({
      type: 'file',
      path: 'a.bin',
      kind: 'binary',
      mime: 'application/octet-stream',
      encoding: 'none',
      url: '/raw/a.bin',
      size: 10,
      mtime: 1,
    });
    expect(m).toMatchObject({ type: 'file', encoding: 'none' });
    expect('content' in m && m.content).toBeUndefined();
  });
  it('parses welcome', () =>
    expect(
      parseServerMessage({
        type: 'welcome',
        protocol: 1,
        root: { kind: 'dir', name: 'examples' },
        config: {},
        capabilities: { watch: true, write: false, collaborate: false },
        participant: { id: 'local', name: 'You' },
      }).type,
    ).toBe('welcome'));
  it('parses changed with from on rename', () =>
    expect(
      parseServerMessage({ type: 'changed', path: 'b.md', change: 'renamed', from: 'a.md' }),
    ).toMatchObject({ from: 'a.md' }));
  it('rejects error with unknown code', () =>
    expect(() => parseServerMessage({ type: 'error', code: 'weird', message: 'x' })).toThrow());
  it('exposes file kinds', () => expect(FILE_KINDS).toContain('markdown'));
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npm install && npx vitest run packages/protocol`
Expected: FAIL (module `../src/index.js` not found).

- [ ] **Step 5: Implement the protocol package**

`packages/protocol/package.json`: name `@leaf/protocol`, `exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } }`, scripts `build` (`tsc -p tsconfig.json`), `schema` (`tsx scripts/schema.ts`), dependencies `zod`, devDependencies `zod-to-json-schema`. Implement `common.ts`, `client.ts`, `server.ts` with the schemas in Interfaces; `index.ts` re-exports everything. `scripts/schema.ts` writes one JSON Schema per message into `packages/protocol/schema/` using `zod-to-json-schema`, plus `client.json` and `server.json` for the unions. Set `"files": ["dist", "schema"]`.

- [ ] **Step 6: Run tests to verify they pass; generate schema**

Run: `npx vitest run packages/protocol && npm run schema -w @leaf/protocol && ls packages/protocol/schema`
Expected: PASS (11 tests); schema dir lists `hello.json … error.json client.json server.json`.

- [ ] **Step 7: Verify binstubs and lint**

Run: `bin/lint && bin/test`
Expected: both exit 0 (vitest reports the protocol tests).

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "chore: scaffold workspaces, binstubs, and @leaf/protocol"
```

---

### Task 2: Server config, logging, and CLI parsing

**Files:**

- Create: `packages/server/package.json`, `tsconfig.json`, `vitest.config.ts`, `src/cli.ts`, `src/config.ts`, `src/log.ts`
- Test: `packages/server/test/cli.test.ts`, `packages/server/test/config.test.ts`, `packages/server/test/log.test.ts`

**Interfaces:**

- Produces:
  - `parseArgs(argv: string[]): ParsedArgs` where `ParsedArgs = { command: 'open' | 'export' | 'help' | 'version', target: string, flags: Partial<FlagValues> }` and `FlagValues = { host: string, port: number, logLevel: LogLevel, plantumlUrl: string, open: boolean, ignore: string, gitignore: boolean }`. Bare `leaf path` → `command: 'open'`. No args → `open` with target `.`. `-h/--help` → `help`. Unknown flag throws `CliError(message)`.
  - `HELP_TEXT: string` (usage for `open`, `export`, every flag with its env name and default).
  - `type LogLevel = 'error' | 'warn' | 'info' | 'debug'`
  - `loadConfig(argv: string[], env: NodeJS.ProcessEnv, cwd: string): { config: Config, sources: Record<keyof Config, 'default' | 'dotenv' | 'env' | 'flag'> }` with `Config = { command, target: string (absolute), host, port, logLevel, plantumlUrl?: string, open: boolean, ignore: string[], gitignore: boolean, maxEntries: number, maxInlineBytes: number, annotationTtlMs: number, mentionUrl?: string, topicUrl?: string }`. Reads `${cwd}/.env` with `dotenv.parse` when present. `LEAF_ANNOTATION_TTL` accepts `24h`, `90m`, `3600s`, or plain ms.
  - `createLogger(opts: { level: LogLevel, pretty: boolean, stream?: NodeJS.WritableStream }): Logger` (pino instance). `Logger` = pino's type.

- [ ] **Step 1: Write the failing tests**

```ts
// test/cli.test.ts
import { parseArgs, HELP_TEXT } from '../src/cli.js';
it('bare path is open', () =>
  expect(parseArgs(['README.md'])).toMatchObject({ command: 'open', target: 'README.md' }));
it('open with flags', () =>
  expect(parseArgs(['open', 'docs', '-l', 'debug', '--port', '5000', '--no-open'])).toMatchObject({
    command: 'open',
    target: 'docs',
    flags: { logLevel: 'debug', port: 5000, open: false },
  }));
it('defaults to current dir', () =>
  expect(parseArgs([])).toMatchObject({ command: 'open', target: '.' }));
it('help', () => {
  expect(parseArgs(['--help']).command).toBe('help');
  expect(HELP_TEXT).toContain('leaf open');
  expect(HELP_TEXT).toContain('LOG_LEVEL');
});
it('unknown flag throws', () =>
  expect(() => parseArgs(['open', '.', '--bogus'])).toThrow(/--bogus/));

// test/config.test.ts  (uses a temp dir with a .env file)
it('precedence: flag > env > dotenv > default', () => {
  writeFileSync(join(tmp, '.env'), 'PORT=1111\nLOG_LEVEL=warn\n');
  const { config, sources } = loadConfig(
    ['open', '.', '--port', '3333'],
    { LOG_LEVEL: 'debug' },
    tmp,
  );
  expect(config.port).toBe(3333);
  expect(sources.port).toBe('flag');
  expect(config.logLevel).toBe('debug');
  expect(sources.logLevel).toBe('env');
  expect(config.host).toBe('127.0.0.1');
  expect(sources.host).toBe('default');
});
it('dotenv applies when env is empty', () => {
  /* same .env */ expect(loadConfig(['open', '.'], {}, tmp).config.logLevel).toBe('warn');
});
it('parses ignore list and ttl', () => {
  const { config } = loadConfig(
    ['open', '.'],
    { LEAF_IGNORE: 'a, b ,c', LEAF_ANNOTATION_TTL: '90m' },
    tmp,
  );
  expect(config.ignore).toEqual(['a', 'b', 'c']);
  expect(config.annotationTtlMs).toBe(90 * 60_000);
});
it('target is absolute', () =>
  expect(isAbsolute(loadConfig(['open', 'docs'], {}, tmp).config.target)).toBe(true));
it('rejects bad port', () =>
  expect(() => loadConfig(['open', '.'], { PORT: 'abc' }, tmp)).toThrow(/PORT/));

// test/log.test.ts
it('json when not pretty', async () => {
  const chunks: string[] = [];
  const stream = new Writable({
    write(c, _e, cb) {
      chunks.push(String(c));
      cb();
    },
  });
  const log = createLogger({ level: 'info', pretty: false, stream });
  log.info({ path: 'a.md' }, 'opened');
  await new Promise((r) => setTimeout(r, 10));
  const line = JSON.parse(chunks.join('').trim().split('\n')[0]);
  expect(line.msg).toBe('opened');
  expect(line.path).toBe('a.md');
  expect(line.level).toBe(30);
});
it('respects level', () => {
  /* debug message at info level produces no output */
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/server`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement `cli.ts`, `config.ts`, `log.ts`**

`packages/server/package.json`: name `@leaf/server`, `bin: { leaf: "./bin/leaf.js" }`, scripts `dev` (`tsx src/main.ts`), `build` (`tsup src/main.ts --format esm --dts false --out-dir dist`), dependencies `@leaf/protocol` (`"*"` workspace), `zod`, `dotenv`, `pino`, `pino-pretty`, `ws`, `chokidar`, `ignore`, `open`, `mime-types`; devDependencies `@types/ws`, `@types/mime-types`, `tsup`. Hand-roll `parseArgs` (no CLI library; the flag set is small). `loadConfig` builds a zod schema for the merged values and reports each key's source. `createLogger` uses `pino` with `pino-pretty` transport (`colorize: true, translateTime: 'HH:MM:ss'`) when `pretty`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/server`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(server): config from dotenv/env/flags, pino logging, cli parsing"
```

---

### Task 3: File classification, path confinement, and ignore rules

**Files:**

- Create: `packages/server/src/source/classify.ts`, `src/source/paths.ts`, `src/source/ignore.ts`
- Test: `packages/server/test/classify.test.ts`, `test/paths.test.ts`, `test/ignore.test.ts`

**Interfaces:**

- Produces:
  - `classify(relPath: string): { kind: string; lang?: string; mime: string }`. Extension table: `.md .markdown → markdown`; `.png .jpg .jpeg .gif .webp .svg .avif → image`; `.mp4 .webm .mp3 .wav .ogg → media`; `.pdf → pdf`; a text table (`.ts .tsx .js .jsx .json .yaml .yml .toml .py .rb .go .rs .sh .css .html .txt .env .sql .c .h .cpp .java .kt .swift .lua .ini .cfg .xml .csv .tsv .mmd .puml .geojson .ipynb .excalidraw` and extensionless `Dockerfile Makefile LICENSE README`) → `text` with `lang` from a name map (`.ts → typescript`, `.py → python`, `.mmd → mermaid`, `.puml → plantuml`, `.ipynb → json`, …); anything else `binary`. `mime` from `mime-types` with `text/plain` fallback for text.
  - `toPosix(p: string): string`; `resolveInside(rootAbs: string, rel: string): Promise<string | null>` returns the absolute path if (after `realpath` of the nearest existing ancestor) it is inside `rootAbs`, else `null`. `..` segments and absolute `rel` → `null`.
  - `createIgnorer(rootAbs: string, patterns: string[], useGitignore: boolean): Ignorer` with `Ignorer.ignores(relPath: string, isDir: boolean): boolean`. Semantics: `patterns` are gitignore-style and always apply; when `useGitignore`, every `.gitignore` from root down to the entry's directory applies with `ignore` package semantics (nested files scoped to their directory). `.gitignore` files are read lazily and cached per directory.

- [ ] **Step 1: Write the failing tests**

```ts
// classify.test.ts
it.each([
  ['a.md', 'markdown', undefined],
  ['x/b.PNG', 'image', undefined],
  ['c.ts', 'text', 'typescript'],
  ['flow.mmd', 'text', 'mermaid'],
  ['Dockerfile', 'text', 'dockerfile'],
  ['blob.bin', 'binary', undefined],
  ['clip.mp4', 'media', undefined],
  ['paper.pdf', 'pdf', undefined],
])('%s → %s/%s', (p, kind, lang) =>
  expect(classify(p)).toMatchObject(lang ? { kind, lang } : { kind }),
);
it('mime for svg', () => expect(classify('logo.svg').mime).toBe('image/svg+xml'));

// paths.test.ts (temp root with a symlink pointing outside)
it('resolves inside', async () =>
  expect(await resolveInside(root, 'docs/a.md')).toBe(join(root, 'docs/a.md')));
it('rejects dotdot', async () => expect(await resolveInside(root, '../etc/passwd')).toBeNull());
it('rejects absolute', async () => expect(await resolveInside(root, '/etc/passwd')).toBeNull());
it('rejects symlink escape', async () => {
  symlinkSync(outsideDir, join(root, 'esc'));
  expect(await resolveInside(root, 'esc/secret.txt')).toBeNull();
});
it('posix', () => expect(toPosix('a\\b\\c.md')).toBe('a/b/c.md'));

// ignore.test.ts (temp root: .gitignore "dist/\n*.log", sub/.gitignore "secret.md")
it('always patterns', () =>
  expect(createIgnorer(root, ['.git', 'node_modules'], false).ignores('node_modules', true)).toBe(
    true,
  ));
it('root gitignore', () => {
  const ig = createIgnorer(root, [], true);
  expect(ig.ignores('dist', true)).toBe(true);
  expect(ig.ignores('app.log', false)).toBe(true);
  expect(ig.ignores('app.md', false)).toBe(false);
});
it('nested gitignore is scoped', () => {
  const ig = createIgnorer(root, [], true);
  expect(ig.ignores('sub/secret.md', false)).toBe(true);
  expect(ig.ignores('secret.md', false)).toBe(false);
});
it('gitignore off', () => expect(createIgnorer(root, [], false).ignores('dist', true)).toBe(false));
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/server/test/classify.test.ts packages/server/test/paths.test.ts packages/server/test/ignore.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the three modules**

- [ ] **Step 4: Run tests to verify they pass**

Run: same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(server): classify files, confine paths, gitignore-aware ignorer"
```

---

### Task 4: DiskSource and the watcher

**Files:**

- Create: `packages/server/src/source/Source.ts`, `src/source/DiskSource.ts`, `src/watch/Watcher.ts`, `src/events/Bus.ts`
- Test: `packages/server/test/DiskSource.test.ts`, `test/Watcher.test.ts`

**Interfaces:**

- Consumes: `classify`, `resolveInside`, `toPosix`, `createIgnorer` (Task 3); `Entry`, `Capabilities` (Task 1).
- Produces:
  - `type FileData = { path: string; kind: string; lang?: string; mime: string; encoding: 'utf8' | 'none'; content?: string; size: number; mtime: number }`
  - `type ChangeEvent = { path: string; change: 'created' | 'modified' | 'deleted' | 'renamed'; from?: string }`
  - `interface Source { root(): { kind: 'file' | 'dir'; name: string }; list(path: string): Promise<Entry[]>; read(path: string): Promise<FileData>; search(q: string, limit: number): Promise<Entry[]>; watch(cb: (ev: ChangeEvent) => void): () => void; capabilities(): Capabilities; write?(path: string, content: string): Promise<void> }`
  - `class SourceError extends Error { constructor(public code: ErrorCode, message: string, public path?: string) }`
  - `class DiskSource implements Source` with `constructor(opts: { target: string (absolute file or dir); ignore: string[]; gitignore: boolean; maxEntries: number; maxInlineBytes: number; log: Logger; watcherFactory?: typeof createWatcher })`. Rules (§6.1, §6.3): for a file target, `rootDir` = its parent, `root()` = `{ kind: 'file', name }`, `list('')` returns only that file; for a dir target `list(path)` returns one level, dirs first, case-insensitive, excluding ignored entries, `hasChildren` true for dirs with ≥1 non-ignored child; `read` of an ignored path succeeds only if it equals the file target; files over `maxInlineBytes` or non-text kinds return `encoding: 'none'`; `search` walks lazily breadth-first with the ignorer, matches case-insensitive subsequence on the relative path, stops at `limit`; `capabilities()` = `{ watch: true, write: false, collaborate: false }`.
  - `createWatcher(rootAbs: string, ignorer: Ignorer, onChange: (ev: ChangeEvent) => void, opts?: { debounceMs?: number (default 60) }): { close(): Promise<void> }` using chokidar with `ignoreInitial: true`, `ignored` bound to the ignorer, `awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 10 }`; multiple events for the same path within `debounceMs` collapse into the last one; an `unlink` followed within `debounceMs` by an `add` of a different path with the same basename is emitted as `renamed` with `from`.
  - `class Bus<E extends Record<string, unknown>>` with `on<K>(name, fn): () => void`, `emit<K>(name, payload)`; events used: `{ 'file:changed': ChangeEvent }`.

- [ ] **Step 1: Write the failing tests**

```ts
// DiskSource.test.ts — temp dir fixture: README.md, docs/guide.md, docs/img.png, big.log (3 MB), node_modules/x.js, .gitignore "build/", build/notes.md
it('dir root lists one level, dirs first, ignoring', async () => {
  const entries = await src.list('');
  expect(entries.map((e) => e.path)).toEqual(['docs', 'README.md', 'big.log']); // node_modules + build ignored
  expect(entries[0]).toMatchObject({ kind: 'dir', hasChildren: true });
});
it('lists a subfolder', async () =>
  expect((await src.list('docs')).map((e) => e.path)).toEqual(['docs/guide.md', 'docs/img.png']));
it('reads markdown inline', async () =>
  expect(await src.read('docs/guide.md')).toMatchObject({
    kind: 'markdown',
    encoding: 'utf8',
    content: expect.stringContaining('#'),
  }));
it('large file is not inlined', async () => {
  const f = await src.read('big.log');
  expect(f.encoding).toBe('none');
  expect(f.content).toBeUndefined();
  expect(f.size).toBeGreaterThan(2_000_000);
});
it('image is not inlined', async () =>
  expect((await src.read('docs/img.png')).encoding).toBe('none'));
it('not found', async () =>
  await expect(src.read('nope.md')).rejects.toMatchObject({ code: 'not_found' }));
it('outside root', async () =>
  await expect(src.read('../x')).rejects.toMatchObject({ code: 'outside_root' }));
it('ignored path is not readable unless it is the target', async () => {
  await expect(src.read('build/notes.md')).rejects.toMatchObject({ code: 'not_found' });
  const single = new DiskSource({ ...opts, target: join(root, 'build/notes.md') });
  expect(single.root()).toEqual({ kind: 'file', name: 'notes.md' });
  expect((await single.read('notes.md')).encoding).toBe('utf8');
});
it('file target lists only itself', async () => {
  const single = new DiskSource({ ...opts, target: join(root, 'README.md') });
  expect((await single.list('')).map((e) => e.path)).toEqual(['README.md']);
});
it('search is fuzzy and capped', async () => {
  expect((await src.search('gd', 10)).map((e) => e.path)).toContain('docs/guide.md');
  expect((await src.search('', 1)).length).toBe(1);
});

// Watcher.test.ts (real fs, real chokidar; generous timeouts)
it('collapses rapid writes into one modified', async () => {
  /* write a.md 5× in 100 ms → exactly one { path:'a.md', change:'modified' } within 1 s */
});
it('emits created and deleted', async () => {
  /* ... */
});
it('ignores ignored paths', async () => {
  /* write node_modules/x.js → no event in 500 ms */
});
it('rename', async () => {
  /* renameSync a.md → b.md → one { change:'renamed', path:'b.md', from:'a.md' } */
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/server/test/DiskSource.test.ts packages/server/test/Watcher.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `Source.ts`, `DiskSource.ts`, `Watcher.ts`, `Bus.ts`**

- [ ] **Step 4: Run tests to verify they pass**

Run: same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(server): DiskSource with lazy listing, search, and debounced watcher"
```

---

### Task 5: WebSocket transport, handlers, HTTP, and `startServer`

**Files:**

- Create: `packages/server/src/transport/ws.ts`, `src/transport/handlers/{index,hello,list,read,subscribe,unsubscribe,search}.ts`, `src/transport/http.ts`, `src/server.ts`, `src/main.ts`, `bin/leaf.js`
- Test: `packages/server/test/handlers.test.ts`, `test/http.test.ts`, `test/integration.test.ts`

**Interfaces:**

- Consumes: `Source`, `SourceError`, `Bus`, `createWatcher` (Task 4); `loadConfig`, `createLogger`, `HELP_TEXT` (Task 2); protocol schemas (Task 1).
- Produces:
  - `type HandlerContext = { session: Session; source: Source; config: Config; log: Logger }`
  - `type Handler<T extends ClientMessage['type']> = (msg: Extract<ClientMessage, { type: T }>, ctx: HandlerContext) => Promise<void>`
  - `handlers: { [T in ClientMessage['type']]: Handler<T> }` in `handlers/index.ts`
  - `class Session { readonly id: string; readonly subscriptions: Set<string>; send(msg: ServerMessage): void; reply(inReplyTo: string | undefined, msg: ServerMessage): void; close(): void }`. Behavior: first message must be `hello` with protocol 1 else `error bad_request` and close; `send` logs at `debug` with the full message; invalid JSON or schema failure → `error bad_request` (not a close); unknown `type` → `warn` log, ignored.
  - `attachWs(httpServer: http.Server, deps: { source: Source; bus: Bus<{ 'file:changed': ChangeEvent }>; config: Config; log: Logger }): { close(): Promise<void> }` at path `/ws`. On `file:changed`, every session whose `subscriptions` contains the path, or a directory prefix of it, receives `changed`.
  - Handler semantics: `hello` → `welcome { protocol: 1, root: source.root(), config: { plantumlUrl, mentionUrl, topicUrl }, capabilities: source.capabilities(), participant: { id: 'local', name: 'You' } }`; `list` → `tree { path, entries }`; `read` → `file` with `url = '/raw/' + encodeURI(path)`; `subscribe`/`unsubscribe` mutate the set (no reply); `search` → `matches`. `SourceError` → `error { code, message, path }` with `inReplyTo`.
  - `createHttpHandler(deps: { source: Source; staticDir: string | null; log: Logger }): (req: IncomingMessage, res: ServerResponse) => void`. Routes: `GET /healthz` → `200 ok`; `GET /raw/<path>` → bytes with `Content-Type` from `classify().mime`, 403 on `outside_root`, 404 on missing or ignored (same rule as `read`); anything else → static file from `staticDir` if it exists, else `staticDir/index.html` (SPA fallback), else 404 when `staticDir` is null. Every request logged at `info` (`method path status ms`); `debug` adds headers.
  - `startServer(config: Config, deps?: { source?: Source; staticDir?: string }): Promise<{ url: string; port: number; close(): Promise<void> }>`. Default `staticDir`: `LEAF_STATIC_DIR` env, else `<server package>/public` if it exists, else `<repo>/packages/ui/dist/app` if it exists, else `null`. Logs `listening { host, port, url }` at `info` and every config value with its source at `debug`.
  - `main.ts`: `loadConfig(process.argv.slice(2), process.env, process.cwd())`; `help`/`version` print and exit; `open` → `startServer`, then `open(url)` when `config.open`; `SIGINT`/`SIGTERM` → `close()` and exit 0. `export` → prints "not yet available" and exits 2 (Plan 3).

- [ ] **Step 1: Write the failing tests**

```ts
// handlers.test.ts — in-memory FakeSource implementing Source; a FakeSession capturing sent messages
it('hello → welcome with capabilities', async () => { await handlers.hello({ type:'hello', protocol:1, id:'1' }, ctx); expect(session.sent[0]).toMatchObject({ type:'welcome', inReplyTo:'1', capabilities:{ watch:true } }); });
it('read → file with raw url', async () => { await handlers.read({ type:'read', path:'docs/a.md' }, ctx); expect(session.sent[0]).toMatchObject({ type:'file', url:'/raw/docs/a.md' }); });
it('read error → error with code', async () => { await handlers.read({ type:'read', path:'nope.md', id:'r' }, ctx); expect(session.sent[0]).toMatchObject({ type:'error', code:'not_found', inReplyTo:'r' }); });
it('subscribe records path', async () => { await handlers.subscribe({ type:'subscribe', path:'docs' }, ctx); expect(session.subscriptions.has('docs')).toBe(true); });

// http.test.ts — real http server with FakeSource and a temp staticDir containing index.html + assets/app.js
it('raw serves bytes with mime', ...)            // 200, content-type text/markdown or text/plain
it('raw 403 outside root', ...)                  // GET /raw/../x
it('raw 404 missing', ...)
it('static asset and spa fallback', ...)         // GET /assets/app.js → 200 js; GET /docs/guide.md → index.html
it('healthz', ...)

// integration.test.ts — temp dir, real DiskSource, startServer({ port: 0, open: false }), real WebSocket client
it('full round trip', async () => {
  const ws = await connect(`${url.replace('http','ws')}/ws`);
  send({ type:'hello', protocol:1, id:'h' }); expect((await next()).type).toBe('welcome');
  send({ type:'list', id:'l' }); expect((await next())).toMatchObject({ type:'tree', inReplyTo:'l' });
  send({ type:'subscribe', path:'README.md' }); send({ type:'read', path:'README.md', id:'r' }); expect((await next()).type).toBe('file');
  writeFileSync(join(dir,'README.md'), '# changed'); expect(await next(2000)).toMatchObject({ type:'changed', path:'README.md', change:'modified' });
  send({ type:'bogus' }); send({ type:'read', path:'README.md', id:'r2' }); expect((await next())).toMatchObject({ type:'file', inReplyTo:'r2' });   // unknown type ignored, socket alive
});
it('first message must be hello', ...)           // send read first → error bad_request, then socket closes
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/server`
Expected: new tests FAIL.

- [ ] **Step 3: Implement transport, handlers, server, main, bin**

`bin/leaf.js` is `#!/usr/bin/env node\nimport '../dist/main.js';`. Keep `ws.ts` free of any `DiskSource`/`fs` import.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/server`
Expected: PASS.

- [ ] **Step 5: Smoke the CLI by hand**

Run: `mkdir -p /tmp/leafdemo && echo '# hi' > /tmp/leafdemo/a.md && LEAF_OPEN=false bin/run open /tmp/leafdemo -l debug & sleep 2; curl -s http://127.0.0.1:$(lsof -nP -iTCP -sTCP:LISTEN | grep node | awk '{print $9}' | sed 's/.*://' | head -1)/healthz; kill %1`
Expected: pretty log lines including `listening` and config values with sources; `ok` from healthz.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(server): ws transport with handler map, raw/static http, startServer and cli"
```

---

### Task 6: UI package scaffold, themes, sources, and stores

**Files:**

- Create: `packages/ui/package.json`, `tsconfig.json`, `vite.config.ts`, `vite.lib.config.ts`, `vitest.config.ts`, `index.html`, `src/main.tsx`, `src/index.ts`
- Create: `src/styles/leaf.css`, `src/styles/themes/{glass,card,paper}.css`
- Create: `src/source/DocumentSource.ts`, `src/source/WsSource.ts`, `src/source/createSource.ts`
- Create: `src/store/documents.ts`, `src/store/ui.ts`, `src/store/index.ts`
- Test: `packages/ui/test/WsSource.test.ts`, `test/store.test.ts`, `test/themes.test.ts`

**Interfaces:**

- Consumes: `@leaf/protocol` types and `parseServerMessage`.
- Produces:
  - `interface DocumentSource { send(msg: ClientMessage): void; onMessage(handler: (msg: ServerMessage) => void): () => void; onStatus(handler: (s: SourceStatus) => void): () => void; close(): void }` with `type SourceStatus = 'connecting' | 'open' | 'reconnecting' | 'closed'`.
  - `class WsSource implements DocumentSource` with `constructor(url: string, opts?: { WebSocketImpl?: typeof WebSocket; backoffMs?: number[] (default [500, 1000, 2000, 5000, 10000]) })`. Sends `hello` automatically on every (re)open; queues `send` calls while not open and flushes on open; emits `reconnecting` on close and retries with the backoff sequence, resetting after a successful open; invalid inbound JSON is dropped with `console.warn`.
  - `createSource(impl: { handle(msg: ClientMessage, emit: (m: ServerMessage) => void): void | Promise<void> }): DocumentSource` for hand-rolled and test sources; status is `open` immediately.
  - `useDocuments` zustand store: state `{ status: SourceStatus; root?: Welcome['root']; config: Config; capabilities?: Capabilities; path: string | null; tree: Record<string, Entry[]> (by dir path, '' = root); expanded: Set<string>; files: Record<string, FileMessage>; loading: Set<string>; errors: Record<string, ErrorMessage>; matches: Entry[] }`, actions `attach(source: DocumentSource): () => void`, `open(path: string)` (sets `path`, sends `subscribe`+`read`, unsubscribes the previous), `expand(dir)`, `collapse(dir)`, `expandAll()`, `collapseAll()`, `search(q)`, `refresh(path)`. Message handling: `welcome` → root/config/capabilities + `list('')`; `tree` → `tree[path]`; `file` → `files[path]`; `changed` → if `path` equals or is under the open path or an expanded dir, re-`read`/re-`list` accordingly; `deleted` of the open path → `files[path]` removed and `errors[path] = { code: 'not_found' }`; `error` with `inReplyTo` → `errors`.
  - `useUi` zustand store (persisted to localStorage key `leaf.ui`): `{ treeOpen: boolean (true); outlineOpen: boolean (true); numbering: boolean (false); theme: 'glass' | 'card' | 'paper' ('glass'); appearance: 'light' | 'dark' | 'auto' ('auto'); textPct: number (100); expandedDirs: string[] }` with setters and `bumpText(delta: -10 | 10 | 0)` clamped to 70–160 (0 resets to 100).
  - `useLeaf()` = `{ documents: useDocuments, ui: useUi }` hook pair exported from `store/index.ts`.
  - `applyTheme(root: HTMLElement, theme, appearance)` sets `data-theme` and `data-appearance` (`auto` resolved via `matchMedia('(prefers-color-scheme: dark)')`) and `--leaf-text-scale`.
  - CSS: `leaf.css` imports Tailwind (`@import "tailwindcss"`) and defines the token contract on `:root` with Glass defaults; each theme file sets the same tokens under `[data-theme="x"]` and `[data-theme="x"][data-appearance="dark"]`. Token names: `--leaf-font-ui, --leaf-font-doc, --leaf-font-mono, --leaf-bg, --leaf-sidebar-bg, --leaf-surface, --leaf-surface-2, --leaf-surface-3, --leaf-text, --leaf-text-2, --leaf-line, --leaf-line-2, --leaf-accent, --leaf-accent-soft, --leaf-code-bg, --leaf-glass, --leaf-mention, --leaf-topic, --leaf-radius, --leaf-radius-sm, --leaf-bar-h, --leaf-sidebar-w, --leaf-shadow`. Values lifted from the mockup's `:root` blocks for each concept (Card ← facebook, Paper ← google, Glass ← apple plus the "refinement" block).

- [ ] **Step 1: Write the failing tests**

```ts
// WsSource.test.ts — FakeWebSocket class (EventTarget-like with send/close, controllable open/message/close)
it('sends hello on open and flushes queue', ...)      // send(list) before open → after open, sent frames = [hello, list]
it('reconnects with backoff and re-hellos', ...)      // close → status reconnecting → after backoff[0] a new socket → hello sent again
it('parses inbound and drops garbage', ...)           // handler receives parsed welcome; "{bad" produces no handler call
// store.test.ts — createSource with a scripted handle()
it('welcome triggers root list and status open', ...)
it('open subscribes, reads, and unsubscribes previous', ...)
it('changed on open path re-reads once', ...)         // two changed within same tick → one read (dedupe pending)
it('deleted open path sets not_found', ...)
it('ui store persists and clamps text size', ...)     // bumpText(10)×10 → 160; bumpText(0) → 100; localStorage has leaf.ui
// themes.test.ts
it('every theme defines every token for light and dark', ...)   // parse the three css files; assert the token list appears under both selectors
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/ui`
Expected: FAIL.

- [ ] **Step 3: Implement the package**

`packages/ui/package.json`: name `@leaf/ui`, `exports: { ".": "./dist/lib/index.js", "./leaf.css": "./dist/lib/leaf.css" }`, scripts `dev` (`vite`), `build` (`vite build && vite build -c vite.lib.config.ts`), `e2e` (`playwright test`), peerDependencies `react`, `react-dom`; dependencies `@leaf/protocol`, `zustand`, `unified` family (installed in Task 7), `tailwindcss` + `@tailwindcss/vite`; devDependencies `vite`, `@vitejs/plugin-react`, `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/user-event`, `@playwright/test`, `typescript`. `vite.config.ts`: app build to `dist/app`, dev server port 5173 with `proxy: { '/ws': { target: 'ws://127.0.0.1:4321', ws: true }, '/raw': 'http://127.0.0.1:4321' }`, `appType: 'spa'`. `vite.lib.config.ts`: `build.lib` entry `src/index.ts`, formats `es`, external `react`, `react-dom`, out `dist/lib`. `main.tsx` mounts `<Reader source={new WsSource(wsUrl())} />` where `wsUrl()` = `?ws=` query param, else `ws(s)://<location.host>/ws`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/ui`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(ui): package scaffold, theme tokens, WsSource, stores"
```

---

### Task 7: Markdown engine

**Files:**

- Create: `packages/ui/src/render/pipeline.ts`, `src/render/slug.ts`, `src/render/headings.ts`, `src/render/registries/{blocks,inline,parsers}.ts`, `src/render/inline/{mention,topic}.ts`, `src/render/plugins/{rehypeInline,rehypePos,remarkAlerts}.ts`, `src/render/components/{CodeBlock,Heading,Link,Image}.tsx`
- Create: `packages/ui/fixtures/{gfm,code,headings,inline,links,alerts,math,frontmatter,html}.md`
- Test: `packages/ui/test/pipeline.test.tsx`, `test/slug.test.ts`, `test/inline.test.ts`

**Interfaces:**

- Produces:
  - `githubSlug(text: string, seen: Map<string, number>): string` (lowercase, strip everything but letters/numbers/space/hyphen, spaces → `-`, dedupe `-1`, `-2`).
  - `extractHeadings(markdown: string): Heading[]` with `Heading = { depth: 1..6; text: string; slug: string; line: number }` using the same slugger so the outline matches the document.
  - `type RenderOptions = { docPath: string; config: Config; handlers?: Handlers; registries?: { blocks?: BlockRegistry; inline?: InlineRegistry; parsers?: ParserRegistry }; linkBase?: string }`
  - `type Handlers` exactly as §7.3 (`resolveLink`, `onMention`, `onTopic`, `renderBlock`, `onUnknownBlock`).
  - `renderMarkdown(src: string, opts: RenderOptions): Promise<{ element: ReactElement; headings: Heading[]; frontmatter?: Record<string, unknown> }>`. Pipeline: `remark-parse` → `remark-frontmatter` (yaml, parsed with `yaml`, removed from output and returned) → `remark-gfm` → `remark-math` → `remark-gemoji` → `remarkAlerts` → parsers registry → `remark-rehype` (`allowDangerousHtml`) → `rehype-raw` → `rehype-sanitize` (GitHub schema extended to allow `className` on `code`/`span`/`div`, `data-pos`, `id` on headings, `input[type=checkbox][checked][disabled]`, KaTeX output) → `rehype-katex` → `rehypePos` (sets `data-pos="L:C-L:C"` from `node.position`) → heading ids via `githubSlug` → `rehypeInline` (inline registry over text nodes not under `code`, `pre`, `a`, `kbd`) → `hast-util-to-jsx-runtime` with `components: { pre: CodeBlock, h1..h6: Heading, a: Link, img: Image }`.
  - `BlockRegistry`: `register(entry: { lang: string | RegExp; render: (code: string, meta: string, ctx: BlockCtx) => ReactNode })`, `resolve(lang: string)`. `CodeBlock` resolves `handlers.renderBlock` → registry → `handlers.onUnknownBlock` → default shiki block. In this plan the registry has no entries; viewers register in later plans. Default code block: shiki `codeToHtml` with themes `github-light`/`github-dark` via `defaultColor: false` (CSS switches), lazy-loaded highlighter cached per language; a `lang` label; no fill (CSS).
  - `InlineRegistry`: `register({ name, pattern: RegExp (global), render: (m: RegExpMatchArray, ctx) => ReactNode | { href: string; label?: string } })`. Built-ins `mention` (`/(^|\s)@([\w-]+)/g`, href from `handlers.onMention` → `config.mentionUrl` template `{username}` → plain styled span) and `topic` (`/(^|\s)#([\w-]+)/g`, likewise with `{topic}`).
  - `Link`: relative hrefs go through `handlers.resolveLink` (default: `{ navigate }` for in-tree-looking relative `.md` paths, `{ external }` for `http(s):`/`mailto:`, else the raw url resolved against `/raw/<docDir>/`); renders `<a data-nav>` for navigation targets (the Reader intercepts clicks). `Image`: relative `src` → `/raw/<resolved>`; absolute left alone.
  - `ParserRegistry`: ordered `remark`/`rehype` plugin list appended after `remarkAlerts`.

- [ ] **Step 1: Write the fixtures**

Each fixture is the human-readable superset for its area and will be copied into `examples/` in Task 11. `headings.md` includes two `## Setup` headings and a heading with punctuation (`## What's new? (v2)`). `inline.md` includes `@rob`, `#topic`, a code span containing `@notamention`, and an email `a@b.com` (must not become a mention). `links.md` has `./guide.md`, `../up.md`, `#setup`, `https://x.com`, `![](./img.png)`. `alerts.md` has all five GitHub alert types. `gfm.md` has tables (with alignment), task lists, strikethrough, footnotes, autolinks, nested lists, blockquote with a heading inside. `html.md` has an inline `<details>` and a `<script>` that must be stripped.

- [ ] **Step 2: Write the failing tests**

```ts
// slug.test.ts
it.each([['Hello World','hello-world'], ["What's new? (v2)",'whats-new-v2'], ['  spaced  ','spaced']])('%s', (t, s) => expect(githubSlug(t, new Map())).toBe(s));
it('dedupes', () => { const seen = new Map(); expect(githubSlug('Setup', seen)).toBe('setup'); expect(githubSlug('Setup', seen)).toBe('setup-1'); });

// pipeline.test.tsx — helper html(fixture) = renderToStaticMarkup((await renderMarkdown(src, opts)).element)
it('gfm table, task list, strikethrough, footnote', async () => { const h = await html('gfm'); expect(h).toContain('<table'); expect(h).toMatch(/<input[^>]*type="checkbox"[^>]*checked/); expect(h).toContain('<del>'); expect(h).toContain('footnote'); });
it('duplicate headings get -1 and outline matches', async () => { const r = await render('headings'); const h = toHtml(r.element); expect(h).toContain('id="setup"'); expect(h).toContain('id="setup-1"'); expect(r.headings.map(x => x.slug)).toContain('setup-1'); });
it('code block is highlighted with lang label', async () => { const h = await html('code'); expect(h).toContain('data-lang="typescript"'); expect(h).toContain('class="shiki'); });
it('code block without language renders plain', ...);
it('mention and topic, not inside code or emails', async () => { const h = await html('inline'); expect(h).toContain('class="leaf-mention"'); expect(h).not.toContain('>@notamention<span'); expect(h).not.toMatch(/a<span[^>]*mention/); });
it('mention url template from config', async () => { const h = await html('inline', { config: { mentionUrl: 'https://x.com/{username}' } }); expect(h).toContain('href="https://x.com/rob"'); });
it('relative links and images resolve against doc dir', async () => { const h = await html('links', { docPath: 'docs/a.md' }); expect(h).toContain('data-nav="docs/guide.md"'); expect(h).toContain('src="/raw/docs/img.png"'); expect(h).toContain('href="https://x.com"'); });
it('alerts', async () => expect(await html('alerts')).toContain('class="leaf-alert leaf-alert-warning"'));
it('math', async () => expect(await html('math')).toContain('class="katex'));
it('frontmatter is parsed and removed', async () => { const r = await render('frontmatter'); expect(r.frontmatter).toMatchObject({ title: 'Doc' }); expect(toHtml(r.element)).not.toContain('title: Doc'); });
it('html passthrough is sanitized', async () => { const h = await html('html'); expect(h).toContain('<details'); expect(h).not.toContain('<script'); });
it('data-pos on blocks', async () => expect(await html('gfm')).toMatch(/data-pos="\d+:\d+-\d+:\d+"/));
it('handlers.renderBlock wins', async () => { const h = await html('code', { handlers: { renderBlock: (lang) => lang === 'typescript' ? <div id="custom" /> : undefined } }); expect(h).toContain('id="custom"'); });
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run packages/ui/test/pipeline.test.tsx packages/ui/test/slug.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement the engine**

Install: `unified remark-parse remark-frontmatter remark-gfm remark-math remark-gemoji remark-rehype rehype-raw rehype-sanitize rehype-katex katex hast-util-to-jsx-runtime unist-util-visit yaml shiki`. `remarkAlerts` converts a blockquote whose first paragraph starts with `[!NOTE]|[!TIP]|[!IMPORTANT]|[!WARNING]|[!CAUTION]` into `<div class="leaf-alert leaf-alert-<type>"><p class="leaf-alert-title">Note</p>…`. Nothing in `render/` imports from `store/` or `source/`.

- [ ] **Step 5: Run tests to verify they pass**

Run: same command. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(ui): unified markdown engine with gfm, alerts, math, slugs, inline matchers, shiki"
```

---

### Task 8: Viewer registry and the basic viewers

**Files:**

- Create: `packages/ui/src/viewers/types.ts`, `src/viewers/registry.ts`, `src/viewers/{markdown,code,image,media,binary}/index.tsx`, `src/viewers/index.ts`
- Test: `packages/ui/test/viewers.test.tsx`

**Interfaces:**

- Consumes: `renderMarkdown` (Task 7); `FileMessage` (Task 1).
- Produces:
  - `type ViewerProps = { file: FileMessage; content?: string; docPath: string; config: Config; handlers?: Handlers }`
  - `interface Viewer { id: string; matches: { ext?: string[]; lang?: string[]; mime?: string[]; kind?: string[] }; Inline: React.FC<ViewerProps>; Rich: React.FC<ViewerProps>; stage?: { pan?: boolean; zoom?: boolean; draw?: boolean }; actions?: Action[] }` with `type Action = { id: string; label: string; icon: React.FC; run(ctx: ViewerProps): void | Promise<void> }`.
  - `viewers` registry: `register(v: Viewer)`, `forFile(file: FileMessage): Viewer` (by `ext`, then `mime`, then `kind`, else `binary`), `forLang(lang: string): Viewer | undefined`.
  - Built-ins: `markdown` (`Rich` = `<Markdown>` from Task 9's engine wrapper; `Inline` unused), `code` (`Inline` = shiki block; `Rich` = CodeMirror 6 `EditorView` read-only with `lineNumbers`, `highlightActiveLine` off, language from `@codemirror/language-data` by `lang`, search keymap, soft-wrap toggle via a `wrap` prop; theme bound to leaf tokens through `EditorView.theme`), `image` (`Inline`/`Rich` = `<img src=file.url>` fit-to-width; SVG inlined via fetch when `mime` is `image/svg+xml`), `media` (`pdf` → `<iframe>`, `audio/*` → `<audio controls>`, `video/*` → `<video controls>`), `binary` (centered card: file-type icon, name, size formatted `1.2 MB`, mtime, download link to `file.url`). `code` also matches `kind: ['text']` so any text file gets CodeMirror.

- [ ] **Step 1: Write the failing tests**

```ts
it('forFile picks by ext then kind', () => { expect(viewers.forFile(f('a.py', 'text')).id).toBe('code'); expect(viewers.forFile(f('x.png', 'image')).id).toBe('image'); expect(viewers.forFile(f('x.weird', 'binary')).id).toBe('binary'); expect(viewers.forFile(f('x.mp4','media','video/mp4')).id).toBe('media'); });
it('binary card shows name, size, download', () => { render(<Binary.Rich file={f('blob.bin','binary',undefined,{ size: 1234567 })} .../>); expect(screen.getByText('blob.bin')).toBeTruthy(); expect(screen.getByText('1.2 MB')).toBeTruthy(); expect(screen.getByRole('link', { name: /download/i }).getAttribute('href')).toBe('/raw/blob.bin'); });
it('code rich mounts CodeMirror read-only with line numbers', () => { const { container } = render(<Code.Rich file={f('a.ts','text')} content={'const a = 1\\nconst b = 2'} .../>); expect(container.querySelector('.cm-editor')).toBeTruthy(); expect(container.querySelectorAll('.cm-gutterElement').length).toBeGreaterThan(1); expect(container.querySelector('.cm-content')?.getAttribute('contenteditable')).toBe('false'); });
it('media picks element by mime', () => { expect(render(<Media.Rich file={f('a.pdf','pdf','application/pdf')} .../>).container.querySelector('iframe')).toBeTruthy(); expect(render(<Media.Rich file={f('a.mp3','media','audio/mpeg')} .../>).container.querySelector('audio')).toBeTruthy(); });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/ui/test/viewers.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Install: `@codemirror/state @codemirror/view @codemirror/language @codemirror/language-data @codemirror/search`.

- [ ] **Step 4: Run tests to verify they pass**

Run: same. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(ui): viewer registry with code (CodeMirror), image, media, binary viewers"
```

---

### Task 9: Reader shell: layout, title bar, tree, outline, palette, router

**Files:**

- Create: `packages/ui/src/components/{Reader,Markdown,Layout,TopBar,Tree,Outline,Palette,ConnectionDot,TextSize,ThemeMenu,IconButton,DocumentView}.tsx`, `src/router.ts`, `src/shortcuts.ts`, `src/icons/{Leaf,Sidebar,Outline,Numbering,Appearance,Search,Plus,Minus,ExpandAll,CollapseAll,File,Folder,Image,Code,Link,Copy,ZoomIn,Chevron,Download}.tsx`
- Modify: `src/index.ts` (exports), `src/styles/leaf.css` (component styles)
- Test: `packages/ui/test/Reader.test.tsx`, `test/router.test.ts`, `test/Outline.test.tsx`, `test/Tree.test.tsx`, `test/Palette.test.tsx`

**Interfaces:**

- Consumes: stores and `DocumentSource` (Task 6), `renderMarkdown`/`extractHeadings` (Task 7), viewers (Task 8).
- Produces:
  - `<Reader source={DocumentSource} base?: string handlers?: Handlers theme?: Theme appearance?: Appearance treeOpen?: boolean onTreeOpenChange?: (v: boolean) => void outlineOpen?: … numbering?: … path?: string onPathChange?: (p: string) => void />`. Controlled props override the store when provided (§7.1).
  - `<Markdown source: string docPath?: string config?: Config handlers?: Handlers numbering?: boolean />` renders the engine output alone.
  - `createRouter(base: string): { current(): { path: string; slug: string }; push(path: string, slug?: string): void; replace(...): void; subscribe(fn): () => void }` using `history.pushState`; path strategy only (§7.4): URL = `base + '/' + path` (+ `#slug`), `''` path ↔ `base + '/'`.
  - `DocumentView`: picks `viewers.forFile(file)` and renders `Rich`; markdown documents additionally pass `numbering` and intercept clicks on `a[data-nav]` to call `router.push`.
  - `TopBar`: left `IconButton` (toggle tree, `[` shortcut), `Leaf` mark, title (first H1 from headings, else file name) with path beneath; center search field opening the palette (`⌘K`/`Ctrl+K`); right `TextSize` (`−` value `+`; click value resets), numbering toggle (`n`), outline toggle (`]`), `ThemeMenu` (appearance light/dark/auto + theme glass/card/paper), `ConnectionDot` (green `open`, amber `reconnecting`/`connecting`, gray `closed`, with title text).
  - `Tree`: visible only when `root.kind === 'dir'` and the root listing has more than one file-or-dir entry (§8.1); header "Files" + expand-all + collapse-all + filter input; rows from `tree[dir]`, lazy `expand(dir)` on chevron click; filter: client-side substring on loaded paths plus `search(q)` results merged (debounced 150 ms) when `q.length ≥ 2`; monotone icons by kind; active row = open path.
  - `Outline`: header "Outline" + expand/collapse; nested list from `headings`; `numbering` prefixes `1.`, `1.1`; current heading via `IntersectionObserver` (`rootMargin: '-70px 0px -70% 0px'`); click → `router.push(path, slug)` and `scrollIntoView`.
  - `Palette`: modal over the document; input; results = headings of the open document (fuzzy, showing depth and number) then file matches from `search`; `↑/↓/Enter/Esc`; selecting a heading sets the hash and scrolls; selecting a file opens it.
  - Numbering in the document: `Heading` component (Task 7) receives `numbering` through context and prefixes computed numbers (`h2` → `1.`, `h3` → `1.1`, restarting correctly across depth jumps); anchor link icon appears on hover to the left and copies the URL on click.
  - `shortcuts.ts`: `installShortcuts(actions): () => void` for `[`, `]`, `n`, `t` (appearance), `⌘/Ctrl+K`, `Esc` (closes palette), ignoring events from inputs.

- [ ] **Step 1: Write the failing tests**

```tsx
// router.test.ts
it('path round trip with base', () => { const r = createRouter('/app'); r.push('docs/a.md', 'setup'); expect(location.pathname).toBe('/app/docs/a.md'); expect(location.hash).toBe('#setup'); expect(r.current()).toEqual({ path: 'docs/a.md', slug: 'setup' }); });
it('root', () => { const r = createRouter(''); r.push(''); expect(location.pathname).toBe('/'); expect(r.current().path).toBe(''); });

// Reader.test.tsx — scripted createSource with a two-file dir (README.md with "# Title\\n## Setup\\n## Setup", docs/guide.md) and a single-file root
it('renders README by default with title and outline', async () => { render(<Reader source={dirSource} />); expect(await screen.findByRole('heading', { name: 'Title', level: 1 })).toBeTruthy(); expect(screen.getByRole('navigation', { name: 'Outline' })).toBeTruthy(); });
it('hides the tree for a single file', async () => { render(<Reader source={fileSource} />); await screen.findByRole('heading', { level: 1 }); expect(screen.queryByRole('navigation', { name: 'Files' })).toBeNull(); });
it('toggles tree and outline, sticky', async () => { ... click sidebar button → Files nav gone; JSON.parse(localStorage['leaf.ui']).state.treeOpen === false ... });
it('numbering toggle numbers document and outline', async () => { ... click numbering → heading text starts with "1. " and outline item "1. Setup", second "2. Setup" ... });
it('text size control', async () => { ... click + → value "110%" and document.documentElement.style.getPropertyValue('--leaf-text-scale') === '1.1'; click value → "100%" ... });
it('clicking a tree file opens it and updates the url', async () => { ... click "guide.md" → location.pathname === '/docs/guide.md' and heading from guide ... });
it('in-document relative link navigates', async () => { ... });
it('theme menu switches data-theme', async () => { ... choose Card → documentElement.dataset.theme === 'card' ... });
it('connection dot reflects status', ...);
// Outline.test.tsx — current heading tracks a mocked IntersectionObserver; Tree.test.tsx — filter narrows rows and queries search; Palette.test.tsx — ⌘K opens, typing "set" lists both Setup headings with numbers, Enter sets hash "#setup"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/ui`
Expected: new tests FAIL.

- [ ] **Step 3: Implement components, icons, router, shortcuts, styles**

Styles follow §10 and the mockup: Glass tokens default; components use Tailwind utilities for layout and `var(--leaf-*)` for every color; the bar is 52px, sidebars 260px and full window height with hairlines on their inner edges; the document fills the center column; code and diagram blocks have no fill. Every icon is a `React.FC<{ size?: number }>` returning inline SVG with `stroke="currentColor"`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/ui`
Expected: PASS.

- [ ] **Step 5: Look at it**

Run: `bin/dev -o` (serves `examples/` once Task 11 lands; until then point it at `packages/ui/fixtures`: `bin/dev packages/ui/fixtures -o`). Expected: the page matches the Glass mockup in both appearances; all bar controls work.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(ui): Reader shell with title bar, tree, outline, palette, router, themes"
```

---

### Task 10: Live updates and reconnection behavior

**Files:**

- Modify: `packages/ui/src/store/documents.ts`, `src/components/DocumentView.tsx`, `src/components/Reader.tsx`, `src/render/components/CodeBlock.tsx`
- Test: `packages/ui/test/live.test.tsx`

**Interfaces:**

- Consumes: `WsSource` status events, `useDocuments.refresh`.
- Produces: §7.5 behavior. `DocumentView` preserves `scrollTop` across a re-render of the same path; `CodeBlock` is keyed by a hash of `lang + code` so unchanged blocks keep their DOM (and, later, diagram renders); `deleted` → quiet "File removed" state (`role="status"`) that recovers on `created`; on `reconnecting` the last render stays and the dot is amber; on re-open the source re-sends `hello`, the store re-subscribes the open path and all expanded dirs, and re-reads the open path.

- [ ] **Step 1: Write the failing tests**

```tsx
it('changed re-renders content and keeps scroll', async () => { ... emit file v1, scroll container to 400, emit changed+file v2 → new text present, scrollTop === 400 ... });
it('unchanged code block keeps its DOM node', async () => { ... capture pre element; emit v2 with same block → same node identity ... });
it('deleted shows removed state and recovers', async () => { ... emit changed deleted → getByRole('status') has "removed"; emit changed created + file → heading back ... });
it('reconnect re-hellos, re-subscribes, re-reads', async () => { ... FakeWebSocket close → dot title "Reconnecting"; advance timers → new socket; frames sent on it: hello, subscribe README.md, read README.md (and list for expanded dirs) ... });
it('five rapid changed messages cause one read', async () => { ... });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/ui/test/live.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run tests to verify they pass**

Run: same. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(ui): live updates with scroll preservation, keyed blocks, reconnect"
```

---

### Task 11: Examples corpus, Playwright smoke test, build pipeline, end-to-end `leaf open`

**Files:**

- Create: `examples/README.md`, `examples/{gfm,code,headings,inline-matchers,links-and-images,alerts,math,frontmatter,html,outline-and-numbering}.md`, `examples/assets/{logo.svg,photo.jpg}`, `examples/files/{script.py,config.toml,data.csv,notes.txt,blob.bin,clip.mp3?}`, `examples/nested/deep/deeper/leaf.md`, `examples/.gitignore` (ignores `examples/build/`), `examples/build/ignored.md`
- Create: `packages/ui/playwright.config.ts`, `packages/ui/e2e/smoke.spec.ts`
- Modify: `packages/server/package.json` (`prepack` copies `../ui/dist/app` → `public/`; `files: ["dist","public","bin"]`), `bin/test`, `bin/build`, `README.md` (root: what leaf is, `bin/setup`, `bin/dev`, `leaf open`, env table)

**Interfaces:**

- Consumes: everything above.
- Produces: `npm run e2e -w @leaf/ui` runs Playwright against a real `startServer` on `examples/` with the built UI; `bin/test` runs unit + e2e; `bin/build` produces `packages/ui/dist/{app,lib}` and `packages/server/dist`; the server package is self-contained so `npx <tarball-or-published-name> open <path>` works with nothing else installed.

- [ ] **Step 1: Write the examples corpus**

`examples/README.md` is the index with one section per capability linking to its file (§9). Each feature file is the fixture from Task 7 plus prose explaining what to look for. `outline-and-numbering.md` has headings jumping from `##` to `####` and back. `links-and-images.md` references `./assets/logo.svg`, `./assets/photo.jpg`, `./gfm.md#tables`, a broken `./missing.md`. `files/` exercises the code, media, and binary viewers. `nested/` exercises depth; `build/ignored.md` must not appear in the tree.

- [ ] **Step 2: Write the failing smoke test**

```ts
// e2e/smoke.spec.ts — globalSetup builds nothing; webServer runs `node ../server/bin/leaf.js open ../../examples --no-open --port 4599` with LEAF_STATIC_DIR=dist/app
test('examples render without console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('leaf');
  await expect(page.getByRole('navigation', { name: 'Files' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Files' })).not.toContainText('ignored.md');
  for (const f of [
    'gfm.md',
    'code.md',
    'headings.md',
    'inline-matchers.md',
    'links-and-images.md',
    'alerts.md',
    'math.md',
    'frontmatter.md',
    'html.md',
    'outline-and-numbering.md',
  ]) {
    await page.goto('/' + f);
    await expect(page.locator('article')).toBeVisible();
  }
  await page.goto('/files/script.py');
  await expect(page.locator('.cm-editor')).toBeVisible();
  await page.goto('/files/blob.bin');
  await expect(page.getByRole('link', { name: /download/i })).toBeVisible();
  await page.goto('/assets/photo.jpg');
  await expect(page.locator('img')).toBeVisible();
  expect(errors).toEqual([]);
});
test('outline, numbering, anchors, palette', async ({ page }) => {
  /* toggle numbering → "1." prefix; click outline item → url hash; ⌘K → type → Enter → hash */
});
test('live update', async ({ page }) => {
  /* goto /live.md (created by the test in examples/ then removed in afterAll); append a heading via fs; expect it to appear within 3 s */
});
test('themes and text size are sticky', async ({ page }) => {
  /* choose Card, reload → data-theme card; + twice, reload → 120% */
});
```

- [ ] **Step 3: Run the smoke test to verify it fails**

Run: `bin/build && npm run e2e -w @leaf/ui`
Expected: FAIL (examples missing or assertions unmet).

- [ ] **Step 4: Finish the corpus, wire `bin/test`/`bin/build`, root README, `prepack`**

- [ ] **Step 5: Run everything**

Run: `bin/lint && bin/test`
Expected: unit tests PASS in all three packages; Playwright PASS (4 tests).

- [ ] **Step 6: Make the package `npx`-installable** _(author: "support npx installs too")_

`tsup` for the server sets `noExternal: ['@leaf/protocol']` so the published tarball has no workspace dependency; `prepack` runs `bin/build`-equivalent steps for ui and copies `packages/ui/dist/app` into `packages/server/public`; `startServer` resolves `public/` relative to its own module (`import.meta.url`), not `cwd`. Verify from a clean directory:

Run: `cd packages/server && npm pack --pack-destination /tmp && cd /tmp && rm -rf npxtest && mkdir npxtest && cd npxtest && LEAF_OPEN=false npx --yes /tmp/leaf-server-0.1.0.tgz open /Users/rob/code/read/examples --port 4600 & sleep 4; curl -s http://127.0.0.1:4600/ | grep -c '<div id="root">'; curl -s http://127.0.0.1:4600/raw/README.md | head -1; kill %1`
Expected: `1` (the app shell is served from the tarball's `public/`), then `# leaf` (raw works), and the process logs `listening`.

- [ ] **Step 7: Open it for real**

Run: `bin/build && node packages/server/bin/leaf.js open examples -l debug`
Expected: browser opens on the examples index in the Glass theme; the terminal streams pretty logs; saving a file in `examples/` updates the page.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: examples corpus, playwright smoke test, build pipeline, npx-ready package"
```

---

## Self-review notes

- **Spec coverage:** §5 protocol → T1, T5. §6 config/logging/cli → T2; classify/paths/ignore → T3; DiskSource/watcher/bus → T4; transport/http/startServer → T5. §7.1 sources/stores/library → T6, T9; §7.2 parity → T7; §7.3 registries + handlers → T7; §7.4 routing → T9; §7.5 live → T10; §7.6 `data-pos` → T7; §7.7 viewers (basic set) → T8. §8.1/8.1a/8.1b/8.2/8.3/8.4/8.6a/8.7 → T9. §9 examples + §11 testing → T11. §3 binstubs → T1. Out of scope items are listed at the top and go to the Viewers plan (mermaid, plantuml, excalidraw, notebook, geojson, csv, stl, Stage, annotations, copy-as-image) and the Embedding plan (tables + directives, StaticSource, export, 404 shim, base path on static hosts).
- **Type consistency:** `DocumentSource` (T6) is what `Reader` (T9) and the store consume; `Viewer`/`ViewerProps` (T8) are what `DocumentView` (T9) renders; `Handlers`/`RenderOptions` (T7) flow through `Reader` → `Markdown`; `FileMessage` from T1 is the `file` type in T4's `FileData` mapped by T5's `read` handler.
- **Review Focus pins:** 1 → T4 `large file is not inlined` + T8 binary card; 2 → T4 `ignored path … unless it is the target`; 3 → T4 watcher collapse + T10 `five rapid changed messages`; 4 → T7 duplicate headings + T9 palette/outline; 5 → T6 reconnect + T10 reconnect test.
