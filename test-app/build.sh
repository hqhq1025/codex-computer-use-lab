#!/usr/bin/env bash
set -euo pipefail

TEST_APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="$TEST_APP_DIR/build"
APP_NAME="Codex CUA Lab.app"
APP_PATH="$BUILD_DIR/$APP_NAME"
STAGE_DIR="$BUILD_DIR/.stage-$$"
STAGE_APP="$STAGE_DIR/$APP_NAME"
CONTENTS_DIR="$STAGE_APP/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
EXECUTABLE_PATH="$MACOS_DIR/Codex CUA Lab"
SDK_PATH="$(xcrun --sdk macosx --show-sdk-path)"
ARCH="$(uname -m)"

case "$ARCH" in
  arm64|x86_64) ;;
  *)
    echo "Unsupported macOS architecture: $ARCH" >&2
    exit 1
    ;;
esac

cleanup() {
  rm -rf "$STAGE_DIR"
}
trap cleanup EXIT

mkdir -p "$MACOS_DIR"

xcrun swiftc \
  -sdk "$SDK_PATH" \
  -target "$ARCH-apple-macosx13.0" \
  -O \
  -framework AppKit \
  -framework WebKit \
  "$TEST_APP_DIR"/Sources/*.swift \
  -o "$EXECUTABLE_PATH"

cp "$TEST_APP_DIR/Info.plist" "$CONTENTS_DIR/Info.plist"
printf 'APPL????' > "$CONTENTS_DIR/PkgInfo"
plutil -lint "$CONTENTS_DIR/Info.plist" >/dev/null

codesign \
  --force \
  --sign - \
  --timestamp=none \
  --identifier com.openai.codex.cualab \
  "$STAGE_APP"

codesign --verify --deep --strict "$STAGE_APP"
rm -rf "$APP_PATH"
mv "$STAGE_APP" "$APP_PATH"

echo "$APP_PATH"
