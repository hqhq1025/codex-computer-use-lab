#!/usr/bin/env bash

set -euo pipefail
umask 077

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="$ROOT/scripts/display-geometry-probe.swift"
OUT=""

while (($# > 0)); do
  case "$1" in
    --out)
      OUT="${2:?--out requires a path}"
      shift 2
      ;;
    --help)
      printf '%s\n' "Usage: $0 [--out PATH]"
      exit 0
      ;;
    *)
      printf 'Unknown argument: %s\n' "$1" >&2
      exit 2
      ;;
  esac
done

[[ "$(uname -s)" == "Darwin" ]] || {
  printf '%s\n' "display geometry probe requires macOS" >&2
  exit 1
}

command -v xcrun >/dev/null 2>&1 || {
  printf '%s\n' "missing required tool: xcrun" >&2
  exit 1
}

command -v node >/dev/null 2>&1 || {
  printf '%s\n' "missing required tool: node" >&2
  exit 1
}

[[ -f "$SOURCE" ]] || {
  printf 'missing Swift probe: %s\n' "$SOURCE" >&2
  exit 1
}

if [[ -z "$OUT" ]]; then
  exec xcrun swift "$SOURCE"
fi

mkdir -p "$(dirname "$OUT")"
TMP="$(mktemp "${OUT}.tmp.XXXXXX")"
trap 'rm -f "$TMP"' EXIT

xcrun swift "$SOURCE" > "$TMP"
node -e '
  const fs = require("node:fs");
  JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
' "$TMP"
chmod 600 "$TMP"
mv -f "$TMP" "$OUT"
trap - EXIT

printf 'wrote sanitized display geometry fixture: %s\n' "$OUT"
