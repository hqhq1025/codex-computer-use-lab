#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${OUT_DIR:-$ROOT/fixtures/native}"
DEFAULT_APP="/Applications/ChatGPT.app/Contents/Resources/plugins/openai-bundled/plugins/computer-use/Codex Computer Use.app"
APP="${CUA_APP:-$DEFAULT_APP}"
BIN="${CUA_BINARY:-$APP/Contents/MacOS/SkyComputerUseService}"

for tool in nm otool strings codesign dwarfdump plutil shasum swift awk sed sort uniq; do
  command -v "$tool" >/dev/null 2>&1 || {
    printf 'missing required tool: %s\n' "$tool" >&2
    exit 1
  }
done

[[ -f "$BIN" ]] || {
  printf 'SkyComputerUseService not found: %s\n' "$BIN" >&2
  exit 1
}

mkdir -p "$OUT_DIR"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/native-symbol-map.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

INFO="$APP/Contents/Info.plist"
VERSION="$(plutil -extract CFBundleShortVersionString raw "$INFO")"
BUILD="$(plutil -extract CFBundleVersion raw "$INFO")"
BUNDLE_ID="$(plutil -extract CFBundleIdentifier raw "$INFO")"
UUID="$(dwarfdump --uuid "$BIN" | awk 'NR == 1 { print $2 }')"
SHA256="$(shasum -a 256 "$BIN" | awk '{ print $1 }')"
CDHASH="$(codesign -dvvv "$BIN" 2>&1 | awk -F= '/^CDHash=/{ value=$2 } END { print value }')"
MIN_OS="$(otool -l "$BIN" | awk '$1 == "minos" { value=$2 } END { print value }')"

nm -arch arm64 -n "$BIN" 2>/dev/null |
  awk '
    NF >= 3 {
      address=$1
      symbol_type=$2
      $1=$2=""
      sub(/^ +/, "", $0)
      if ($0 ~ /^_\$s(11ComputerUse|18Codex_Computer_Use|20AccessibilitySupport)/ ||
          $0 ~ /_TtC(11ComputerUse|18Codex_Computer_Use|20AccessibilitySupport)/) {
        sub(/^_/, "", $0)
        print address "\t" symbol_type "\t" $0
      }
    }
  ' > "$TMP/raw.tsv"

cut -f3 "$TMP/raw.tsv" | swift demangle --compact > "$TMP/demangled.txt"
paste "$TMP/raw.tsv" "$TMP/demangled.txt" > "$TMP/demangled.tsv"

awk -F '\t' '
    BEGIN { OFS="\t" }
    function category(s) {
      if (s ~ /ComputerUsePolicyProvider|ComputerUseAppPolicy|PolicyProvider/) return "app-policy"
      if (s ~ /ComputerUseURLBlocklist|EventStreamURLPolicy|URLPolicyRecord|isURLBlocked/) return "url-policy"
      if (s ~ /CodexComputerUseSessionTracker|AppSession|sessionBinding|SessionBinding/) return "session-binding"
      if (s ~ /ComputerUseIPCServer|ComputerUseIPCXPCSession|ExecutableComputerUseIPCRequest/) return "ipc-server"
      if (s ~ /ComputerUseIPCSenderAuthorization|ComputerUseIPCSenderContextResolver|ComputerUseIPCSenderContext/) return "sender-auth"
      if (s ~ /RemoteHostedPIP|ComputerUsePIPWindowLookup/) return "pip"
      if (s ~ /LockScreen|CUALockScreenGuardian/) return "lock-screen"
      if (s ~ /performKeyboardAction|sendClick|\.click\(|moveMouse|leftMouseDownUp|\.scroll\(|setValue\(elementID|selectText\(elementID|prepareToInteract/) return "input-dispatch"
      if (s ~ /SyntheticAppFocusEnforcer|SystemFocusStealPreventer|syntheticallyActivateIfNeeded/) return "focus-protection"
      if (s ~ /waitForUIToSettle|updateSkyshotSettlingIfNeeded|needsUISettleBeforeSkyshot/) return "settle"
      if (s ~ /captureScreenshot|writeScreenshotToFile|ScreenshotFile|screenshotNeededForContext|SCScreenshot/) return "screenshot"
      if (s ~ /RefetchableSkyshotAXTree|RefetchableUIElement|UIElementRenderDifference|captureAXTree|SystemSelectionExtractor|SkyshotOperation|updateSkyshot/) return "ax-render-diff-refetch"
      if (s ~ /ComputerUseAppController/) return "app-controller"
      return ""
    }
    function level(s) {
      if (s ~ /^-\[/) return "D1"
      if (s ~ /^OBJC_(CLASS|METACLASS|IVAR)/) return "D2"
      if (s ~ /variable initialization expression|property descriptor|direct field offset|type metadata|nominal type descriptor|protocol descriptor|protocol conformance/) return "D2"
      return "D1"
    }
    function include(s) {
      if (s ~ /^OBJC_(CLASS|METACLASS|IVAR)/ || s ~ /^-\[/) return 1
      if (s ~ /variable initialization expression/) return 1
      if (s ~ /method descriptor|async function pointer/) return 0
      if (s ~ /property descriptor|direct field offset|type metadata|nominal type descriptor|protocol descriptor|protocol conformance|protocol witness table|metaclass/) return 0
      if (s ~ /\.(getter|setter|modify|unsafeMutableAddressor)/) return 0
      if (s ~ /(__deallocating_deinit|\.deinit|hashValue|hash\(into:|__derived_|rawValue|allCases)/) return 0
      return 1
    }
    {
      searchable=$3 " " $4
      c=category(searchable)
      if (c != "" && include($4)) print c, level($4), $1, $2, $3, $4
    }
  ' "$TMP/demangled.tsv" |
  sort -t $'\t' -k1,1 -k3,3 -u > "$TMP/selected.tsv"

{
  printf 'category\tevidence\taddress\ttype\tmangled\tdemangled\n'
  cat "$TMP/selected.tsv"
} > "$OUT_DIR/symbols.tsv"

strings -a -n 8 "$BIN" > "$TMP/strings.txt"
nm -u -arch arm64 "$BIN" 2>/dev/null > "$TMP/imports.txt"
otool -L "$BIN" > "$TMP/deps.txt"

{
  printf 'area\tevidence\tsource\tvalue\n'
  printf 'ipc-server\tD3\tstring\tCodexComputerUseIPC-2\n'
  printf 'ipc-server\tD3\tstring\tcomputeruse.sock\n'
  printf 'sender-auth\tD3\tstring\tcua_ipc_sender_responsible_team_id\n'
  printf 'sender-auth\tD3\tstring\tComputerUseIPCSenderAuthorization\n'
  printf 'sender-auth\tD3\tstring\tComputerUseIPCSenderContextResolver\n'
  printf 'sender-auth\tD3\timport\tSecTaskCreateWithAuditToken\n'
  printf 'sender-auth\tD3\timport\tSecCodeCopySigningInformation\n'
  printf 'app-policy\tD3\tstring\tallowed_bundle_ids\n'
  printf 'app-policy\tD3\tstring\tdenied_bundle_ids\n'
  printf 'url-policy\tD3\tstring\tComputer Use stopped due to encountering a disallowed URL\n'
  printf 'xpc-transport\tD3\tdependency\tlibswiftXPC.dylib\n'
  printf 'xpc-transport\tD3\timport\txpc_pipe_routine\n'
  printf 'apple-event-bridge\tD3\tstring\tCould not get XPC bootstrap mach port from Apple event\n'
  printf 'apple-event-bridge\tD3\tstring\tCould not get request type name from Apple event\n'
  printf 'apple-event-bridge\tD3\tstring\tCould not get sender PID from Apple event\n'
  printf 'apple-event-bridge\tD3\timport\tNSAppleEventManager\n'
  printf 'screenshot\tD3\tdependency\tScreenCaptureKit.framework\n'
  printf 'screenshot\tD3\timport\tSCScreenshotManager\n'
  printf 'input-dispatch\tD3\timport\tCGEventGetFlags\n'
  printf 'lock-screen\tD3\tstring\t/tmp/com.openai.sky.CUAService/LockScreenLoginAuthorization.sock\n'
} > "$OUT_DIR/transport-evidence.tsv"

while IFS=$'\t' read -r area evidence source value; do
  [[ "$area" == "area" ]] && continue
  case "$source" in
    string) grep -Fq "$value" "$TMP/strings.txt" ;;
    import) grep -Fq "$value" "$TMP/imports.txt" ;;
    dependency) grep -Fq "$value" "$TMP/deps.txt" ;;
  esac || {
    printf 'missing transport evidence: %s (%s)\n' "$value" "$source" >&2
    exit 1
  }
done < "$OUT_DIR/transport-evidence.tsv"

{
  printf 'key\tvalue\n'
  printf 'artifact\tSkyComputerUseService\n'
  printf 'bundle_id\t%s\n' "$BUNDLE_ID"
  printf 'version\t%s\n' "$VERSION"
  printf 'build\t%s\n' "$BUILD"
  printf 'architecture\tarm64\n'
  printf 'uuid\t%s\n' "$UUID"
  printf 'sha256\t%s\n' "$SHA256"
  printf 'cdhash\t%s\n' "$CDHASH"
  printf 'minimum_macos\t%s\n' "$MIN_OS"
} > "$OUT_DIR/metadata.tsv"

required_patterns=(
  'ComputerUse.ComputerUseIPCServer.start'
  'ComputerUse.ComputerUseIPCServer handleEvent:withReplyEvent:'
  'ComputerUse.ComputerUseIPCXPCSession sendRequestWithTypeName'
  'ComputerUse.ComputerUseIPCSenderAuthorization'
  'ComputerUse.ComputerUseIPCSenderContextResolver'
  'ComputerUse.CodexAppServerComputerUsePolicyProvider'
  'ComputerUse.ComputerUseAppController.updateSkyshot'
  'ComputerUse.RefetchableSkyshotAXTree.refetchElementIfNeeded'
  'ComputerUse.RefetchableSkyshotAXTree.refetchTree'
  'ComputerUse.SkyshotOperation.captureScreenshot'
  'ComputerUse.ComputerUseAppController.performKeyboardAction'
  'AccessibilitySupport.ApplicationUIElement.sendClick'
  'AccessibilitySupport.SyntheticAppFocusEnforcer'
  'AccessibilitySupport.SystemFocusStealPreventer'
  'AccessibilitySupport.ApplicationUIElement.waitForUIToSettle'
  'ComputerUse.ComputerUseURLBlocklistCache'
  'ComputerUse.EventStreamURLPolicyRecordFilter'
  'Codex_Computer_Use.CodexComputerUseSessionTracker'
  'ComputerUse.RemoteHostedPIPContentPublisher.publishWindowStream'
  'ComputerUse.LockScreenAutoUnlockCoordinator.prepareForRequest'
  'ComputerUse.LockScreenGuardianCoordinator.withUnlockGuard'
)

for pattern in "${required_patterns[@]}"; do
  grep -Fq "$pattern" "$OUT_DIR/symbols.tsv" || {
    printf 'critical symbol self-check failed: %s\n' "$pattern" >&2
    exit 1
  }
done

{
  printf '# Native Symbol Map\n\n'
  printf -- '- Artifact: `SkyComputerUseService`\n'
  printf -- '- Bundle: `%s`\n' "$BUNDLE_ID"
  printf -- '- Version: `%s` (`%s`)\n' "$VERSION" "$BUILD"
  printf -- '- UUID: `%s`\n' "$UUID"
  printf -- '- SHA-256: `%s`\n' "$SHA256"
  printf -- '- Evidence: `D1` method/function symbol; `D2` type/property/field symbol; `D3` import, dependency, or literal string.\n\n'
  printf '## Coverage\n\n'
  printf '| Area | Selected symbols |\n|---|---:|\n'
  awk -F '\t' 'NR > 1 { count[$1]++ } END { for (key in count) print key "\t" count[key] }' "$OUT_DIR/symbols.tsv" |
    sort |
    awk -F '\t' '{ printf "| `%s` | %d |\n", $1, $2 }'
  printf '\n## Representative Symbols\n\n'
  printf '| Area | Level | Address | Demangled symbol |\n|---|---|---:|---|\n'
  awk -F '\t' '
    NR > 1 && shown[$1] < 4 {
      symbol=$6
      gsub(/\|/, "\\|", symbol)
      printf "| `%s` | `%s` | `0x%s` | `%s` |\n", $1, $2, $3, symbol
      shown[$1]++
    }
  ' "$OUT_DIR/symbols.tsv"
  printf '\n## Key Method Anchors\n\n'
  printf '| Area | Level | Address | Demangled symbol |\n|---|---|---:|---|\n'
  awk -F '\t' '
    NR > 1 && $6 ~ /(ComputerUseIPCServer.start|handleEvent:withReplyEvent:|sendRequestWithTypeName|updateSkyshot\(|refetchTree\(|captureScreenshot\(|performKeyboardAction\(|sendClick\(|waitForUIToSettle\(|publishWindowStream\(|prepareForRequest\(|withUnlockGuard\()/ {
      symbol=$6
      gsub(/\|/, "\\|", symbol)
      printf "| `%s` | `%s` | `0x%s` | `%s` |\n", $1, $2, $3, symbol
    }
  ' "$OUT_DIR/symbols.tsv"
  printf '\n## Transport Boundary\n\n'
  printf 'The shipped Node client primary path is the length-prefixed JSON-RPC native pipe at `computeruse.sock`, terminating in `ComputerUseIPCServer` and its `jsonRPCSocketServer`. '
  printf '`ComputerUseIPCXPCSession` plus Apple Event bootstrap strings describe a compiled alternate bridge, not the current Node client entry path.\n\n'
  printf '| Area | Level | Source | Evidence |\n|---|---|---|---|\n'
  awk -F '\t' 'NR > 1 { printf "| `%s` | `%s` | `%s` | `%s` |\n", $1, $2, $3, $4 }' "$OUT_DIR/transport-evidence.tsv"
} > "$OUT_DIR/symbol-map.md"

printf 'generated %s selected symbols for SkyComputerUseService %s\n' \
  "$(( $(wc -l < "$OUT_DIR/symbols.tsv") - 1 ))" "$VERSION"
printf 'fixtures: %s\n' "$OUT_DIR"
