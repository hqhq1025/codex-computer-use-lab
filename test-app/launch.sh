#!/usr/bin/env bash
set -euo pipefail

TEST_APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_PATH="$TEST_APP_DIR/build/Codex CUA Lab.app"
STATE_PATH="$TEST_APP_DIR/runtime/state.json"

if [[ ! -x "$APP_PATH/Contents/MacOS/Codex CUA Lab" ]]; then
  "$TEST_APP_DIR/build.sh" >/dev/null
fi

previous_mtime=0
if [[ -e "$STATE_PATH" ]]; then
  previous_mtime="$(stat -f %m "$STATE_PATH")"
fi

if [[ "${CUA_LAB_BACKGROUND:-0}" == "1" ]]; then
  open -n -g --env CUA_LAB_BACKGROUND=1 "$APP_PATH"
else
  open -n "$APP_PATH"
fi

deadline=$((SECONDS + 10))
while true; do
  current_mtime=0
  if [[ -e "$STATE_PATH" ]]; then
    current_mtime="$(stat -f %m "$STATE_PATH")"
  fi
  if (( current_mtime > previous_mtime )); then
    break
  fi
  if (( SECONDS >= deadline )); then
    echo "Timed out waiting for Codex CUA Lab oracle refresh" >&2
    exit 1
  fi
  sleep 0.1
done

echo "Launched $APP_PATH"
echo "State output: $TEST_APP_DIR/runtime/state.json"
