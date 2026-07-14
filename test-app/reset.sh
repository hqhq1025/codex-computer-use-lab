#!/usr/bin/env bash
set -euo pipefail

TEST_APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

"$TEST_APP_DIR/stop.sh"
rm -rf "$TEST_APP_DIR/runtime"

echo "Reset Codex CUA Lab state"
