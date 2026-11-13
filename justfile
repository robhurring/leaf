# leaf — development task runner

set positional-arguments

# List all available tasks
default:
    @just --list

# ─── Dev Environment ─────────────────────────────────────────────────────────

# Install dependencies, create .env, and fetch the browsers the tests use (safe to re-run)
setup:
    #!/usr/bin/env bash
    set -euo pipefail
    need() { command -v "$1" >/dev/null || { echo "missing: $1 ($2)" >&2; exit 1; }; }
    need node "install Node 22 or newer"
    need npm "comes with Node"
    need cargo "install Rust: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
    npm install
    [[ -f .env ]] || { cp .env.example .env; echo "created .env from .env.example"; }
    # Playwright drives the browser smoke test in `just test`.
    npx playwright install chromium webkit firefox >/dev/null 2>&1 || echo "playwright browser install skipped (run: npx playwright install chromium webkit firefox)"
    echo "setup complete"

# `just dev [-o|--open] [path]`: the server is on ${PORT:-4321}, Vite on 5173; -o opens the
# reader in a browser once Vite is up; path is a file or folder (default: docs/examples).
# Run the leaf server and Vite with live reload
dev *args:
    #!/usr/bin/env bash
    set -euo pipefail
    open_browser=false; target="docs/examples"
    for arg in "$@"; do
      case "$arg" in
        -o|--open) open_browser=true ;;
        -*) echo "usage: just dev [-o|--open] [path]" >&2; exit 2 ;;
        *) target="$arg" ;;
      esac
    done
    [[ -f .env ]] || cp .env.example .env
    # The server runs from its package directory, so hand it an absolute path.
    target="$(cd "$(dirname "$target")" && pwd)/$(basename "$target")"

    export PORT="${PORT:-4321}" LEAF_OPEN=false
    cargo run -q -p leaf-app -- serve "$target" 2>&1 | sed -u 's/^/[server] /' &
    server_pid=$!
    npm run dev --if-present -w @leaf/ui 2>&1 | sed -u 's/^/[ui]     /' &
    ui_pid=$!
    trap 'kill $server_pid $ui_pid 2>/dev/null; wait $server_pid $ui_pid 2>/dev/null || true' EXIT INT TERM

    if $open_browser; then
      for _ in $(seq 1 50); do
        if curl -s -o /dev/null http://localhost:5173/; then open http://localhost:5173/; break; fi
        sleep 0.2
      done
    fi
    wait $server_pid $ui_pid

# Run the leaf CLI from source, e.g. `just run open docs/examples -l debug`
run *args:
    @cargo run -q -p leaf-app -- "$@"

# Open docs/examples/realtime.md in leaf to watch.
# Write made-up live traffic into docs/examples/live/ until ctrl-c
demo-live:
    @scripts/demo-live.sh

# ─── Build & Check ───────────────────────────────────────────────────────────

# Build the protocol and the UI. The leaf binary embeds the built UI, so this comes before cargo.
_ui:
    npm run build --if-present -w @leaf/protocol
    npm run build --if-present -w @leaf/ui

# Also refreshes an installed leaf link and (macOS) builds ~/Applications/leaf reader.app
# (see `just bundle`). LEAF_BUNDLE=0 skips the app: a build to check, that leaves the
# installed one alone.
# Build the protocol, the UI, and target/release/leaf
build:
    #!/usr/bin/env bash
    set -euo pipefail
    npm run build --if-present -w @leaf/protocol
    # The JSON Schema export is the contract other implementations (the Rust core) are tested against.
    npm run schema -w @leaf/protocol
    npm run build --if-present -w @leaf/ui
    # Opening leaf stays fast: the page's startup scripts and styles have a size budget.
    node packages/ui/scripts/check-entry-size.mjs
    # The Rust binary embeds the built UI, so it comes last. The whole workspace, as `just test`
    # builds it, so both share one set of compiled crates in target/release.
    cargo build --release --workspace
    # If `leaf` on PATH is a link into this checkout (from `just install`, or the old Node link), point it at the new binary.
    if link="$(command -v leaf 2>/dev/null)" && [[ -L "$link" ]]; then
      dest="$(readlink "$link")"
      if [[ "$dest" == "$(pwd)/"* && "$dest" != "$(pwd)/target/release/leaf" ]]; then
        ln -sfn "$(pwd)/target/release/leaf" "$link"
        echo "relinked $link -> $(pwd)/target/release/leaf"
      fi
    fi
    # The app (macOS) runs a copy of the binary, so every build makes it again: what Finder
    # and leaf:// links open is always what was just built.
    if [[ "$(uname)" == "Darwin" && "${LEAF_BUNDLE:-1}" != 0 ]]; then
      scripts/bundle.sh
    fi
    echo "built target/release/leaf"

# Type-check every package and check formatting; Rust warnings are errors
lint:
    npm run lint
    cargo fmt --all -- --check
    cargo clippy --workspace --all-targets -- -D warnings

# target/ (Rust, which grows by gigabytes), the UI's dist/, release packages, and test
# reports. The next `just build` starts from scratch (a few minutes).
# Delete what builds and tests leave behind
clean: (_clean "")

# `just clean`, and node_modules too (run `just setup` after)
clean-all: (_clean "node_modules")

_clean extra:
    #!/usr/bin/env bash
    set -euo pipefail
    paths=(target dist packages/*/dist packages/*/test-results packages/*/playwright-report packages/*/tsconfig.tsbuildinfo)
    [[ -n "$1" ]] && paths+=("$1")

    existing=()
    for p in "${paths[@]}"; do [[ -e "$p" ]] && existing+=("$p"); done
    [[ ${#existing[@]} -gt 0 ]] || { echo "nothing to clean"; exit 0; }

    freed="$(du -sch "${existing[@]}" | tail -1 | cut -f1)"
    rm -rf "${existing[@]}"
    echo "freed $freed: ${existing[*]}"
    # The installed app keeps working; the `leaf` link from `just install` points into
    # target/, so it works again after the next build.
    if [[ -n "$1" ]]; then echo "next: just setup, then just build"; else echo "next: just build"; fi

# ─── Test ────────────────────────────────────────────────────────────────────

# Rust tests run in release, to share compiled dependencies with `just build` (one tree, not two).
# Run the Rust and UI unit tests
test-unit: _ui
    cargo test --workspace --release
    npm test

# The smoke tests drive the real server on docs/examples/ with the built UI.
# Run the unit tests, build, then the browser smoke tests on three engines
test: test-unit build
    LEAF_BIN="{{ justfile_directory() }}/target/release/leaf" npm run e2e -w @leaf/ui

# ─── Install ─────────────────────────────────────────────────────────────────

# The link goes in LEAF_BIN_DIR, or the first of ~/.local/bin, ~/bin that is on PATH. On macOS
# the build also installs ~/Applications/leaf reader.app for leaf:// links (see `just bundle`).
# Build leaf and symlink this checkout's `leaf` into your user bin dir
install:
    #!/usr/bin/env bash
    set -euo pipefail
    d="$(just _bin-dir)"
    LEAF_BUNDLE=1 just build
    mkdir -p "$d"
    ln -sfn "$(pwd)/target/release/leaf" "$d/leaf"
    echo "installed: $d/leaf -> $(pwd)/target/release/leaf (a live link; rebuild with just build)"

# Remove the `leaf` link and (macOS) the app
uninstall:
    #!/usr/bin/env bash
    set -euo pipefail
    d="$(just _bin-dir)"
    rm -f "$d/leaf" && echo "removed $d/leaf"
    scripts/bundle.sh --remove

# Where `leaf` is linked: LEAF_BIN_DIR, or the first of ~/.local/bin, ~/bin that is on PATH
_bin-dir:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${LEAF_BIN_DIR:-}" ]]; then echo "$LEAF_BIN_DIR"; exit 0; fi
    for d in "$HOME/.local/bin" "$HOME/bin"; do
      case ":$PATH:" in *":$d:"*) echo "$d"; exit 0 ;; esac
    done
    echo "just install: neither ~/.local/bin nor ~/bin is on your PATH; set LEAF_BIN_DIR=<dir on PATH>" >&2
    exit 1

# `just bundle [--remove | --no-register]`: --remove unregisters and deletes it; --no-register
# builds it without claiming leaf:// links. LEAF_APP overrides the path; LEAF_ICON picks the
# icon: leaf-mark (default), vein-arrow, or page.
# (macOS) Build ~/Applications/leaf reader.app and register it for leaf:// links
bundle *args:
    @scripts/bundle.sh "$@"

# ─── Release ─────────────────────────────────────────────────────────────────

# `scripts/package.sh --help` lists LEAF_TARGETS and the signing variables.
# (macOS) Build the release app as a .dmg and a .zip in dist/release/
package:
    @scripts/package.sh

# `just release [X.Y.Z] [--dry-run] [--skip-checks]`: bumps the version everywhere, runs the
# unit checks, commits and tags on main, and pushes both; the tag starts the release workflow.
# Release the next minor version, or X.Y.Z
release *args:
    @scripts/release.sh "$@"
