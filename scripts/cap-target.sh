#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

usage() {
  echo "usage: scripts/cap-target.sh    keep target/ under LEAF_TARGET_CAP gigabytes (default 6; 0 = no cap)."
  echo "  \`just build\` runs this before cargo. Over the cap, it deletes the cheapest thing to make again"
  echo "  first and stops as soon as target/ fits: scratch files, the per-architecture trees \`just package\`"
  echo "  leaves, the debug tree's incremental cache, the debug tree (\`just dev\`, \`just lint\`), and last"
  echo "  the release tree, which the build that follows compiles again from scratch (a few minutes)."
}
[[ "${1:-}" == "--help" || "${1:-}" == "-h" ]] && { usage; exit 0; }

cap="${LEAF_TARGET_CAP:-6}"
[[ "$cap" =~ ^[0-9]+$ ]] || { echo "cap-target: LEAF_TARGET_CAP=$cap is not a whole number of gigabytes" >&2; exit 1; }
[[ "$cap" != 0 && -d target ]] || exit 0

size_kb() { du -sk target | cut -f1; }
gb() { awk -v kb="$1" 'BEGIN { printf "%.1f", kb / 1048576 }'; }
cap_kb=$((cap * 1048576))
before="$(size_kb)"
[[ "$before" -gt "$cap_kb" ]] || exit 0

# Cheapest to make again first. A tree for another architecture is any directory that
# holds a release/ or debug/ of its own (target/aarch64-apple-darwin, ...).
tiers=(target/tmp)
for d in target/*/; do
  d="${d%/}"
  [[ -d "$d/release" || -d "$d/debug" ]] && tiers+=("$d")
done
tiers+=(target/debug/incremental target/debug target/release)

removed=()
for t in "${tiers[@]}"; do
  [[ "$(size_kb)" -gt "$cap_kb" ]] || break
  [[ -e "$t" ]] || continue
  rm -rf "$t"
  removed+=("$t")
done
after="$(size_kb)"
echo "target/ was $(gb "$before") GB, over the $cap GB cap (LEAF_TARGET_CAP): removed ${removed[*]:-nothing}; now $(gb "$after") GB"
