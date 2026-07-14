#!/usr/bin/env bash
set -euo pipefail

TEST_APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXECUTABLE_PATH="$TEST_APP_DIR/build/Codex CUA Lab.app/Contents/MacOS/Codex CUA Lab"
FOUND=0
PIDS=()

while IFS= read -r pid; do
  [[ -n "$pid" ]] || continue
  kill -TERM "$pid"
  PIDS+=("$pid")
  FOUND=1
done < <(pgrep -f "$EXECUTABLE_PATH" || true)

if [[ "$FOUND" -eq 0 ]]; then
  echo "Codex CUA Lab is not running"
else
  deadline=$((SECONDS + 10))
  for pid in "${PIDS[@]}"; do
    while kill -0 "$pid" 2>/dev/null; do
      if (( SECONDS >= deadline )); then
        echo "Timed out waiting for Codex CUA Lab process $pid to exit" >&2
        exit 1
      fi
      sleep 0.1
    done
  done
  echo "Stopped Codex CUA Lab"
fi
